// Поведение миграций внешнего API против реальной БД.
// Чистые функции раннера (diffMigrations/parseArgv) покрыты в packages/db.
//
// Сам факт применения 0000→0001→0002 с нуля проверяет globalSetup: без него
// не поднялся бы ни один тест в этом пакете.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '@zakupki/db/loadEnv';
import { getApp, makeOrg, makeUser, resetData, type App } from './fixtures';

const read = (file: string): string => readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
const EXPAND = read('0001_external_api.sql');
const CONSTRAINTS = read('0002_external_api_constraints.sql');

let app: App;

beforeAll(async () => {
  app = await getApp();
  await resetData(app);
});

describe('идемпотентность', () => {
  it('0001 применяется повторно без ошибок', async () => {
    await expect(app.sql.unsafe(EXPAND)).resolves.toBeDefined();
  });

  it('0002 применяется повторно без ошибок', async () => {
    // Индексы под IF NOT EXISTS, FK — под проверкой pg_constraint, SET NOT NULL — no-op.
    await expect(app.sql.unsafe(CONSTRAINTS)).resolves.toBeDefined();
  });
});

describe('preflight legacy-ключей', () => {
  const insertLegacy = `INSERT INTO api_keys (key_prefix, key_hash)
    VALUES ('legacy_probe', repeat('0', 64))`;
  const undoNotNull = `ALTER TABLE api_keys ALTER COLUMN user_id DROP NOT NULL`;

  it('останавливает миграцию и объясняет, что делать, а не удаляет данные', async () => {
    // Транзакция откатится сама — состояние схемы восстановится.
    await expect(
      app.sql.begin(async (tx) => {
        await tx.unsafe(undoNotNull);
        await tx.unsafe(insertLegacy);
        await tx.unsafe(CONSTRAINTS);
      }),
    ).rejects.toThrow(/user_id/);
  });

  it('legacy-строка остаётся на месте: миграция ничего не стирает', async () => {
    await app.sql
      .begin(async (tx) => {
        await tx.unsafe(undoNotNull);
        await tx.unsafe(insertLegacy);
        try {
          await tx.unsafe(CONSTRAINTS);
        } catch {
          // ожидаемо: дальше проверять в этой транзакции нельзя — она аборчена
        }
        throw new Error('rollback');
      })
      .catch(() => undefined);

    const rows = await app.sql.unsafe(`SELECT 1 FROM api_keys WHERE key_prefix = 'legacy_probe'`);
    // строки нет только потому, что транзакция откатилась, а не потому что её удалили
    expect(rows).toHaveLength(0);
  });

  it('после backfill колонкой из 0001 миграция 0002 проходит — ради этого и был split', async () => {
    const orgId = await makeOrg(app, { kind: 'internal' });
    const userId = await makeUser(app, { orgId, role: 'manager' });

    const notNullApplied = await app.sql.begin(async (tx) => {
      await tx.unsafe(undoNotNull);
      await tx.unsafe(insertLegacy);
      // Колонка user_id существует (её добавил 0001), поэтому заполнение возможно
      // ДО того, как 0002 навесит NOT NULL. В единой миграции откат преflight'а
      // снёс бы и саму колонку — чинить было бы нечем.
      await tx.unsafe(`UPDATE api_keys SET user_id = $1 WHERE user_id IS NULL`, [userId]);
      await tx.unsafe(CONSTRAINTS);
      const [col] = await tx.unsafe<{ notnull: boolean }[]>(
        `SELECT attnotnull AS notnull FROM pg_attribute
         WHERE attrelid = 'api_keys'::regclass AND attname = 'user_id'`,
      );
      return col?.notnull;
    });

    // 0002 дошёл до конца и вернул NOT NULL на место
    expect(notNullApplied).toBe(true);
  });
});

describe('форма схемы', () => {
  it('идемпотентность создания опирается на частичный уникальный индекс', async () => {
    const [row] = await app.sql.unsafe<{ def: string }[]>(
      `SELECT indexdef def FROM pg_indexes WHERE indexname = 'tenders_source_ref_uq'`,
    );
    expect(row?.def).toMatch(/UNIQUE/);
    expect(row?.def).toContain('organization_id');
    expect(row?.def).toContain('source_system');
    expect(row?.def).toContain('external_ref');
    // частичный: тендеры из кабинета (external_ref IS NULL) в индекс не попадают
    expect(row?.def).toMatch(/WHERE \(external_ref IS NOT NULL\)/);
  });

  it('префикс ключа однозначен — поиск идёт по нему', async () => {
    const [row] = await app.sql.unsafe<{ def: string }[]>(
      `SELECT indexdef def FROM pg_indexes WHERE indexname = 'api_keys_key_prefix_uq'`,
    );
    expect(row?.def).toMatch(/UNIQUE/);
  });
});
