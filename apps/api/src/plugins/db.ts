import type { FastifyInstance } from 'fastify';
import { createDb, type Database, type Sql } from '@zakupki/db';
import { env, storageRoot } from '../config/env';
import { LocalDiskStorage } from '../lib/storage/LocalDiskStorage';
import type { StorageAdapter } from '../lib/storage/StorageAdapter';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    sql: Sql;
    storage: StorageAdapter;
  }
}

export function registerDb(app: FastifyInstance): void {
  const { db, sql } = createDb(env.DATABASE_URL);
  const storage = new LocalDiskStorage(storageRoot);
  app.decorate('db', db);
  app.decorate('sql', sql);
  app.decorate('storage', storage);
  app.addHook('onClose', async () => {
    await sql.end();
  });
}
