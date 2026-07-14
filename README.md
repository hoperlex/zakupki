# Тендерный портал ООО «СУ-10» — MVP

Электронная торговая площадка (ЭТП) для генподрядчика **ООО «СУ-10»**: тендеры на
строительно-монтажные работы (СМР) и поставку материалов. Обратный аукцион (редукцион) с
динамическим местом участника в реальном времени, открытые и закрытые тендеры, приглашения
по прямой ссылке, аккредитация контрагентов службой безопасности.

## Возможности

- **Публичная витрина** открытых тендеров (каталог с фильтрами, брендинг СУ-10).
- **Собственная авторизация** — cookie-сессии (access + refresh, httpOnly) + CSRF, argon2id.
- **Кабинет поставщика** — карточка компании с автозаполнением по ИНН, анкета контрагента,
  загрузка документов, подача предложений, «Моё место» в реальном времени.
- **Обратный аукцион** — постатейная подача цены, decimal-безопасный расчёт, ранжирование по
  итогу с НДС (SQL window function), анти-снайпинг авто-продление, живой рейтинг через **SSE**
  (участник видит своё место, но не цены конкурентов).
- **Кабинет менеджера** — мастер создания тендера, управление жизненным циклом (FSM),
  сравнение предложений, определение победителя, авто-протокол (HTML).
- **Служба безопасности** — очередь аккредитации, вынесение решений (с историей), уведомления.
- **Приглашения** — токенизированные ссылки на закрытые тендеры; участие без предварительной
  аккредитации, но с обязательным заполнением карточки.
- **Уведомления** — in-app колокол + email (аккредитация, приглашения, «вас перебили», дедлайн, победа).

## Технологии

| Слой | Стек |
|---|---|
| Backend | Node.js + TypeScript + **Fastify 5**, Drizzle ORM, PostgreSQL, zod, argon2id, decimal.js, SSE |
| Frontend | React 18 + TypeScript + **Ant Design 5** (Vite), TanStack Query, React Router |
| Общее | pnpm-монорепо; `@zakupki/shared` (zod-контракты) переиспользуется фронтом и бэком |

> Соответствует корпоративному стандарту (`temp/corp_standard_short_single_vps.md`).
> Для MVP осознанно упрощено: своя авторизация вместо Keycloak, локальный диск вместо S3,
> без Docker в dev (прод — Docker Compose за общим nginx, см. [«Production / VPS»](#production--vps)),
> pino в dev-минимуме.

## Структура репозитория

```
zakupki/
├─ apps/
│  ├─ api/   # Fastify: modules/{auth,organizations,accreditation,categories,
│  │         #                   tenders,bids,invitations,files,notifications},
│  │         #          lib/{money,ranking,events(SSE bus),scheduler,storage,inn-lookup}
│  └─ web/   # React + AntD 5: features/{catalog,tender-detail,bidding,company,
│            #                            accreditation,admin,invitations,notifications}
└─ packages/
   ├─ shared/  # zod DTO + enums (browser-safe)
   └─ db/      # Drizzle schema + SQL-first migrations + seed
```

## Требования

- **Node.js 20+**, **pnpm 9+**
- **PostgreSQL 15/16** на `localhost:5432`

## Установка и запуск (без Docker)

```bash
# 1. Зависимости
pnpm install

# 2. База данных (пример — создать роль и БД)
sudo -u postgres psql -c "CREATE ROLE zakupki LOGIN PASSWORD 'zakupki';"
sudo -u postgres createdb -O zakupki zakupki

# 3. Переменные окружения
cp .env.example .env        # при необходимости поправьте DATABASE_URL / секреты

# 4. Схема + демо-данные
pnpm db:migrate
pnpm db:seed
#   (или одной командой пересоздать всё: pnpm db:reset)

# 5. Запуск (api :3000 + web :5173 параллельно)
pnpm dev
```

Откройте **http://localhost:5173**. Vite проксирует `/api` на бэкенд (:3000), поэтому cookie
работают в одном origin.

### Демо-аккаунты (пароль `password123`)

| Роль | Email | Кабинет |
|---|---|---|
| Администратор | `admin@su10.ru` | `/admin` |
| Менеджер закупок | `manager@su10.ru` | `/admin` |
| Служба безопасности | `sb@su10.ru` | `/sb` |
| Поставщик (аккредитован) | `supplier@beton.ru` | `/app` |
| Поставщик (аккредитован) | `supplier@stroyresurs.ru` | `/app` |
| Поставщик (на проверке) | `supplier@pending.ru` | `/app` |

Демо-данные включают дерево категорий (СМР + материалы), несколько тендеров (в т.ч. активный
редукцион с двумя предложениями) и поставщиков в разных статусах аккредитации.

## Скрипты

| Команда | Действие |
|---|---|
| `pnpm dev` | api + web в режиме разработки |
| `pnpm build` | сборка всех пакетов |
| `pnpm test` | unit-тесты (vitest) |
| `pnpm db:migrate` | применить SQL-миграции |
| `pnpm db:seed` | загрузить демо-данные |
| `pnpm db:reset` | пересоздать схему + сид |

## Production / VPS

Прод-развёртывание на single-VPS `zak.su10.ru` — **Docker Compose стек за общим
reverse-proxy `infra-nginx`** (тот же паттерн, что у соседних порталов на этом хосте).
Стек не публикует хостовые порты; наружу торчит только `infra-nginx` (80/443, TLS от
Let's Encrypt через `infra-certbot`). БД — **внешняя Yandex Managed PostgreSQL** по SSL
`verify-full`.

```
Internet ──443──▶ infra-nginx ──▶ /api ─▶ zakupki-api:3000 (Fastify)
                                └▶ /   ─▶ zakupki-web:80   (SPA)
zakupki-api ──SSL verify-full──▶ Yandex Managed PostgreSQL (внешняя)
```

Артефакты деплоя — в [`deploy/`](deploy/): `Dockerfile.api`, `Dockerfile.web`,
`web-nginx.conf`, `docker-compose.yml`, `conf.d/zakupki.conf` (vhost для infra-nginx),
`.env.production.example`, `deploy.sh`, `make-prod-env.sh`. Подробный план и разведка
хоста — [`deploy/PLAN.md`](deploy/PLAN.md); правила работы с секретами —
[`deploy/SECURITY.md`](deploy/SECURITY.md).

### Чек-лист окружения (сервер)

`/opt/portals/zakupki/.env.production` (chmod 600, **не коммитится**) — из
`deploy/.env.production.example`. Обязательно задать:

| Переменная | Значение в прод |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` (API за nginx) |
| `WEB_ORIGIN`, `PUBLIC_WEB_URL` | `https://zak.su10.ru` |
| `DATABASE_URL` | строка Yandex Managed PG (порт обычно `6432`) |
| `DATABASE_SSL_CA` | `/app/certs/yandex-root.crt` (путь **внутри** контейнера) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | длинные случайные (`openssl rand -hex 32`) |
| `STORAGE_ROOT` | `/var/lib/zakupki/storage` (volume `zakupki-storage`) |

CA-сертификат Yandex («Internal Root CA») кладётся на сервер как
`/opt/portals/zakupki/certs/yandex-root.crt` (не в git; монтируется ro в контейнер API).

### Подготовка PostgreSQL

Расширения **`citext`** и **`pgcrypto`** должны быть включены **заранее** (в Yandex Console
→ кластер → Extensions, либо `CREATE EXTENSION`). Миграции их не создают.

### Порядок деплоя

```bash
# 0. (локально) закоммитить+запушить изменения; сгенерировать прод-env без утечки секретов:
deploy/make-prod-env.sh .env deploy/.env.production.out   # значения не печатаются

# 1. (VPS) получить код (репозиторий публичный — clone по HTTPS, без ключей)
sudo install -d -o corpsu -g corpsu /opt/portals/zakupki
git clone https://github.com/hoperlex/zakupki.git /opt/portals/zakupki
#   обновление позже:  cd /opt/portals/zakupki && git pull

# 2. (VPS) секреты и CA — копируются отдельно по ssh (secret-safe, значения не светятся):
#    → /opt/portals/zakupki/.env.production       (chmod 600)
#    → /opt/portals/zakupki/certs/yandex-root.crt
#    (напр. одной командой: tar транспорт из локали, см. deploy/PLAN.md)

# 3. (VPS) сборка + миграции (без reset) + запуск
sudo bash deploy/deploy.sh
#   = docker compose -f deploy/docker-compose.yml -p zakupki build
#     docker compose ... run --rm api pnpm --filter @zakupki/db db:migrate
#     docker compose ... up -d api web

# 4. (VPS, разово) TLS-сертификат через СУЩЕСТВУЮЩИЙ infra-certbot (ACME webroot).
#    ACME-challenge обслуживает default-сервер, пока vhost не добавлен.
sudo docker exec infra-certbot certbot certonly --webroot -w /var/www/certbot \
  -d zak.su10.ru --non-interactive --agree-tos --no-eff-email --email admin@su10.ru

# 5. (VPS, разово) подключить vhost к общему nginx и перечитать конфиг
sudo cp deploy/conf.d/zakupki.conf /opt/infra/nginx/conf.d/zakupki.conf
sudo docker exec infra-nginx nginx -t && sudo docker exec infra-nginx nginx -s reload

# 6. Проверка
curl -fsS https://zak.su10.ru/api/v1/health   # {"status":"ok",...}
```

Опциональные демо-данные (`pnpm db:seed`) — только для стенда, **не для прод**.
Деструктивный `db:reset` в прод **не запускается**.

> Это контролируемый single-VPS deploy для MVP (git pull → build на хосте). Обновление
> портала не трогает `infra-nginx` и соседние сайты; откат — `docker compose -p zakupki down`
> + удалить `zakupki.conf` из `conf.d` и `nginx -s reload`.

## Как это работает (ключевые решения)

- **Обратный аукцион.** Пока тендер в статусе `collecting`, поставщик подаёт и переподаёт более
  низкую цену. Ранги пересчитываются атомарно в транзакции (`row_number() over (order by
  total_with_vat, submitted_at)`). Если валидное предложение делает нового лидера в последние
  5 минут — дедлайн продлевается на 5 минут (до 3 раз).
- **Живое место (SSE).** `GET /api/v1/tenders/:id/rank-stream` — сервер на каждое изменение
  тендера пересчитывает место **именно этого** соединения и шлёт только безопасные поля
  (место, число участников, свой итог, дедлайн). Цены/имена конкурентов не покидают сервер.
- **Cookie-авторизация ради SSE.** `EventSource` не умеет слать заголовки, поэтому access- и
  refresh-токены — в httpOnly cookie, а mutating-запросы защищены CSRF (double-submit).
- **Деньги.** Все суммы считаются на сервере через `decimal.js`, в БД — `numeric(18,2)`, в DTO
  передаются строками; в UI `InputNumber stringMode`.
- **Доступ к закрытым тендерам** — только приглашённым (принявшим токен-приглашение) или уже
  участвующим; служба безопасности не видит коммерческих цен.

## Проверка (сквозной сценарий)

1. `manager@su10.ru` → создать открытый тендер (материалы) с позициями → опубликовать.
2. `supplier@pending.ru` → заполнить карточку → отправить на аккредитацию.
3. `sb@su10.ru` → аккредитовать.
4. Поставщик → подать постатейное предложение, увидеть «Ваше место»; во втором окне другой
   поставщик даёт ниже → место первого меняется в реальном времени (SSE).
5. После дедлайна тендер → «На рассмотрении»; менеджер → «Сравнение» → выбрать победителя → протокол.
6. Закрытый тендер: менеджер приглашает по email → открыть `/invite/:token` → регистрация →
   карточка → предложение (без предварительной аккредитации).

## Вне MVP (заложено на будущее)

ЭЦП/УКЭП; нормализация ОСН/УСН (сейчас ранжирование с НДС); отдельная live-сессия редукциона;
ОКПД2/КТРУ; согласование тендера перед публикацией; мульти-юзер на организацию; договор/КС-2/КС-3;
переход на S3, Redis-шину для SSE, Keycloak. Внешний API создания тендеров
(`POST /api/v1/tenders`) — контракт и таблицы (`api_keys`, `idempotency_keys`) заложены,
endpoint отключён.
