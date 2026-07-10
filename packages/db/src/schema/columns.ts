import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Case-insensitive text (requires the `citext` extension). */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const pk = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
