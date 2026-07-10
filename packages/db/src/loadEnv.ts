import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// packages/db/src -> repo root
config({ path: resolve(here, '../../../.env') });

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://zakupki:zakupki@localhost:5432/zakupki';

export const MIGRATIONS_DIR = resolve(here, '../migrations');
