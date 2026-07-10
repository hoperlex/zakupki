import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { DATABASE_URL, MIGRATIONS_DIR } from './loadEnv';

type Pg = ReturnType<typeof postgres>;

/** Remove `--` line comments (to end of line) so semicolons inside comments don't split statements. */
function stripLineComments(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

/** Split a .sql file into individual statements (no dollar-quoted blocks in our migrations). */
function splitStatements(content: string): string[] {
  return stripLineComments(content)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runMigrations(sql: Pg): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const appliedRows = await sql<{ name: string }[]>`SELECT name FROM _migrations`;
  const applied = new Set(appliedRows.map((r) => r.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = splitStatements(content);
    await sql.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
    newlyApplied.push(file);
    console.log(`  ✓ applied ${file} (${statements.length} statements)`);
  }
  return newlyApplied;
}

async function main() {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    console.log('Applying migrations…');
    const applied = await runMigrations(sql);
    if (applied.length === 0) console.log('  Nothing to apply — up to date.');
    else console.log(`Done. Applied ${applied.length} migration(s).`);
  } finally {
    await sql.end();
  }
}

// Run when invoked directly (tsx src/migrate.ts)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
