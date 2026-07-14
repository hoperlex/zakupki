#!/usr/bin/env bash
#
# deploy-zak — деплой/обновление портала zakupki (build-on-VPS). Portal-scoped:
# не трогает соседние порталы, infra-nginx и Keycloak.
#
# Ставится симлинком и работает из ЛЮБОГО каталога:
#   sudo ln -sfn /opt/portals/zakupki/deploy/deploy-zak.sh /usr/local/bin/deploy-zak
#
#   deploy-zak                      — git pull + сборка + накат кода + health
#   deploy-zak --migrate            — то же + дамп БД + накат НОВЫХ миграций
#   deploy-zak --migrate --maintenance
#                                   — миграции в окне обслуживания (стоп API; RPO = 0)
#   deploy-zak --previous           — откат кода на предыдущий commit-SHA (без пересборки)
#   deploy-zak --previous --restore-db
#                                   — согласованный откат кода и БД
#   deploy-zak --restore-db[=файл]  — восстановление БД из дампа (destructive)
#   deploy-zak --restore-config[=архив]
#                                   — восстановление .env.production / CA из снимка
#   deploy-zak --status             — read-only сводка
#   deploy-zak --no-prune           — без чистки образов/BuildKit-кэша
#
# Запускать можно от root (через deploy/vps.sh) или от владельца портала: скрипт
# сам перезапустится от владельца, иначе образы и state стали бы root-owned.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Пути. ВСЁ якорится на реальном расположении скрипта, а не на cwd — именно это
# (а не сам симлинк) позволяет запускать команду из любого каталога.
# ---------------------------------------------------------------------------
SCRIPT="$(readlink -f "$0")"
PORTAL_DIR="$(cd "$(dirname "$SCRIPT")/.." && pwd)"
COMPOSE_FILE="$PORTAL_DIR/deploy/docker-compose.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE" -p zakupki)

# ВНИМАНИЕ: не путать с STORAGE_ROOT=/var/lib/zakupki/storage — тот путь живёт
# ВНУТРИ контейнера (named volume zakupki-storage) и к этому каталогу отношения
# не имеет. Совпадение префикса — историческое.
STATE_DIR="${ZAK_STATE_DIR:-/var/lib/zakupki/deploy}"
LOCK_FILE="$STATE_DIR/deploy.lock"
RELEASE_STATE="$STATE_DIR/release.state"
REPORT_DIR="$STATE_DIR/reports"
BACKUP_DIR="$STATE_DIR/db-backups"      # дампы: ПДн + хэши паролей — 700/600
CONFIG_DIR="$STATE_DIR/config-backups"  # снимки конфига: секреты — 700/600

DB_TOOLS_IMAGE="postgres:17"            # мажор = серверу Yandex Managed PG
LIVE_VHOST="/opt/infra/nginx/conf.d/zakupki.conf"
HEALTH_URL="https://zak.su10.ru/api/v1/health"

KEEP_RELEASES=3     # SHA-тегов на образ (current/previous/запущенные — сверх лимита)
KEEP_DUMPS=3        # предмиграционных дампов
KEEP_CONFIGS=10     # снимков конфига
CACHE_AGE_NORMAL=336h
CACHE_AGE_TIGHT=72h
DISK_MIN_GB=8
DISK_TIGHT_PCT=85

log()  { echo "==> $*"; }
warn() { echo "!!  $*" >&2; }
fail() { echo "ОШИБКА: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
deploy-zak — деплой/обновление портала zakupki. Portal-scoped: не трогает
соседние порталы, infra-nginx и Keycloak. Работает из любого каталога.

  deploy-zak                        git pull + сборка + накат кода + health
  deploy-zak --migrate              то же + дамп БД + накат НОВЫХ миграций
  deploy-zak --migrate --maintenance
                                    миграции в окне обслуживания: стоп API до
                                    дампа, RPO = 0 (для миграций, несовместимых
                                    со старым кодом)
  deploy-zak --previous             откат кода на предыдущий commit-SHA, без
                                    пересборки; схему НЕ откатывает
  deploy-zak --previous --restore-db[=файл]
                                    согласованный откат кода и БД
  deploy-zak --restore-db[=файл]    восстановление БД из дампа (destructive,
                                    требует TTY; без аргумента — свежий дамп)
  deploy-zak --restore-config[=архив]
                                    восстановление .env.production и CA из
                                    снимка (destructive, требует TTY)
  deploy-zak --status               read-only сводка: релизы, образы, миграции,
                                    бэкапы, диск
  deploy-zak --help                 эта справка

Модификаторы:
  --no-prune                        не чистить образы и BuildKit-кэш
                                    (ротация бэкапов выполняется всегда)

Переменные окружения:
  ZAK_STATE_DIR                     каталог состояния (по умолчанию
                                    /var/lib/zakupki/deploy)
  ZAK_DEPLOY_USER                   владелец портала (по умолчанию — владелец
                                    каталога репозитория)
  ZAK_PRUNE_CACHE=0                 то же, что --no-prune, для кэша

Запускать можно от root (через deploy/vps.sh) или от владельца портала: от root
скрипт сам перезапустится от владельца, иначе образы и state стали бы root-owned.

Ретеншн: 3 SHA-тега на образ, 3 предмиграционных дампа, 1 аварийный, 10 снимков
конфига, BuildKit-кэш старше 14 суток (при заполнении диска ≥85% — старше 72 ч).
EOF
  exit 0
}

# ---------------------------------------------------------------------------
# Разбор аргументов.
# ---------------------------------------------------------------------------
DO_MIGRATE=0 DO_MAINTENANCE=0 DO_PREVIOUS=0 DO_RESTORE_DB=0 DO_RESTORE_CFG=0
DO_STATUS=0 NO_PRUNE=0
RESTORE_DB_ARG="" RESTORE_CFG_ARG=""

for arg in "$@"; do
  case "$arg" in
    --migrate)          DO_MIGRATE=1 ;;
    --maintenance)      DO_MAINTENANCE=1 ;;
    --previous)         DO_PREVIOUS=1 ;;
    --restore-db)       DO_RESTORE_DB=1 ;;
    --restore-db=*)     DO_RESTORE_DB=1; RESTORE_DB_ARG="${arg#*=}" ;;
    --restore-config)   DO_RESTORE_CFG=1 ;;
    --restore-config=*) DO_RESTORE_CFG=1; RESTORE_CFG_ARG="${arg#*=}" ;;
    --status)           DO_STATUS=1 ;;
    --no-prune)         NO_PRUNE=1 ;;
    -h|--help)          usage ;;
    *) echo "Неизвестный аргумент: $arg (см. --help)" >&2; exit 2 ;;
  esac
done

ROLLBACK_MODE=$(( DO_PREVIOUS || DO_RESTORE_DB || DO_RESTORE_CFG ))

# Взаимоисключения — до любых мутаций и до самоповышения.
if [ "$ROLLBACK_MODE" -eq 1 ]; then
  [ "$DO_MIGRATE" -eq 1 ] && { echo "--previous/--restore-* несовместимы с --migrate" >&2; exit 2; }
  [ "$DO_MAINTENANCE" -eq 1 ] && { echo "--previous/--restore-* несовместимы с --maintenance" >&2; exit 2; }
fi
# У billhub --maintenance без --migrate — тихий no-op: флаг читается только внутри
# ветки миграций, и оператор получает «окно обслуживания», которого не было.
if [ "$DO_MAINTENANCE" -eq 1 ] && [ "$DO_MIGRATE" -eq 0 ]; then
  echo "--maintenance имеет смысл только вместе с --migrate" >&2; exit 2
fi
if [ "$DO_STATUS" -eq 1 ] && { [ "$ROLLBACK_MODE" -eq 1 ] || [ "$DO_MIGRATE" -eq 1 ]; }; then
  echo "--status — режим только для чтения, он несовместим с изменяющими флагами" >&2; exit 2
fi

# Ярлык операции для отчёта.
ACTION="deploy"
if [ "$ROLLBACK_MODE" -eq 1 ]; then
  parts=()
  [ "$DO_PREVIOUS" -eq 1 ]    && parts+=(rollback_previous)
  [ "$DO_RESTORE_DB" -eq 1 ]  && parts+=(restore_db)
  [ "$DO_RESTORE_CFG" -eq 1 ] && parts+=(restore_config)
  ACTION="$(IFS='+'; echo "${parts[*]}")"
fi

# ---------------------------------------------------------------------------
# Bootstrap state-каталогов и самоповышение root -> владелец портала.
# /var/lib принадлежит root, поэтому каталоги создаём ПОКА мы ещё root — после
# `exec sudo` такой возможности уже не будет.
# ---------------------------------------------------------------------------
[ -d "$PORTAL_DIR/.git" ] || fail "$PORTAL_DIR не похож на git-репозиторий портала"
DEPLOY_USER="${ZAK_DEPLOY_USER:-$(stat -c %U "$PORTAL_DIR")}"

if [ "$(id -u)" -eq 0 ]; then
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$(dirname "$STATE_DIR")"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$STATE_DIR" "$REPORT_DIR"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "$BACKUP_DIR" "$CONFIG_DIR"
fi

if [ "$(id -un)" != "$DEPLOY_USER" ]; then
  ELEVATE=()
  [ "$DO_MIGRATE" -eq 1 ]     && ELEVATE+=(--migrate)
  [ "$DO_MAINTENANCE" -eq 1 ] && ELEVATE+=(--maintenance)
  [ "$DO_PREVIOUS" -eq 1 ]    && ELEVATE+=(--previous)
  [ "$DO_STATUS" -eq 1 ]      && ELEVATE+=(--status)
  [ "$NO_PRUNE" -eq 1 ]       && ELEVATE+=(--no-prune)
  if [ "$DO_RESTORE_DB" -eq 1 ]; then
    [ -n "$RESTORE_DB_ARG" ] && ELEVATE+=("--restore-db=$RESTORE_DB_ARG") || ELEVATE+=(--restore-db)
  fi
  if [ "$DO_RESTORE_CFG" -eq 1 ]; then
    [ -n "$RESTORE_CFG_ARG" ] && ELEVATE+=("--restore-config=$RESTORE_CFG_ARG") || ELEVATE+=(--restore-config)
  fi
  if [ "$(id -u)" -eq 0 ]; then
    log "перезапуск от владельца портала ($DEPLOY_USER)"
    # Именно "$SCRIPT": под sudo secure_path может не содержать /usr/local/bin.
    exec sudo -u "$DEPLOY_USER" -H "$SCRIPT" ${ELEVATE[@]+"${ELEVATE[@]}"}
  fi
  fail "запускать нужно от $DEPLOY_USER или от root. Выполните:
  sudo -u $DEPLOY_USER $SCRIPT $*"
fi

if [ ! -d "$STATE_DIR" ]; then
  fail "нет $STATE_DIR. Выполните один раз от root:
  install -d -o $DEPLOY_USER -g $DEPLOY_USER -m 755 $(dirname "$STATE_DIR")
  install -d -o $DEPLOY_USER -g $DEPLOY_USER -m 750 $STATE_DIR"
fi
install -d -m 750 "$REPORT_DIR"
install -d -m 700 "$BACKUP_DIR" "$CONFIG_DIR"

# Интерполяция compose для one-off сервисов. Экспорт ДО первого вызова compose.
ZAK_DEPLOY_UID="$(id -u)"; ZAK_DEPLOY_GID="$(id -g)"; ZAK_BACKUP_DIR="$BACKUP_DIR"
export ZAK_DEPLOY_UID ZAK_DEPLOY_GID ZAK_BACKUP_DIR
# git не должен ждать ввода: иначе pull повиснет, удерживая flock.
export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -oBatchMode=yes}"

git_c() { git -C "$PORTAL_DIR" "$@"; }

# ---------------------------------------------------------------------------
# release.state
# ---------------------------------------------------------------------------
CURRENT_BEFORE="" PREVIOUS_BEFORE=""
if [ -f "$RELEASE_STATE" ]; then
  CURRENT_BEFORE="$(grep -E '^current=' "$RELEASE_STATE" | cut -d= -f2- || true)"
  PREVIOUS_BEFORE="$(grep -E '^previous=' "$RELEASE_STATE" | cut -d= -f2- || true)"
fi

# Атомарно: обрыв записи не должен оставить битый state.
write_release_state() {
  local prev="$1" cur="$2" tmp
  tmp="$(mktemp "$RELEASE_STATE.XXXXXX")"
  { printf 'previous=%s\n' "$prev"; printf 'current=%s\n' "$cur"; } >"$tmp"
  chmod 600 "$tmp"; mv -f "$tmp" "$RELEASE_STATE"
}

# ---------------------------------------------------------------------------
# --status: только чтение, ни lock, ни каталогов, ни снимков.
# ---------------------------------------------------------------------------
if [ "$DO_STATUS" -eq 1 ]; then
  echo "portal   : $PORTAL_DIR"
  echo "current  : ${CURRENT_BEFORE:-<нет>}"
  echo "previous : ${PREVIOUS_BEFORE:-<нет>}"
  echo "HEAD     : $(git_c rev-parse --short HEAD 2>/dev/null || echo '?')"
  if [ -n "$(git_c status --porcelain 2>/dev/null || true)" ]; then
    echo "           (рабочее дерево ГРЯЗНОЕ — деплой откажется собирать)"
  fi
  echo
  echo "контейнеры:"; "${COMPOSE[@]}" ps --format '  {{.Name}}  {{.Image}}  {{.Status}}' 2>/dev/null || true
  echo
  echo "образы (SHA-теги):"
  for repo in zakupki-api zakupki-web; do
    docker image ls "$repo" --format "  {{.Repository}}:{{.Tag}}  {{.Size}}  {{.CreatedSince}}" 2>/dev/null | head -6
  done
  echo
  echo "бэкапы:"
  echo "  дампы   : $(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' 2>/dev/null | wc -l) шт, $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
  echo "  конфиги : $(find "$CONFIG_DIR" -maxdepth 1 -name '*.tar.gz' 2>/dev/null | wc -l) шт, $(du -sh "$CONFIG_DIR" 2>/dev/null | cut -f1)"
  echo
  echo "миграции:"
  "${COMPOSE[@]}" run --rm -T migrate pnpm --silent --filter @zakupki/db db:migrate:status 2>/dev/null | tail -1 || echo "  (не удалось определить)"
  echo
  echo "диск:"; df -h / | tail -1 | sed 's/^/  /'
  exit 0
fi

# ---------------------------------------------------------------------------
# Lock. Снимается вместе с FD — отдельная уборка не нужна.
# ---------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || fail "деплой уже выполняется (lock $LOCK_FILE)"

# ---------------------------------------------------------------------------
# Отчёт и восстановление.
# ---------------------------------------------------------------------------
RESULT="ok" REASON="" HEALTH="" COMMIT_SHA="" TARGET_TAG="" DUMP_FILE=""
PRE_RESTORE_DUMP="" CFG_SNAPSHOT="" CACHE_FREED=""
API_WAS_STOPPED=0 RESTORE_DB_TOUCHED=0 ROLLBACK_UP_STARTED=0 MIGRATION_ATTEMPTED=0
BUILT_TAG=""

json_escape() {
  local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}; printf '%s' "$s"
}

write_report() {
  local ts report
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  report="$REPORT_DIR/${ts}-${TARGET_TAG:-${COMMIT_SHA:-unknown}}.json"
  {
    printf '{\n'
    printf '  "portal": "zakupki",\n'
    printf '  "action": "%s",\n'        "$(json_escape "$ACTION")"
    printf '  "actor": "%s",\n'         "$(json_escape "${SUDO_USER:-${USER:-unknown}}")"
    printf '  "commit": "%s",\n'        "$(json_escape "$COMMIT_SHA")"
    printf '  "from_tag": "%s",\n'      "$(json_escape "$CURRENT_BEFORE")"
    printf '  "to_tag": "%s",\n'        "$(json_escape "${TARGET_TAG:-$COMMIT_SHA}")"
    printf '  "previous_tag": "%s",\n'  "$(json_escape "$PREVIOUS_BEFORE")"
    printf '  "migrate": %s,\n'         "$DO_MIGRATE"
    printf '  "maintenance": %s,\n'     "$DO_MAINTENANCE"
    printf '  "config_snapshot": "%s",\n' "$(json_escape "$CFG_SNAPSHOT")"
    printf '  "dump_file": "%s",\n'     "$(json_escape "$DUMP_FILE")"
    printf '  "pre_restore_dump": "%s",\n' "$(json_escape "$PRE_RESTORE_DUMP")"
    printf '  "cache_freed": "%s",\n'   "$(json_escape "$CACHE_FREED")"
    printf '  "health": "%s",\n'        "$(json_escape "$HEALTH")"
    printf '  "result": "%s",\n'        "$RESULT"
    printf '  "reason": "%s"\n'         "$(json_escape "$REASON")"
    printf '}\n'
  } >"$report"
  chmod 640 "$report"
  log "отчёт: $report"
}

# Восстановление знает, на каком шаге упало: поднимать сервисы можно не всегда.
recover() {
  local code=$?
  [ "$code" -eq 0 ] && return 0
  RESULT="fail"
  [ -z "$REASON" ] && REASON="прервано (код $code)"
  echo "ОШИБКА ($ACTION): $REASON" >&2

  if [ "$RESTORE_DB_TOUCHED" -eq 1 ]; then
    warn "pg_restore прерван. Restore шёл одной транзакцией — БД, скорее всего, осталась"
    warn "в состоянии до restore, но это НУЖНО ПРОВЕРИТЬ вручную."
    warn "Сервисы ОСТАВЛЕНЫ ОСТАНОВЛЕННЫМИ. Варианты: повторить --restore-db,"
    warn "pre-restore дамп ($PRE_RESTORE_DUMP), либо PITR Yandex Managed PG."
  elif [ "$ROLLBACK_UP_STARTED" -eq 1 ]; then
    warn "частичное переключение — возвращаю сервисы на ${CURRENT_BEFORE:-latest}"
    ZAK_TAG="${CURRENT_BEFORE:-latest}" "${COMPOSE[@]}" up -d --no-build api web || true
  elif [ "$MIGRATION_ATTEMPTED" -eq 1 ]; then
    warn "миграции могли примениться частично. API работает на СТАРОМ коде."
    warn "дамп до наката: $DUMP_FILE"
    warn "согласованный откат: deploy-zak --previous --restore-db=$DUMP_FILE"
    if [ "$API_WAS_STOPPED" -eq 1 ]; then
      warn "окно обслуживания: API оставлен ОСТАНОВЛЕННЫМ (авто-restore не делаем)"
    fi
  elif [ "$API_WAS_STOPPED" -eq 1 ]; then
    warn "поднимаю остановленный API на ${CURRENT_BEFORE:-latest}"
    ZAK_TAG="${CURRENT_BEFORE:-latest}" "${COMPOSE[@]}" up -d --no-build api || true
  elif [ -n "$BUILT_TAG" ]; then
    # Сборка прошла, но релиз не состоялся: не копим полусобранные SHA-образы.
    for repo in zakupki-api zakupki-web; do
      docker rmi "$repo:$BUILT_TAG" >/dev/null 2>&1 || true
    done
  fi
  write_report
}
trap recover EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------------------
# Общие помощники.
# ---------------------------------------------------------------------------
disk_free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }
disk_used_pct() { df --output=pcent / | tail -1 | tr -dc '0-9'; }

ensure_db_tools_image() {
  docker image inspect "$DB_TOOLS_IMAGE" >/dev/null 2>&1 && return 0
  log "docker pull $DB_TOOLS_IMAGE"
  docker pull "$DB_TOOLS_IMAGE" || { REASON="не удалось получить $DB_TOOLS_IMAGE"; fail "$REASON"; }
}

# Диагностический health изнутри контейнера: минует nginx/TLS.
health_check() {
  HEALTH="fail"
  for _ in 1 2 3 4 5; do
    if "${COMPOSE[@]}" exec -T api node -e "
      fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health')
        .then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      HEALTH="ok"; log "health: ok"; return 0
    fi
    sleep 3
  done
  return 1
}

snapshot_config() {
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  CFG_SNAPSHOT="config-${ts}-$(git_c rev-parse --short HEAD 2>/dev/null || echo nogit).tar.gz"
  local out="$CONFIG_DIR/$CFG_SNAPSHOT"
  local items=(.env.production certs/yandex-root.crt deploy/conf.d/zakupki.conf)
  local extra=()
  # Живой vhost мог разойтись с репо-копией — снимаем именно его.
  if [ -r "$LIVE_VHOST" ]; then
    extra=(-C "$(dirname "$LIVE_VHOST")" "$(basename "$LIVE_VHOST")")
  else
    warn "живой vhost $LIVE_VHOST нечитаем — в снимок не попадёт"
  fi
  ( umask 077; tar -czf "$out" -C "$PORTAL_DIR" "${items[@]}" ${extra[@]+"${extra[@]}"} )
  chmod 600 "$out"
  log "снимок конфига: config-backups/$CFG_SNAPSHOT"
  # Ротация: файлы копеечные, глубина истории важнее диска.
  # `|| true` обязателен: без совпадений ls возвращает 2, pipefail протаскивает
  # это через пайплайн, и set -e убивает скрипт на пустом месте.
  # shellcheck disable=SC2012  # имена снимков генерируем сами; ls -1t нужен ради сортировки по времени
  ls -1t "$CONFIG_DIR"/config-*.tar.gz 2>/dev/null | tail -n +$((KEEP_CONFIGS + 1)) | xargs -r rm -f || true
}

# Восстановление конфига из снимка. Отдельная функция: вызывается и как самостоятельный
# режим, и внутри --previous. Живой vhost не трогаем — это общая инфраструктура.
restore_config_from() {
  local archive="$1"
  if [ -z "$archive" ]; then
    # shellcheck disable=SC2012  # см. выше
    archive="$(ls -1t "$CONFIG_DIR"/config-*.tar.gz 2>/dev/null | head -1 || true)"
    [ -n "$archive" ] || { REASON="в $CONFIG_DIR нет снимков конфига"; fail "$REASON"; }
    archive="$(basename "$archive")"
  fi
  printf '%s' "$archive" | grep -qE '^config-[A-Za-z0-9._-]+\.tar\.gz$' \
    || { REASON="--restore-config принимает только имя снимка из $CONFIG_DIR"; fail "$REASON"; }
  [ -f "$CONFIG_DIR/$archive" ] || { REASON="снимок не найден: $CONFIG_DIR/$archive"; fail "$REASON"; }

  echo
  echo "  ВОССТАНОВЛЕНИЕ КОНФИГА из $archive"
  echo "  Будут перезаписаны: .env.production, certs/yandex-root.crt, deploy/conf.d/zakupki.conf"
  echo "  Живой vhost $LIVE_VHOST НЕ трогается (общая инфраструктура): при необходимости"
  echo "  скопируйте его вручную и перезагрузите infra-nginx."
  confirm_tty "--restore-config"

  ( umask 077; tar -xzf "$CONFIG_DIR/$archive" -C "$PORTAL_DIR" \
      .env.production certs/yandex-root.crt deploy/conf.d/zakupki.conf )
  chmod 600 "$PORTAL_DIR/.env.production"
  log "конфиг восстановлен из $archive"
}

# `|| true` на каждом пайплайне обязателен: без совпадений ls возвращает 2,
# pipefail протаскивает это наружу, и set -e убивает деплой между дампом и накатом.
rotate_dumps() {
  # shellcheck disable=SC2012  # имена дампов генерируем сами; ls -1t нужен ради сортировки по времени
  ls -1t "$BACKUP_DIR"/[0-9]*.dump 2>/dev/null | tail -n +$((KEEP_DUMPS + 1)) | while read -r old; do
    rm -f "$old" "${old%.dump}.meta"
  done || true
  # billhub эти файлы не ротирует никогда (его глоб [0-9]* их не ловит) — утечка диска.
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/prerestore-*.dump 2>/dev/null | tail -n +2 | xargs -r rm -f || true
}

prune_images() {
  [ "$NO_PRUNE" -eq 1 ] && { log "чистка образов пропущена (--no-prune)"; return 0; }
  local protect=("${CURRENT_BEFORE:-}" "${PREVIOUS_BEFORE:-}" "${COMMIT_SHA:-}" latest)
  # Реально запущенное защищаем даже при рассинхроне release.state.
  local c img
  for c in zakupki-api zakupki-web; do
    img="$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null || true)"
    [ -n "$img" ] && protect+=("${img##*:}")
  done
  local repo tag kept
  for repo in zakupki-api zakupki-web; do
    kept=0
    while read -r tag; do
      [ -z "$tag" ] || [ "$tag" = "<none>" ] && continue
      local p skip=0
      for p in "${protect[@]}"; do [ -n "$p" ] && [ "$tag" = "$p" ] && { skip=1; break; }; done
      [ "$skip" -eq 1 ] && continue
      kept=$((kept + 1)); [ "$kept" -le "$KEEP_RELEASES" ] && continue
      log "  удаляю $repo:$tag"
      docker rmi "$repo:$tag" >/dev/null 2>&1 || warn "  $repo:$tag занят — оставлен"
    done < <(docker image ls "$repo" --format '{{.Tag}}')
  done
}

# ЕДИНСТВЕННОЕ место, где скрипт выходит за границы портала: BuildKit-кэш общий
# с billhub/estimat. Чистка СТАРОГО кэша ничего не ломает — лишь замедляет
# ближайшую чужую сборку. Без неё диск растёт ~1.5 ГБ за сборку.
prune_cache() {
  [ "$NO_PRUNE" -eq 1 ] && return 0
  [ "${ZAK_PRUNE_CACHE:-1}" = "0" ] && return 0
  local age="$CACHE_AGE_NORMAL"
  if [ "$(disk_used_pct)" -ge "$DISK_TIGHT_PCT" ]; then
    age="$CACHE_AGE_TIGHT"
    warn "диск занят на $(disk_used_pct)% — ужесточаю чистку кэша до until=$age"
  fi
  log "чистка BuildKit-кэша старше $age (кэш ОБЩИЙ для всех порталов хоста)"
  CACHE_FREED="$(docker builder prune -f --filter "until=$age" 2>/dev/null | tail -1 || true)"
  [ -n "$CACHE_FREED" ] && log "  $CACHE_FREED"
}

confirm_tty() {
  local answer
  [ -r /dev/tty ] || fail "$1 требует интерактивного терминала (запустите из ssh-сессии с TTY)"
  printf '  Введите yes для продолжения: ' >&2
  read -r answer </dev/tty || answer=""
  [ "$answer" = "yes" ] || { REASON="операция отменена оператором"; fail "$REASON"; }
}

# ===========================================================================
# --restore-config в одиночку: без пересборки и без смены образов.
# ===========================================================================
if [ "$DO_RESTORE_CFG" -eq 1 ] && [ "$DO_PREVIOUS" -eq 0 ] && [ "$DO_RESTORE_DB" -eq 0 ]; then
  snapshot_config                        # текущее состояние — на случай ошибочного подтверждения
  restore_config_from "$RESTORE_CFG_ARG"
  log "конфиг на месте. Чтобы контейнеры его перечитали: deploy-zak"
  RESULT="ok"; write_report; trap - EXIT; exit 0
fi

# ===========================================================================
# Режимы отката: --previous и/или --restore-db (опционально с --restore-config).
# ===========================================================================
if [ "$ROLLBACK_MODE" -eq 1 ]; then
  if [ "$DO_PREVIOUS" -eq 1 ]; then
    [ -n "$PREVIOUS_BEFORE" ] || { REASON="в $RELEASE_STATE нет previous= — откатываться не на что"; fail "$REASON"; }
    TARGET_TAG="$PREVIOUS_BEFORE"
    # Образы обязаны существовать локально ДО остановки: иначе `up --no-build`
    # упадёт на попытке pull с невнятной ошибкой.
    for img in "zakupki-api:$TARGET_TAG" "zakupki-web:$TARGET_TAG"; do
      docker image inspect "$img" >/dev/null 2>&1 || {
        REASON="образ $img не найден локально (вычищен ретеншном?) — быстрый откат невозможен"
        fail "$REASON"; }
    done
  else
    TARGET_TAG="${CURRENT_BEFORE:-latest}"
  fi

  snapshot_config
  log "ВНИМАНИЕ: откат образов НЕ отменяет миграции БД; откат схемы — только --restore-db или PITR"

  # Конфиг восстанавливаем ДО остановки сервисов: контейнеры перечитают
  # .env.production при пересоздании ниже, отдельного перезапуска не нужно.
  [ "$DO_RESTORE_CFG" -eq 1 ] && restore_config_from "$RESTORE_CFG_ARG"

  if [ "$DO_RESTORE_DB" -eq 1 ]; then
    if [ -n "$RESTORE_DB_ARG" ]; then
      # Имя подставляется в команду контейнера — строгий набор символов.
      printf '%s' "$RESTORE_DB_ARG" | grep -qE '^[A-Za-z0-9][A-Za-z0-9._-]*\.dump$' \
        || { REASON="--restore-db принимает только имя файла *.dump из $BACKUP_DIR"; fail "$REASON"; }
      case "$RESTORE_DB_ARG" in *..*) REASON="недопустимое имя дампа"; fail "$REASON" ;; esac
      DUMP_FILE="$RESTORE_DB_ARG"
    else
      # shellcheck disable=SC2012  # имена дампов генерируем сами; ls -1t нужен ради сортировки по времени
      LATEST="$(ls -1t "$BACKUP_DIR"/[0-9]*.dump 2>/dev/null | head -1 || true)"
      [ -n "$LATEST" ] || { REASON="в $BACKUP_DIR нет дампов (создаются при deploy-zak --migrate)"; fail "$REASON"; }
      DUMP_FILE="$(basename "$LATEST")"
    fi
    DUMP_PATH="$BACKUP_DIR/$DUMP_FILE"
    [ -f "$DUMP_PATH" ] || { REASON="дамп не найден: $DUMP_PATH"; fail "$REASON"; }

    META="${DUMP_PATH%.dump}.meta"
    META_CREATED="" META_TARGET="" META_CURRENT=""
    if [ -f "$META" ]; then
      META_CREATED="$(grep -E '^created_at=' "$META" | cut -d= -f2- || true)"
      META_TARGET="$(grep -E '^target_commit=' "$META" | cut -d= -f2- || true)"
      META_CURRENT="$(grep -E '^current_before=' "$META" | cut -d= -f2- || true)"
    else
      warn "у дампа нет .meta — проверка совместимости код/БД невозможна"
    fi
    # Одиночный restore корректен, только пока код не ушёл вперёд от дампа.
    if [ "$DO_PREVIOUS" -eq 0 ] && [ -n "$META_CURRENT" ] && [ "$META_CURRENT" != "$CURRENT_BEFORE" ]; then
      REASON="код уже переключён (current=${CURRENT_BEFORE:-пусто}, дамп снят при ${META_CURRENT}) — откатывайте вместе: deploy-zak --previous --restore-db"
      fail "$REASON"
    fi

    ensure_db_tools_image
    echo
    echo "  ВОССТАНОВЛЕНИЕ БД ИЗ ДАМПА (destructive)"
    echo "  Файл:               $DUMP_FILE"
    echo "  Снят (UTC):         ${META_CREATED:-неизвестно}"
    echo "  Перед миграцией на: ${META_TARGET:-?} (код на момент дампа: ${META_CURRENT:-?})"
    echo "  ВСЕ ДАННЫЕ, записанные в БД после снятия дампа, БУДУТ ПОТЕРЯНЫ."
    echo "  Загруженные документы (volume zakupki-storage) дамп НЕ покрывает:"
    echo "  ссылки на файлы в БД и сами файлы могут разойтись."
    confirm_tty "--restore-db"

    log "стоп api (восстановление БД)"
    "${COMPOSE[@]}" stop api || true
    API_WAS_STOPPED=1

    PRE_RESTORE_DUMP="prerestore-$(date -u +%Y%m%dT%H%M%SZ).dump"
    log "аварийный дамп текущего состояния: db-backups/$PRE_RESTORE_DUMP"
    "${COMPOSE[@]}" run --rm -T db-tools sh -c \
      "pg_dump --dbname=\"\$DATABASE_URL\" -Fc -f '/backups/$PRE_RESTORE_DUMP'" \
      || { REASON="pre-restore дамп провалился — восстановление НЕ начиналось, БД не тронута"; fail "$REASON"; }
    chmod 600 "$BACKUP_DIR/$PRE_RESTORE_DUMP" || true

    log "pg_restore из $DUMP_FILE (single-transaction, clean)"
    RESTORE_DB_TOUCHED=1
    "${COMPOSE[@]}" run --rm -T db-tools sh -c \
      "pg_restore --dbname=\"\$DATABASE_URL\" --single-transaction --exit-on-error --clean --if-exists --no-owner '/backups/$DUMP_FILE'" \
      || { REASON="pg_restore провалился"; fail "$REASON"; }
    RESTORE_DB_TOUCHED=0
    log "restore ok (журнал _migrations восстановлен вместе со схемой)"
    rotate_dumps
  fi

  ROLLBACK_UP_STARTED=1
  log "up -d --no-build api web (тег $TARGET_TAG)"
  ZAK_TAG="$TARGET_TAG" "${COMPOSE[@]}" up -d --no-build api web
  ROLLBACK_UP_STARTED=0; API_WAS_STOPPED=0

  if [ "$DO_PREVIOUS" -eq 1 ]; then
    # Swap: state отражает фактически запущенное, повторный --previous вернёт назад.
    write_release_state "$CURRENT_BEFORE" "$TARGET_TAG"
    log "release.state: current=$TARGET_TAG previous=$CURRENT_BEFORE"
  fi

  if health_check; then
    docker tag "zakupki-api:$TARGET_TAG" zakupki-api:latest 2>/dev/null || true
    docker tag "zakupki-web:$TARGET_TAG" zakupki-web:latest 2>/dev/null || true
  else
    warn "health не подтверждён — :latest не переставлен"
  fi

  RESULT="ok"; write_report; trap - EXIT
  log "Готово ($ACTION): zakupki @ $TARGET_TAG"
  exit 0
fi

# ===========================================================================
# Обычный деплой.
# ===========================================================================
log "preflight ($PORTAL_DIR)"
[ -f "$PORTAL_DIR/.env.production" ]       || { REASON="нет .env.production"; fail "$REASON"; }
[ -f "$PORTAL_DIR/certs/yandex-root.crt" ] || { REASON="нет certs/yandex-root.crt"; fail "$REASON"; }
[ -f "$COMPOSE_FILE" ]                     || { REASON="нет $COMPOSE_FILE"; fail "$REASON"; }
docker info >/dev/null 2>&1                || { REASON="docker недоступен"; fail "$REASON"; }
docker network inspect edge >/dev/null 2>&1 || { REASON="нет docker-сети 'edge'"; fail "$REASON"; }
git_c rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 \
  || { REASON="у ветки нет upstream — git pull невозможен"; fail "$REASON"; }
[ -z "$(git_c status --porcelain)" ] \
  || { REASON="рабочее дерево не чистое — образ должен собираться из точного коммита"; fail "$REASON"; }

# Осиротевшие one-off контейнеры от прерванных `compose run`.
docker ps -aq --filter "name=^zakupki-.*-run-" 2>/dev/null | xargs -r docker rm -f >/dev/null 2>&1 || true

if [ "$(disk_free_gb)" -lt "$DISK_MIN_GB" ]; then
  warn "свободно $(disk_free_gb) ГБ (< $DISK_MIN_GB) — пробую освободить до сборки"
  snapshot_config; CFG_SNAPSHOT=""   # снимок до любых мутаций, но prune его не касается
  prune_images; prune_cache
  [ "$(disk_free_gb)" -ge "$DISK_MIN_GB" ] \
    || { REASON="на диске $(disk_free_gb) ГБ — меньше $DISK_MIN_GB даже после чистки; заполнение убьёт ВСЕ порталы хоста"; fail "$REASON"; }
fi

# Снимок конфига — до pull: deploy/conf.d/zakupki.conf трекается git'ом, и pull
# его перепишет; снимок после pull потерял бы прежнюю версию vhost.
[ -n "$CFG_SNAPSHOT" ] || snapshot_config

# SHA до pull фиксируем явно: reflog (HEAD@{1}) для этого не годится — при
# no-op pull он указывает на посторонний старый коммит, а не на то, что запущено.
PREPULL_SHA="$(git_c rev-parse --short HEAD)"

log "git pull --ff-only"
git_c pull --ff-only || { REASON="git pull провалился"; fail "$REASON"; }
[ -z "$(git_c status --porcelain)" ] || { REASON="дерево стало грязным после pull"; fail "$REASON"; }

COMMIT_SHA="$(git_c rev-parse --short HEAD)"
# Экспорт ДО любого compose-вызова: иначе ${ZAK_TAG:-latest} подставит СТАРЫЙ образ,
# и проверка миграций посчитает статус по старому коду.
export ZAK_TAG="$COMMIT_SHA"
TARGET_TAG="$COMMIT_SHA"
log "commit: $COMMIT_SHA (теги образов zakupki-*:$COMMIT_SHA)"

# Первый запуск на живом проде: release.state пуст, но контейнеры работают.
# Метим фактически запущенные образы пред-pull SHA, чтобы --previous стал доступен
# уже после ЭТОГО деплоя, а не следующего.
#
# Только если pull реально сдвинул HEAD: тогда запущенное — это PREPULL_SHA.
# Если pull ничего не подтянул, мы пересобираем тот же код, откатываться некуда,
# и честнее оставить previous пустым, чем выдумать метку.
#
# Метка — предположение (верно, если прошлый деплой шёл через git pull + деплой),
# но целью отката остаётся фактический image ID, поэтому ошибка метки косметическая.
if [ -z "$CURRENT_BEFORE" ] && [ "$PREPULL_SHA" != "$COMMIT_SHA" ]; then
  tagged=0
  for svc in api web; do
    img="$(docker inspect -f '{{.Image}}' "zakupki-$svc" 2>/dev/null || true)"
    if [ -n "$img" ] && docker tag "$img" "zakupki-$svc:$PREPULL_SHA" >/dev/null 2>&1; then
      tagged=1
    fi
  done
  if [ "$tagged" -eq 1 ]; then
    CURRENT_BEFORE="$PREPULL_SHA"
    log "bootstrap: запущенные образы помечены как $PREPULL_SHA (предположительно)"
  fi
fi

log "build (zakupki-api:$COMMIT_SHA, zakupki-web:$COMMIT_SHA)"
"${COMPOSE[@]}" build api web || { REASON="сборка провалилась"; fail "$REASON"; }
BUILT_TAG="$COMMIT_SHA"

# Проверка миграций по КОДУ ВОЗВРАТА, а не грепом JSON: так «есть pending» (3)
# отличимо от «БД недоступна» (1). Fail-closed: любой иной код — отказ.
log "проверка статуса миграций"
set +e
"${COMPOSE[@]}" run --rm -T migrate pnpm --silent --filter @zakupki/db db:migrate:check
mig_rc=$?
set -e
case "$mig_rc" in
  0) PENDING=0; log "  миграции применены" ;;
  3) PENDING=1; log "  есть неприменённые миграции" ;;
  *) REASON="не удалось определить статус миграций (код $mig_rc) — БД недоступна или журнал разошёлся с файлами"
     fail "$REASON" ;;
esac
if [ "$PENDING" -eq 1 ] && [ "$DO_MIGRATE" -eq 0 ]; then
  REASON="есть неприменённые миграции — запустите с --migrate"
  fail "$REASON"
fi

# Дамп снимаем ТОЛЬКО когда есть что накатывать: иначе повторные --migrate
# вытеснят из ретеншна настоящие предмиграционные дампы бесполезными.
if [ "$DO_MIGRATE" -eq 1 ] && [ "$PENDING" -eq 1 ]; then
  ensure_db_tools_image

  if [ "$DO_MAINTENANCE" -eq 1 ]; then
    log "окно обслуживания: стоп api (api — единственный писатель, RPO = 0)"
    "${COMPOSE[@]}" stop api || true
    API_WAS_STOPPED=1
  fi

  DUMP_TS="$(date -u +%Y%m%dT%H%M%SZ)"
  DUMP_FILE="${DUMP_TS}-${COMMIT_SHA}.dump"
  log "дамп БД перед накатом: db-backups/$DUMP_FILE"
  # $DATABASE_URL раскрывается ВНУТРИ контейнера — на хосте в argv секрета нет.
  "${COMPOSE[@]}" run --rm -T db-tools sh -c \
    "pg_dump --dbname=\"\$DATABASE_URL\" -Fc -f '/backups/$DUMP_FILE'" \
    || { REASON="дамп БД провалился — миграции не запускались"; fail "$REASON"; }
  chmod 600 "$BACKUP_DIR/$DUMP_FILE"
  {
    printf 'created_at=%s\n'     "$DUMP_TS"
    printf 'target_commit=%s\n'  "$COMMIT_SHA"
    printf 'current_before=%s\n' "$CURRENT_BEFORE"
    printf 'maintenance=%s\n'    "$DO_MAINTENANCE"
  } >"$BACKUP_DIR/${DUMP_FILE%.dump}.meta"
  chmod 600 "$BACKUP_DIR/${DUMP_FILE%.dump}.meta"
  rotate_dumps

  log "накат новых миграций"
  MIGRATION_ATTEMPTED=1
  "${COMPOSE[@]}" run --rm -T migrate || { REASON="миграция провалилась"; fail "$REASON"; }
  MIGRATION_ATTEMPTED=0
elif [ "$DO_MIGRATE" -eq 1 ]; then
  log "--migrate передан, но накатывать нечего — дамп не снимаем"
fi

log "up -d api web"
"${COMPOSE[@]}" up -d api web || { REASON="запуск сервисов провалился"; fail "$REASON"; }
API_WAS_STOPPED=0

# release.state — ФАКТ (что реально запущено), пишется до health: иначе --previous
# сработает от устаревшего current и переключит не туда.
write_release_state "$CURRENT_BEFORE" "$COMMIT_SHA"

# health гейтит «благословение», но НЕ откатывает автоматически: после применённой
# миграции авто-откат кода дал бы непроверенную связку «старый код + новая схема»,
# а любой блип БД превратился бы в лишний churn контейнеров. Оператор рядом,
# у него есть deploy-zak --previous.
if health_check; then
  docker tag "zakupki-api:$COMMIT_SHA" zakupki-api:latest
  docker tag "zakupki-web:$COMMIT_SHA" zakupki-web:latest
  BUILT_TAG=""
else
  RESULT="degraded"
  warn "health НЕ подтверждён за 5 попыток. Сервисы запущены на $COMMIT_SHA,"
  warn ":latest оставлен на прошлом здоровом релизе."
  warn "Логи:   docker compose -f $COMPOSE_FILE -p zakupki logs --tail=50 api"
  warn "Откат:  deploy-zak --previous"
  write_report; trap - EXIT
  exit 1
fi

# Внешний health — отдельно: он проверяет infra-nginx/TLS/DNS, а не наш код.
if curl -fsS -m 10 "$HEALTH_URL" >/dev/null 2>&1; then
  log "внешний health: ok ($HEALTH_URL)"
else
  warn "внешний health недоступен ($HEALTH_URL) — проверьте infra-nginx/TLS/DNS."
  warn "Приложение при этом здорово изнутри; на выкатку это не влияет."
fi

prune_images
prune_cache

write_report; trap - EXIT
log "Готово: zakupki @ $COMMIT_SHA"
