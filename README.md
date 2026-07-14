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

> ⚠️ **Проверьте, куда указывает ваш `DATABASE_URL`, прежде чем запускать `db:reset`.**
> `deploy/make-prod-env.sh` копирует `DATABASE_URL` из локального `.env` в
> `.env.production` **дословно**, поэтому легко оказаться в ситуации, когда dev и prod
> ходят в одну управляемую базу Yandex (порт `6432`, `sslmode=verify-full`).
> `db:reset` начинается с `DROP SCHEMA public CASCADE` — против такой базы он уничтожит
> продовые данные. Для локальной разработки `DATABASE_URL` должен указывать на
> **свой** PostgreSQL на `localhost:5432` (шаг 2 выше).

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
| `pnpm db:migrate` | применить новые SQL-миграции (уже применённые пропускаются) |
| `pnpm db:migrate:status` | показать applied/pending/missing одной строкой JSON |
| `pnpm db:migrate:check` | код возврата: `0` — чисто, `3` — есть pending, `1` — сбой |
| `pnpm db:seed` | загрузить демо-данные |
| `pnpm db:reset` | **DROP SCHEMA public CASCADE** + миграции + сид (см. предупреждение выше) |

Миграции учитываются по имени файла в таблице `public._migrations`; накат каждого файла и
отметка о нём идут одной транзакцией, а весь прогон держит advisory-лок, поэтому два
параллельных `db:migrate` не столкнутся. Уже применённый файл **править нельзя** — раннер
сверяет только имена, и правка будет молча проигнорирована. Изменения вносятся новым файлом.

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
`.env.production.example`, `deploy-zak.sh`, `make-prod-env.sh`. Подробный план и разведка
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
→ кластер → Extensions). `0000_init.sql` содержит `CREATE EXTENSION IF NOT EXISTS`, но на
Managed PostgreSQL у обычного пользователя нет прав на создание расширений, поэтому
включить их через Console всё равно обязательно.

### Порядок первичного развёртывания

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

# 3. (VPS, разово) подключить команду deploy-zak
sudo ln -sfn /opt/portals/zakupki/deploy/deploy-zak.sh /usr/local/bin/deploy-zak

# 3a. (VPS) сборка + миграции (без reset) + запуск
sudo deploy-zak --migrate
#   Первый запуск обязан быть с --migrate: pending-миграции есть, и без флага
#   deploy-zak откажется выкатывать код (guard срабатывает ДО смены контейнеров).

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

### Эксплуатация: `deploy-zak`

Единственный поддерживаемый способ обновлять портал. Работает из любого каталога
(команда якорится на реальном расположении скрипта, а не на текущей папке).
Не трогает `infra-nginx`, Keycloak и соседние порталы.

| Команда | Что делает |
|---|---|
| `deploy-zak` | `git pull` → сборка образов с тегом commit-SHA → проверка миграций → `up -d` → health |
| `deploy-zak --migrate` | то же + дамп БД + накат **только новых** миграций |
| `deploy-zak --migrate --maintenance` | миграции в окне обслуживания: стоп API до дампа (RPO = 0) |
| `deploy-zak --previous` | откат кода на предыдущий commit-SHA без пересборки, за секунды |
| `deploy-zak --previous --restore-db` | согласованный откат кода и БД |
| `deploy-zak --restore-db[=файл]` | восстановление БД из дампа (destructive) |
| `deploy-zak --restore-config[=архив]` | восстановление `.env.production` и CA из снимка |
| `deploy-zak --status` | read-only сводка: релизы, образы, миграции, бэкапы, диск |
| `deploy-zak --help` | справка по всем флагам |

Обычное обновление — просто `deploy-zak` (или `deploy-zak --migrate`, если в коммитах
есть новые миграции; без флага скрипт сам откажется выкатываться и скажет об этом).

**Модель релизов.** Образы тегируются коротким commit-SHA; `:latest` — подвижный алиас
на последний релиз, прошедший health. Состояние — в `/var/lib/zakupki/deploy/release.state`
(`current`/`previous`). Поэтому `--previous` — это переключение тега без пересборки.
Повторный `--previous` возвращает обратно.

**Состояние и бэкапы** — `/var/lib/zakupki/deploy/` (каталог создаётся автоматически при
первом запуске от root):

```
release.state       current/previous — какие SHA запущены
config-backups/     700; снимки .env.production + CA + vhost (600) — СЕКРЕТЫ
db-backups/         700; предмиграционные дампы pg_dump -Fc (600) — ПДн и хэши паролей
reports/            JSON-отчёт на каждый запуск (кто, что, результат)
deploy.lock         flock от параллельных запусков
```

> **Не путать** с `STORAGE_ROOT=/var/lib/zakupki/storage` — тот путь живёт **внутри**
> контейнера (volume `zakupki-storage`) и к каталогу состояния отношения не имеет.

**Ретеншн** (чтобы бэкапы и образы не съели диск — он общий со всеми порталами хоста):
3 SHA-тега на образ, 3 предмиграционных дампа, 1 аварийный, 10 снимков конфига,
BuildKit-кэш старше 14 суток (при заполнении ≥85% — старше 72 ч). Отключается `--no-prune`.
Если свободно меньше 8 ГБ, деплой сначала чистит, а затем перепроверяет — и отказывается
собирать, если места так и не хватило.

**Что нужно знать про откат:**

- `--previous` откатывает **код, но не схему БД**. Если новый код принёс несовместимую
  миграцию — нужен `--previous --restore-db`.
- Дамп БД **не покрывает загруженные документы** (volume `zakupki-storage`). После
  `--restore-db` ссылки в БД и файлы на диске могут разойтись: RPO файлов ≠ RPO базы.
- RPO дампа = момент его снятия. При обычном `--migrate` API продолжает принимать записи,
  и они потеряются при восстановлении; `--maintenance` останавливает API заранее и даёт
  нулевой RPO.
- Журнал `_migrations` восстанавливается вместе со схемой, поэтому после `--restore-db`
  следующий деплой накатит миграции заново.
- `--restore-db` и `--restore-config` требуют интерактивного терминала (подтверждение
  читается с `/dev/tty`).

**Прочее:**

- Health проверяется изнутри контейнера с ретраями. Провал health **не** откатывает
  автоматически: он оставляет `:latest` на прошлом здоровом релизе, возвращает ненулевой
  код и печатает `deploy-zak --previous`. Решение принимает человек — авто-откат после
  применённой миграции дал бы непроверенную связку «старый код + новая схема».
- Короткие 502 (до 30 с) при пересоздании контейнеров — ожидаемы: vhost резолвит имена
  через `resolver … valid=30s`.
- Правки самого `deploy-zak.sh` вступают в силу со **следующего** запуска: git подменяет
  файл через rename, а запущенный bash дочитывает старый inode.

Опциональные демо-данные (`pnpm db:seed`) — только для стенда, **не для прод**.
Деструктивный `db:reset` в прод **не запускается** — и не только в прод, см. предупреждение
в начале раздела «Разработка».

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
