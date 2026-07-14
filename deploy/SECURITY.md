# Deploy security & secret-handling rules

These rules are **mandatory** for anyone (human or AI assistant) operating the
zakupki deployment. The overriding goals: **never leak a secret into the
chat/transcript or shell history**, and **never disturb other production sites
on the shared VPS**.

## 0. Подключение к VPS

Подключаться **только** через `deploy/vps.sh` (secret-safe — passphrase грузится через
`SSH_ASKPASS`, не попадает в argv/вывод):

```bash
deploy/vps.sh check                       # проверка связи
deploy/vps.sh ssh '<remote cmd>'          # команда на ВМ
deploy/vps.sh ssh 'bash -s' < script.sh   # прогнать скрипт (без мучений с кавычками)
deploy/vps.sh scp-up  LOCAL  REMOTE       # загрузка файла
deploy/vps.sh scp-down REMOTE LOCAL       # выгрузка файла
```

Креды живут **вне репо**, в root-only `/root/.config/zakupki/vps.env` (chmod 600):
`VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KEY_PASSPHRASE`
(шаблон — `deploy/vps.env.example`). Ключ ED25519 с passphrase; рядом с приватным ключом
должен лежать `.pub` (обёртка создаёт его из ssh-agent при необходимости) — иначе
`IdentitiesOnly=yes` не сопоставит ключ и будет «Permission denied (publickey)».
Первый вызов после ребута сам перегружает ключ в agent из сохранённого passphrase.

## 1. Secrets never appear in commands or output

- Secrets live **only** in files outside git:
  - Local machine: `/root/.config/zakupki/vps.env` (chmod 600, root-only) — SSH creds.
  - VPS: `/opt/portals/zakupki/.env.production` (chmod 600, owner `corpsu`) — app env,
    подаётся в контейнеры через compose `env_file`.
- **Never** `cat`, `echo`, `printf`, or `env` a file/variable that contains a
  secret (DB password, JWT secrets, SSH passphrase, SMTP/DaData tokens).
- To inspect a secret file, check **keys only**, never values, e.g.
  `grep -oE '^[A-Z_]+=' file` or `cut -d= -f1`.
- When a command needs a secret, pass it via env/`SSH_ASKPASS`/`env_file`
  — never as a command-line argument (argv is visible in `ps`).
- Connect with `deploy/vps.sh`, which loads the key passphrase through
  `SSH_ASKPASS` so it never reaches argv or output.

**Принятое исключение — `pg_dump`/`pg_restore`.** `deploy-zak` вызывает их как
`sh -c "pg_dump --dbname=\"\$DATABASE_URL\" …"`, то есть переменная раскрывается
**внутри** контейнера (на хосте в argv `docker compose run` секрета нет), но развёрнутый
URL виден в argv процесса внутри контейнера — а значит, root'у хоста через `/proc` на
время дампа. Это осознанно принято: тот, кто имеет root на хосте, и так читает
`.env.production`, дополнительной поверхности не возникает. Обойти через `PGDATABASE`
нельзя — libpq раскрывает URI только у явного ключа `dbname`, а `PGDATABASE`
подставляется как default уже после раскрытия, и подключение уходит в дефолтный сокет
(проверено).

## 2. `.env` / certs / keys are never committed

- `.gitignore` blocks `.env`, `.env.*` (except `.env.example`), `*.crt`, `*.pem`,
  `*.key`, `temp/`, `deploy/vps.env`, `deploy/*.local.*`.
- The Yandex CA cert is a deploy artifact placed on the server, **not** committed.
- Before every commit: `git status` and `git diff --cached` to confirm no secret,
  cert, or key is staged.

## 3. Do no harm to other sites on the VPS

Архитектура — Docker Compose за общим контейнером `infra-nginx` (хостового nginx и
systemd-юнитов у портала **нет**, портов наружу тоже: доступ только через `infra-nginx`
в сети `edge`). Портал живёт в `/opt/portals/zakupki` под `corpsu` — тем же владельцем,
что у соседей `estimat`/`billhub`; контейнер API работает под `node`.

- **Back up first**: `deploy-zak` снимает снимок конфига перед каждой изменяющей
  операцией; инфра-бэкап до первичного развёртывания — `zakupki-deploy-backups/<ts>`.
- Работать **только со своим** compose-проектом: `docker compose -p zakupki …`. Никогда
  не останавливать и не пересоздавать контейнеры, которые вы не создавали.
- Добавлять **новый** vhost `zak.su10.ru` в `/opt/infra/nginx/conf.d/` — никогда не
  редактировать блоки соседей. Всегда `docker exec infra-nginx nginx -t` перед
  `nginx -s reload`.
- **Категорически запрещены `docker image prune -a`, `docker system prune`** и удаление
  чужих образов, volume'ов и сетей: они снесут образы без постоянно запущенных
  контейнеров (`certbot/certbot`, `keycloak-config-cli`, `curlimages/curl`) и сломают
  соседей. Чистить только по белому списку: `docker rmi zakupki-api:<tag>` /
  `zakupki-web:<tag>`.
- Исключение, требующее осознанности: `docker builder prune --filter until=…` — кэш
  BuildKit **общий** для всех порталов хоста. Чистка старого кэша ничего не ломает
  (лишь замедляет ближайшую чужую сборку), но это единственная операция `deploy-zak`,
  выходящая за границы портала. Отключается `--no-prune`.

## 4. Дампы и снимки конфига содержат секреты

`deploy-zak` создаёт в `/var/lib/zakupki/deploy/`:

- `db-backups/` (chmod 700; файлы 600) — `pg_dump -Fc` полной базы: **персональные данные
  и хэши паролей/токенов**. Не выносить наружу в открытом виде, не класть в репозиторий,
  не прикреплять к тикетам.
- `config-backups/` (chmod 700; файлы 600) — tar.gz с `.env.production`, то есть **все
  прод-секреты** в одном файле. Тот же режим обращения.

Права выставляет сам скрипт (`umask 077` + явный `chmod`), а `db-tools` работает под UID
деплой-пользователя, чтобы дампы не оказались root-owned. Проверять после операций:
`ls -l /var/lib/zakupki/deploy/db-backups`.

## 5. Dev и prod могут смотреть в одну базу

`deploy/make-prod-env.sh` копирует `DATABASE_URL` из локального `.env` в
`.env.production` **дословно**. Если локальный `.env` указывает на управляемый кластер
Yandex (порт `6432`), то `pnpm db:reset` — а он начинается с `DROP SCHEMA public CASCADE` —
**уничтожит продовую схему с локальной машины**. Перед любым `db:reset`/`db:seed`
убедитесь, что `DATABASE_URL` указывает на локальный PostgreSQL. Интеграционные тесты
раннера миграций запускать только против одноразовой БД с **явно заданным** URL, никогда
против ambient `.env`. Разделение dev/prod баз — открытая задача.

## 6. Session hygiene

- Keep the number of concurrent SSH sessions low (avoid tripping fail2ban / rate
  limits). Reuse one connection where possible.
- Reboot note: the local ssh-agent socket does not survive a reboot — the first
  `deploy/vps.sh` call after boot re-loads the key automatically (from the stored
  passphrase) or prompts once.
