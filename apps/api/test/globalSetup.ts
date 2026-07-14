// Готовит тестовую БД один раз на прогон: чистая схема + все миграции.
// Прогон миграций здесь заодно проверяет, что они применяются с нуля.

import postgres from 'postgres';
import { runMigrations } from '@zakupki/db/migrate';
import { TEST_DATABASE_URL, assertSafeTestDatabase } from './dbUrl';

export async function setup(): Promise<void> {
  // Первым делом — до любого подключения.
  assertSafeTestDatabase(TEST_DATABASE_URL);

  const sql = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
    // Расширения живут в public и удаляются вместе со схемой.
    await sql.unsafe(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext',
    );
    await runMigrations(sql);
  } finally {
    await sql.end();
  }
}
