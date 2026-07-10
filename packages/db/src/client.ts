import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Sql = ReturnType<typeof postgres>;

export interface DbHandle {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sql: Sql;
  close: () => Promise<void>;
}

export function createDb(connectionString: string, max = 10): DbHandle {
  const sql = postgres(connectionString, { max });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

export type Database = DbHandle['db'];
export { schema };
