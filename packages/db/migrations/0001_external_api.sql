-- Внешний машинный API (интеграция с EstiMat) — шаг 1: EXPAND.
-- Только добавление nullable-колонок: применяется на живой прод-базе без блокировок
-- и без риска упасть. Ограничения и индексы — отдельным шагом 0002, чтобы при
-- обнаружении legacy-строк можно было выполнить backfill УЖЕ добавленными колонками.

-- ─── tenders: происхождение из внешней системы ───
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS source_system varchar(32);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS external_ref varchar(128);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS source_revision integer;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS source_payload_hash char(64);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS source_api_key_id uuid;

-- Монотонная ревизия состояния для внешнего клиента: он применяет только более
-- новое состояние. Инкрементируется на каждом переходе жизненного цикла.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

-- Момент подведения итогов: award либо закрытие без победителя.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS finished_at timestamptz;

-- ─── tender_positions: аудит единицы измерения ───
-- Единица источника («шт», «м²») сопоставляется коду домена. Исходное написание
-- храним отдельно: в spec ему не место — это поле видит поставщик.
ALTER TABLE tender_positions ADD COLUMN IF NOT EXISTS source_unit varchar(32);

-- ─── api_keys: технический пользователь-actor и код клиента ───
-- user_id обязателен по смыслу (тендеры пишут created_by = users.id, NOT NULL FK),
-- но NOT NULL выставляется в 0002 — после проверки legacy-строк.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS client_code varchar(32);
