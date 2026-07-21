-- Справочник контрагентов: тип контрагента и признак генподрядчика на organizations.
-- Роли (enum role) и org_kind не трогаем. Идемпотентна.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'counterparty_type') THEN
    CREATE TYPE counterparty_type AS ENUM ('contractor', 'supplier');
  END IF;
END $$;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS counterparty_type counterparty_type NOT NULL DEFAULT 'supplier';
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_general_contractor boolean NOT NULL DEFAULT false;

-- Внутренняя орг-владелец портала (ООО «СУ-10») — генподрядчик.
UPDATE organizations SET counterparty_type = 'contractor' WHERE kind = 'internal';
-- Флаг ставим ровно одной строке — защита от >1 internal, иначе уникальный индекс ниже упадёт.
UPDATE organizations SET is_general_contractor = true
  WHERE id = (
    SELECT id FROM organizations
    WHERE kind = 'internal' AND deleted_at IS NULL
    ORDER BY created_at
    LIMIT 1
  );

-- Не более одного генподрядчика одновременно.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_single_gc_uq
  ON organizations (is_general_contractor) WHERE is_general_contractor;
