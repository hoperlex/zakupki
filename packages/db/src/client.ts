import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgSslOption } from './loadEnv';
import * as schema from './schema';

export type Sql = ReturnType<typeof postgres>;

export interface DbHandle {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sql: Sql;
  close: () => Promise<void>;
}

export function createDb(connectionString: string, max = 10): DbHandle {
  const sql = postgres(connectionString, { max, ...pgSslOption() });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

export type Database = DbHandle['db'];
/** Transaction handle (first arg of db.transaction callback). */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Accepts either the pooled db or an open transaction — for query-only helpers. */
export type DbClient = Database | Transaction;
export { schema };
