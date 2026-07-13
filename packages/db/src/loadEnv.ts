import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
// packages/db/src -> repo root
const repoRoot = resolve(here, '../../..');
config({ path: resolve(repoRoot, '.env') });

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://zakupki:zakupki@localhost:5432/zakupki';

export const MIGRATIONS_DIR = resolve(here, '../migrations');

// Optional TLS CA for the DB (e.g. Yandex Managed PostgreSQL, sslmode=verify-full).
// DATABASE_SSL_CA is a path to a PEM file, relative to the repo root or absolute.
const caPathRaw = process.env.DATABASE_SSL_CA?.trim();
export const DATABASE_SSL_CA = caPathRaw ? resolve(repoRoot, caPathRaw) : undefined;

type PgSsl = { ssl: { rejectUnauthorized: true; ca: string } };
let cachedSsl: PgSsl | undefined;

/**
 * postgres.js options fragment enabling verified TLS when DATABASE_SSL_CA is set.
 * Spread into `postgres(url, { ...pgSslOption() })`. Returns `{}` when unset (local dev).
 */
export function pgSslOption(): PgSsl | Record<string, never> {
  if (!DATABASE_SSL_CA) return {};
  if (!cachedSsl) {
    let ca: string;
    try {
      ca = readFileSync(DATABASE_SSL_CA, 'utf8');
    } catch (err) {
      throw new Error(
        `DATABASE_SSL_CA=${caPathRaw}: не удалось прочитать CA-файл (${DATABASE_SSL_CA}): ${
          (err as Error).message
        }`,
      );
    }
    cachedSsl = { ssl: { rejectUnauthorized: true, ca } };
  }
  return cachedSsl;
}
