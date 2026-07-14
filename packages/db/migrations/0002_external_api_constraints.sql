-- Внешний машинный API — шаг 2: CONSTRAINTS.
-- Ограничения, индексы и внешние ключи поверх колонок из 0001. Идемпотентна.

-- Таблица api_keys заводилась «на вырост» и до этой миграции потребителей не имела,
-- поэтому строк быть не должно. Если они есть — останавливаемся с инструкцией, а не
-- удаляем данные молча. 0001 уже применён, так что backfill делается этими же колонками.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM api_keys WHERE user_id IS NULL) THEN
    RAISE EXCEPTION
      'api_keys: % ключ(ей) без user_id. Заполните технического пользователя (UPDATE api_keys SET user_id = ''<users.id>'' WHERE user_id IS NULL) либо отзовите ключи, затем повторите миграцию.',
      (SELECT count(*) FROM api_keys WHERE user_id IS NULL);
  END IF;
END
$$;

ALTER TABLE api_keys ALTER COLUMN user_id SET NOT NULL;

-- Идемпотентность создания тендера. Ключ — (заказчик, система-источник, external_ref),
-- а НЕ api-ключ: идемпотентность обязана пережить ротацию ключа.
CREATE UNIQUE INDEX IF NOT EXISTS tenders_source_ref_uq
  ON tenders (organization_id, source_system, external_ref)
  WHERE external_ref IS NOT NULL;

-- Поиск ключа идёт по префиксу — он обязан быть однозначным.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_prefix_uq ON api_keys (key_prefix);

-- ADD CONSTRAINT не умеет IF NOT EXISTS. Имена constraint'ов уникальны в пределах
-- таблицы, а не схемы, поэтому проверяем пару (conrelid, conname).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'api_keys'::regclass AND conname = 'api_keys_user_fk'
  ) THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenders'::regclass AND conname = 'tenders_source_api_key_fk'
  ) THEN
    ALTER TABLE tenders ADD CONSTRAINT tenders_source_api_key_fk
      FOREIGN KEY (source_api_key_id) REFERENCES api_keys(id);
  END IF;
END
$$;
