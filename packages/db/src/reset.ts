import postgres from 'postgres';
import { createDb } from './client';
import { DATABASE_URL, pgSslOption } from './loadEnv';
import { runMigrations } from './migrate';
import { seed } from './seed';

async function main() {
  console.log('Resetting database (DROP SCHEMA public CASCADE)…');
  const raw = postgres(DATABASE_URL, { max: 1, ...pgSslOption() });
  try {
    await raw.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;').simple();
    console.log('Applying migrations…');
    await runMigrations(raw);
  } finally {
    await raw.end();
  }
  const handle = createDb(DATABASE_URL, 1);
  try {
    console.log('Seeding…');
    await seed(handle.db);
  } finally {
    await handle.close();
  }
  console.log('Reset complete.');
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
