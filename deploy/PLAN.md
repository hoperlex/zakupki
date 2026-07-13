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
- `deploy/docker-compose.yml` — сервисы `api`+`web`, сеть `edge` (external), volume для storage, `env_file: .env.production`, mount CA-сертификата ro.
- `deploy/conf.d/zakupki.conf` — vhost для infra-nginx: 80 (ACME+redirect), 443 (`/api/` → api:3000 с `proxy_buffering off` для SSE, `/` → web:80), `client_max_body_size 30m`, security-заголовки — по образцу billhub.conf.
- `deploy/.env.production.example` — шаблон серверного env (без секретов).
- `deploy/deploy.sh` — управляемый деплой (build → migrate → up → nginx reload), без destructive `db:reset`.
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

1. **Бэкап** (сделан) + повторный снапшот перед мутациями.
2. **rsync** исходников в `/opt/portals/zakupki` (исключая `.git .env node_modules dist .local`).
3. **CA-сертификат**: положить `temp/root.crt` → `/opt/portals/zakupki/certs/yandex-root.crt` (scp, без вывода).
4. **`.env.production`**: сгенерировать и залить (secret-safe), `chmod 600`.
5. **build**: `docker compose -p zakupki build`.
6. **Миграции**: `docker compose -p zakupki run --rm api pnpm --filter @zakupki/db db:migrate` (с CA; без reset). Расширения citext/pgcrypto — заранее в Yandex Console.
7. **Запуск**: `docker compose -p zakupki up -d api web` (входят в `edge`).
8. **TLS**: выпустить сертификат `zak.su10.ru` через infra-certbot (webroot; ACME обслуживает `00-default.conf`, пока vhost не добавлен).
9. **vhost**: скопировать `zakupki.conf` в `/opt/infra/nginx/conf.d/`, `docker exec infra-nginx nginx -t` → `nginx -s reload`.
10. **Проверка**: `https://zak.su10.ru/api/v1/health` = ok; открыть портал; логин.

## F. Секреты

- Локально: `/root/.config/zakupki/vps.env` (SSH). Серверный `.env.production` (600). CA — артефакт, не коммитим.
- Секреты переносятся `scp`/генератором — **без отображения в чате/истории** (`deploy/SECURITY.md`).
- Секреты для прод-env: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (+ опц. SMTP/DaData). Остальное — prod-конфиг (`NODE_ENV=production`, `WEB_ORIGIN=PUBLIC_WEB_URL=https://zak.su10.ru`, `TRUST_PROXY=true`, `API_HOST=0.0.0.0` внутри контейнера, `STORAGE_ROOT=/var/lib/zakupki/storage`, `DATABASE_SSL_CA=/app/certs/yandex-root.crt`).

## G. Откат

- Удалить vhost `zakupki.conf` из conf.d → `nginx -t && nginx -s reload` (соседи не затронуты).
- `docker compose -p zakupki down` (свой проект; соседей не трогает).
- Всё восстановимо из `zakupki-deploy-backups/<ts>`. Мы только **добавляем** файлы/контейнеры/сеть-членство, существующие конфиги не редактируем.

## H. Критерии готовности

- `https://zak.su10.ru` отдаёт SPA; `/api/v1/health` = `{status:ok}`; логин/куки/CSRF работают за прокси; загрузка файлов ≤25 МБ проходит.
- Соседние сайты (estimat/billhub/keycloak) продолжают работать; `docker ps` без изменений по ним; `nginx -t` ok.
- Локальный dev не сломан: `pnpm dev`, API :3000, `pnpm build`/typecheck зелёные.

## Результат (as-built, развёрнуто)

Портал развёрнут и работает: **https://zak.su10.ru** (`/api/v1/health` = ok; `/api/v1/categories`,
`/api/v1/tenders` отдают данные из Yandex PG; SPA 200; HTTP→HTTPS 301). Соседи (estimat/rp/auth)
не затронуты (все 200), `nginx -t` ok.

- Код: `/opt/portals/zakupki` (git clone по публичному HTTPS). Обновление: `git pull` + `sudo bash deploy/deploy.sh`.
- Контейнеры: `zakupki-api` (:3000) + `zakupki-web` (:80) в сети `edge`. Storage: volume `zakupki_zakupki-storage`.
- Секреты: `/opt/portals/zakupki/.env.production` (600); CA: `certs/yandex-root.crt`.
- vhost: `/opt/infra/nginx/conf.d/zakupki.conf`; TLS `zak.su10.ru` (Let's Encrypt, до 2026-10-11).
- Бэкап инфры до изменений: `/home/corpsu/zakupki-deploy-backups/20260713-214729`.
- Open item: после автопродления серта нужен reload infra-nginx (общая инфра-задача всех порталов).

## I. Решения (подтверждены пользователем)

1. **Модель деплоя:** Docker Compose за infra-nginx ✓
2. **Изоляция:** по конвенции соседей — `/opt/portals/zakupki` под corpsu, контейнер API под `node` ✓
3. **Источник кода:** **git clone/pull на ВМ** (не rsync). Порядок: сначала commit+push изменений в main → на ВМ `git clone` (или `git pull`) → `.env.production` копируется отдельно по ssh (secret-safe). Для доступа к приватному репо с ВМ — deploy-key (проверить, как это сделано у соседей) или agent-forwarding.
