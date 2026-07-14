# Деплой zakupki на VPS — план

**Домен:** zak.su10.ru · **VPS:** 89.232.188.170 (Ubuntu 24.04, Yandex Cloud) · **вход:** `corpsu` (NOPASSWD sudo)
**Подключение:** только через `deploy/vps.sh` (secret-safe). Правила: `deploy/SECURITY.md`.
**Базовый бэкап:** `/home/corpsu/zakupki-deploy-backups/20260713-214729` (создан до изменений).

---

## A. Что на VPS (разведка, read-only)

- **Хостового nginx НЕТ.** Порты 80/443 держит контейнер **`infra-nginx`** (nginx:alpine) — общий reverse-proxy на все порталы.
- TLS — контейнер **`infra-certbot`** (Let's Encrypt, webroot). Сертификаты: `/opt/infra/nginx/certbot/conf` (→ `/etc/letsencrypt`), webroot: `/opt/infra/nginx/certbot/www` (→ `/var/www/certbot`). Уже выпущены: `auth.su10.ru`, `estimat.su10.ru`, `rp.su10.ru`.
- Vhost'ы порталов: `/opt/infra/nginx/conf.d/<portal>.conf` (bind-mount ro в контейнер). Проксирование — по имени контейнера через docker-DNS (`resolver 127.0.0.11`, `set $api ...; proxy_pass http://$api:3000`).
- Общая docker-сеть **`edge`** (external, bridge): в неё входят infra-nginx и web/api всех порталов.
- Порталы: `/opt/portals/{billhub,estimat}` — git-репы, свои `docker-compose`, владелец **corpsu**. Процедура «добавить портал» задокументирована в `/opt/infra/nginx/README.md`.
- Node/pnpm/certbot на хосте отсутствуют — всё в контейнерах. Хостовый PostgreSQL 17 активен, но **нам не нужен** (у нас Yandex Managed PG). ufw активен: открыты 22/80/443.
- **DNS `zak.su10.ru → 89.232.188.170` уже резолвится.** Свободных «своих» портов занимать не нужно — API/web доступны только внутри сети `edge`, наружу торчит только infra-nginx.

## B. Архитектура (решение)

Первоначальный вариант «host nginx + systemd» здесь **неприменим** (конфликт за 80/443, ломает паттерн). Разворачиваем как **Docker Compose стек за `infra-nginx`** — точно как estimat/billhub:

```
Internet ──443──> infra-nginx (существующий)
                    ├─ location /api/ ─> zakupki-api:3000   (Fastify, tsx)
                    └─ location /     ─> zakupki-web:80      (SPA, nginx:alpine, static)
zakupki-api ──SSL verify-full──> Yandex Managed PostgreSQL (внешний)
```

- Изоляция — через контейнеры (внутри API работает под непривилегированным `node`, не root) + отдельный compose-проект `zakupki` в `/opt/portals/zakupki`. Отдельный Linux-юзер `zakupki` — опционально (см. §I), соседи его не используют.
- Стек **не слушает** хостовые порты; наружу только infra-nginx.

## C. Изменения в репозитории

**Код (production-readiness):**
1. `packages/db`: чтение `DATABASE_SSL_CA` из файла + `ssl:{rejectUnauthorized:true, ca}` в `loadEnv.ts` (хелпер), `client.ts`, `migrate.ts`, `reset.ts`. Абсолютные пути поддерживаются.
2. `apps/api/src/config/env.ts`: добавить `TRUST_PROXY` (bool). `server.ts`: `Fastify({ trustProxy: env.TRUST_PROXY })` — корректный client-IP/rate-limit за прокси. (cookie secure/sameSite/CSRF уже верны.)
3. `.env.example`: `DATABASE_SSL_CA=temp/root.crt`, `TRUST_PROXY=false`, прод-комментарии. Dev-дефолты не ломаются.
4. `.gitignore`: уже блокирует `.env*`, `*.crt/*.pem/*.key`, `temp/`, `deploy/vps.env`.

**Деплой-артефакты (новые файлы в репо, без секретов):**
- `deploy/Dockerfile.api` — Node 20, pnpm, монорепо, запуск `pnpm --filter @zakupki/api start` (tsx), USER node.
- `deploy/Dockerfile.web` — multi-stage: `vite build` → nginx:alpine со статикой.
- `deploy/web-nginx.conf` — внутренний конфиг web-контейнера (SPA `try_files … /index.html`).
- `deploy/docker-compose.yml` — сервисы `api`+`web` (теги `${ZAK_TAG:-latest}`, сеть `edge` external, volume для storage, `env_file: .env.production`, mount CA-сертификата ro) + профильные one-off `migrate` и `db-tools` (postgres:17 для pg_dump/pg_restore) на compose-дефолтной сети.
- `deploy/conf.d/zakupki.conf` — vhost для infra-nginx: 80 (ACME+redirect), 443 (`/api/` → api:3000 с `proxy_buffering off` для SSE, `/` → web:80), `client_max_body_size 30m`, security-заголовки — по образцу billhub.conf.
- `deploy/.env.production.example` — шаблон серверного env (без секретов).
- `deploy/deploy-zak.sh` — управляемый деплой; ставится симлинком в `/usr/local/bin/deploy-zak`, работает из любого каталога. Флаги: `--migrate`, `--maintenance`, `--previous`, `--restore-db`, `--restore-config`, `--status`, `--no-prune`. Никогда не запускает destructive `db:reset`.
- `deploy/make-prod-env.sh` — генерит `.env.production` (prod-конфиг + секреты из локального `.env`), **не печатая значений**.
- README: раздел «Production / VPS».

## D. Раскладка на сервере

```
/opt/portals/zakupki/            (владелец corpsu; исходники rsync-ом из локали, без .git/.env/node_modules)
  deploy/… (Dockerfile.api, Dockerfile.web, docker-compose.yml, web-nginx.conf)
  .env.production                (chmod 600, секреты; gitignored; НЕ в репо)
  certs/yandex-root.crt          (CA Yandex; из temp/root.crt; mount ro в api)
  .local/storage/  (или volume)  (STORAGE_ROOT, persist между деплоями)
/opt/infra/nginx/conf.d/zakupki.conf   (копия deploy/conf.d/zakupki.conf)
```

## E. Порядок деплоя (идемпотентно, не трогая соседей)

Разовые шаги первичного развёртывания (CA, `.env.production`, TLS, vhost, симлинк
`/usr/local/bin/deploy-zak`) — см. README, «Порядок первичного развёртывания».
Дальше портал обновляется одной командой `deploy-zak [--migrate]`, которая делает:

1. **Взаимоисключения флагов** → `--help`/`--status` выходят без мутаций.
2. **Bootstrap** `/var/lib/zakupki/deploy` (пока мы ещё root) → **самоповышение** до владельца портала (иначе образы и state станут root-owned).
3. **flock** от параллельных запусков; чтение `release.state`; `trap recover EXIT`.
4. **Preflight** до git-операций: чистое дерево, upstream, неинтерактивный git, `.env.production`, CA, compose, docker, сеть `edge`, уборка осиротевших `zakupki-*-run-*`, свободно ≥ 8 ГБ (иначе чистка и повторная проверка).
5. **Снимок конфига** — до `git pull`: `deploy/conf.d/zakupki.conf` трекается git'ом, и pull перепишет прежний vhost.
6. **`git pull --ff-only`** (без `reset --hard`, без `--branch`: правило проекта — только main).
7. `COMMIT_SHA` → **`export ZAK_TAG`** до любого compose-вызова, иначе проверка миграций посчитает статус по старому образу.
8. **Bootstrap-тег**: если `release.state` пуст, а контейнеры работают — пометить их пред-pull SHA, чтобы `--previous` стал доступен уже после этого деплоя.
9. **build** `api web` с тегом `:<sha>`.
10. **Проверка миграций** по коду возврата `db:migrate:check` (`0` чисто / `3` pending / иначе fail-closed). Есть pending без `--migrate` → отказ **до** смены контейнеров.
11. **`--migrate` И есть pending**: `pg_dump -Fc` + `.meta` + ротация → накат. Дамп только при реальном pending, иначе повторные `--migrate` вытеснят настоящие дампы. `--maintenance` останавливает api до дампа (RPO = 0).
12. **`up -d api web`** → запись `release.state` как **факта** (до health, иначе `--previous` уйдёт от устаревшего `current`).
13. **health** изнутри контейнера → гейтит перестановку `:latest`; провал = ненулевой код, но **не** авто-откат.
14. **Внешний health** `https://zak.su10.ru/api/v1/health` — отдельно, диагностика infra-nginx/TLS/DNS.
15. **Ретеншн** образов и BuildKit-кэша → **JSON-отчёт** в `reports/`.

Расширения citext/pgcrypto — заранее в Yandex Console (у обычного пользователя Managed PG нет прав на `CREATE EXTENSION`).

## F. Секреты

- Локально: `/root/.config/zakupki/vps.env` (SSH). Серверный `.env.production` (600). CA — артефакт, не коммитим.
- Секреты переносятся `scp`/генератором — **без отображения в чате/истории** (`deploy/SECURITY.md`).
- Секреты для прод-env: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (+ опц. SMTP/DaData). Остальное — prod-конфиг (`NODE_ENV=production`, `WEB_ORIGIN=PUBLIC_WEB_URL=https://zak.su10.ru`, `TRUST_PROXY=true`, `API_HOST=0.0.0.0` внутри контейнера, `STORAGE_ROOT=/var/lib/zakupki/storage`, `DATABASE_SSL_CA=/app/certs/yandex-root.crt`).

## G. Откат

Образы тегируются commit-SHA, `release.state` хранит `current`/`previous`, поэтому откат —
переключение тега без пересборки:

- **Код:** `deploy-zak --previous` (секунды, `up -d --no-build`). Повторный `--previous` возвращает обратно. Схему **не** откатывает.
- **Код + БД:** `deploy-zak --previous --restore-db[=файл]` — если новый код принёс несовместимую миграцию.
- **Только БД:** `deploy-zak --restore-db[=файл]` — разрешён, только пока код не ушёл вперёд от дампа (guard по `.meta`). Альтернатива с лучшим RPO — PITR Yandex Managed PG.
- **Конфиг:** `deploy-zak --restore-config[=архив]` из `config-backups/`. Живой vhost не трогается автоматически — это общая инфраструктура.
- **Снять портал целиком:** удалить vhost `zakupki.conf` из conf.d → `nginx -t && nginx -s reload` (соседи не затронуты) + `docker compose -p zakupki down` (свой проект).
- Инфра-бэкап до первичного развёртывания: `zakupki-deploy-backups/<ts>`. Мы только **добавляем** файлы/контейнеры/сеть-членство, существующие конфиги соседей не редактируем.

Ограничения, которые надо знать до отката: `zakupki-storage` (загруженные документы) в дамп
**не входит** — RPO файлов ≠ RPO базы; журнал `_migrations` восстанавливается вместе со схемой,
поэтому следующий деплой накатит миграции заново; `--restore-*` требуют TTY.

## H. Критерии готовности

- `https://zak.su10.ru` отдаёт SPA; `/api/v1/health` = `{status:ok}`; логин/куки/CSRF работают за прокси; загрузка файлов ≤25 МБ проходит.
- Соседние сайты (estimat/billhub/keycloak) продолжают работать; `docker ps` без изменений по ним; `nginx -t` ok.
- Локальный dev не сломан: `pnpm dev`, API :3000, `pnpm build`/typecheck зелёные.

## Результат (as-built, развёрнуто)

Портал развёрнут и работает: **https://zak.su10.ru** (`/api/v1/health` = ok; `/api/v1/categories`,
`/api/v1/tenders` отдают данные из Yandex PG; SPA 200; HTTP→HTTPS 301). Соседи (estimat/rp/auth)
не затронуты (все 200), `nginx -t` ok.

- Код: `/opt/portals/zakupki` (git clone по публичному HTTPS). Обновление: `deploy-zak [--migrate]` (симлинк на `deploy/deploy-zak.sh`, работает из любого каталога).
- Состояние деплоя: `/var/lib/zakupki/deploy/` — `release.state`, `config-backups/` (700), `db-backups/` (700), `reports/`, `deploy.lock`. Не путать с `STORAGE_ROOT=/var/lib/zakupki/storage` — тот путь внутри контейнера.
- Контейнеры: `zakupki-api` (:3000) + `zakupki-web` (:80) в сети `edge`. Storage: volume `zakupki_zakupki-storage`.
- Секреты: `/opt/portals/zakupki/.env.production` (600); CA: `certs/yandex-root.crt`.
- vhost: `/opt/infra/nginx/conf.d/zakupki.conf`; TLS `zak.su10.ru` (Let's Encrypt, до 2026-10-11).
- Бэкап инфры до изменений: `/home/corpsu/zakupki-deploy-backups/20260713-214729`.
- Open item: после автопродления серта нужен reload infra-nginx (общая инфра-задача всех порталов).

## I. Решения (подтверждены пользователем)

1. **Модель деплоя:** Docker Compose за infra-nginx ✓
2. **Изоляция:** по конвенции соседей — `/opt/portals/zakupki` под corpsu, контейнер API под `node` ✓
3. **Источник кода:** **git clone/pull на ВМ** (не rsync). Порядок: сначала commit+push изменений в main → на ВМ `git clone` (или `git pull`) → `.env.production` копируется отдельно по ssh (secret-safe). Репозиторий публичный, clone по HTTPS без ключей.
4. **Модель релизов:** образы тегируются commit-SHA, `:latest` — подвижный алиас на последний прошедший health. `release.state` (`current`/`previous`) → `--previous` = переключение тега без пересборки. Отказ при грязном дереве: тег обязан однозначно определять то, что запущено.
5. **Состояние деплоя вне репозитория:** `/var/lib/zakupki/deploy` (а не в `$PORTAL_DIR`) — переживает пересоздание репо. Bootstrap делается в root-окне до самоповышения, т.к. `/var/lib` принадлежит root.
6. **Бэкапы:** снимок конфига — перед каждой изменяющей операцией (10 шт, копеечные); `pg_dump -Fc` — только при `--migrate` **и только если есть pending** (иначе повторные `--migrate` вытеснят из ретеншна настоящие предмиграционные дампы). 3 предмиграционных + 1 аварийный `prerestore-*`.
7. **Проверка миграций по коду возврата** (`db:migrate:check`: 0/3/1), а не грепом JSON: только так «есть pending» отличимо от «БД недоступна». Fail-closed, bypass-флага нет.
8. **Health гейтит `:latest`, но не откатывает автоматически.** `release.state` пишется как факт до health. Причина: после применённой миграции авто-откат кода дал бы непроверенную связку «старый код + новая схема», а блип БД превратился бы в лишний churn. Оператор рядом, у него есть `--previous`.
9. **Ретеншн portal-scoped:** только `docker rmi zakupki-{api,web}:<tag>` по белому списку. `docker image prune -a` и `system prune` **запрещены** — они снесут образы соседей без запущенных контейнеров (`certbot/certbot`, `keycloak-config-cli`, `curlimages/curl`).
10. **Чистка BuildKit-кэша — единственный выход за границы портала** (кэш общий с billhub/estimat). Оправдано: кэш 38 ГБ при диске 72%, заполнение убьёт все порталы хоста; чистка старого кэша ничего не ломает, лишь замедляет ближайшую чужую сборку. Отключается `--no-prune`.
11. **`--branch` и `reset --hard` не добавляем:** противоречат правилу «строго в main, без фичевых веток», а `reset --hard` конфликтует с dirty-guard.
12. **pg_dump ходит к БД libpq-путём, приложение — через `ssl`-объект postgres.js.** Отсюда `PGSSLROOTCERT` в `db-tools`: `DATABASE_URL` несёт `sslmode=verify-full`, но не `sslrootcert`, а `DATABASE_SSL_CA` читает только наш `loadEnv.ts`. Два разных механизма TLS — намеренно.
