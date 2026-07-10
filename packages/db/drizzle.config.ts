import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

// NOTE: migrations are SQL-first (see ./migrations, applied by src/migrate.ts).
// This config exists only so `drizzle-kit generate` can be used for reference diffs.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://zakupki:zakupki@localhost:5432/zakupki',
  },
});
