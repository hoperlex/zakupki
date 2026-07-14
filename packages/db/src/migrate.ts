import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { DATABASE_URL, MIGRATIONS_DIR, pgSslOption } from './loadEnv';

type Pg = ReturnType<typeof postgres>;

/**
 * Ключ session-level advisory-лока раннера миграций.
 *
 * 774201 — то же «пространство проекта», что и TENDER_NUMBER_LOCK в
 * apps/api/src/modules/tenders/service.ts; 0001 — подсистема «миграции».
 * Одноаргументная (bigint) форма не конфликтует с двухаргументной (int4, int4):
 * PostgreSQL держит их в разных пространствах. Advisory-локи локальны для базы,
 * поэтому пересечься с соседними порталами невозможно.
 *
 * Строка, а не number/BigInt: явный `::bigint` разбирает её на стороне PostgreSQL,
 * без опоры на то, как драйвер сериализует числа за пределами int4.
 */
const MIGRATION_LOCK_KEY = '7742010001';

/** Коды возврата CLI — контракт с deploy-zak. */
const EXIT_FAILURE = 1;
const EXIT_PENDING = 3;

export type MigrationStatus = {
  /** Файл на диске и отметка в журнале есть. */
  applied: string[];
  /** Файл на диске есть, отметки в журнале нет — накатится следующим `db:migrate`. */
  pending: string[];
  /** Отметка в журнале есть, файла на диске нет: код старее базы либо миграцию удалили. */
  missing: string[];
};

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Раскладывает файлы и журнал на три непересекающихся множества. Без БД — чистая. */
export function diffMigrations(files: string[], journal: string[]): MigrationStatus {
  const inJournal = new Set(journal);
  const onDisk = new Set(files);
  return {
    applied: files.filter((f) => inJournal.has(f)),
    pending: files.filter((f) => !inJournal.has(f)),
    missing: [...journal].filter((n) => !onDisk.has(n)).sort(),
  };
}

/** Имена из журнала. Таблицы может не быть (чистая БД) — это не ошибка, а пустой журнал. */
async function readJournal(sql: Pg): Promise<string[]> {
  const [reg] = await sql<{ tbl: string | null }[]>`
    SELECT to_regclass('public._migrations')::text AS tbl`;
  if (!reg?.tbl) return [];
  const rows = await sql<{ name: string }[]>`SELECT name FROM public._migrations ORDER BY name`;
  return rows.map((r) => r.name);
}

/** Только читает: не создаёт журнал и не берёт лок. */
export async function getStatus(sql: Pg): Promise<MigrationStatus> {
  return diffMigrations(listMigrationFiles(), await readJournal(sql));
}

/**
 * Держит session-level advisory-лок на `sql` на время `fn`.
 *
 * Лок живёт на конкретном соединении, поэтому требуется max:1 — тогда пул
 * вырождается в одну сессию и `sql.begin()` внутри `fn` идёт по тому же
 * соединению, что и сам лок.
 *
 * НЕ использовать здесь sql.reserve(): при max:1 он забирает единственное
 * соединение, и любой последующий запрос встаёт в очередь навсегда (у очереди
 * нет таймаута). Вдобавок у reserve()-хендла нет .begin() в рантайме, хотя типы
 * его обещают.
 */
export async function withMigrationLock<T>(sql: Pg, fn: () => Promise<T>): Promise<T> {
  if (sql.options.max !== 1) {
    throw new Error(`withMigrationLock требует клиент с max:1 (получен max:${sql.options.max})`);
  }
  const [row] = await sql<{ ok: boolean }[]>`
    SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}::bigint) AS ok`;
  if (!row?.ok) {
    throw new Error(
      `Миграции уже накатывает другой процесс (advisory-лок ${MIGRATION_LOCK_KEY} занят). ` +
        'Дождитесь завершения того наката и повторите.',
    );
  }
  try {
    return await fn();
  } finally {
    // Не маскируем исходную ошибку: сессия закрывается в main(), лок снимется и сам.
    try {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
    } catch {
      /* ignore */
    }
  }
}

/**
 * Клиент раннера.
 *
 * max_lifetime обязателен: по умолчанию он 30–60 минут, и его срабатывание
 * переоткрыло бы соединение, молча потеряв advisory-лок. (idle_timeout трогать
 * не нужно — по умолчанию он уже null.)
 *
 * onnotice обязателен: без него postgres.js печатает NOTICE через console.log,
 * то есть в stdout (см. NoticeResponse в src/connection.js). Миграции их
 * порождают на каждом `IF NOT EXISTS`, и в режиме `status --json` такой NOTICE
 * сломал бы разбор вывода на стороне deploy-zak.
 */
function createRunnerClient(): Pg {
  return postgres(DATABASE_URL, {
    max: 1,
    max_lifetime: null,
    onnotice: (notice) => console.error(`  NOTICE: ${notice.message}`),
    ...pgSslOption(),
  });
}

export async function runMigrations(sql: Pg): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS public._migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const journal = await readJournal(sql);
  const applied = new Set(journal);

  const files = listMigrationFiles();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Файл исполняется целиком одним simple-query: PostgreSQL сам разбирает его на
    // инструкции. Резать по `;` своими руками нельзя — точка с запятой живёт внутри
    // строк, комментариев и тела `DO $$ … $$`. Ошибка в любой инструкции откатывает
    // весь файл вместе с отметкой в _migrations.
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO public._migrations (name) VALUES (${file})`;
    });
    newlyApplied.push(file);
    console.log(`  ✓ applied ${file}`);
  }
  return newlyApplied;
}

type Mode = 'apply' | 'status' | 'check';
type Cli = { mode: Mode; json: boolean };

export function parseArgv(argv: string[]): Cli {
  // `pnpm run <script> -- status` протаскивает сам разделитель `--` в argv.
  const args = argv.filter((a) => a !== '--');
  const flags = args.filter((a) => a.startsWith('-'));
  const positional = args.filter((a) => !a.startsWith('-'));

  const unknown = flags.find((f) => f !== '--json');
  if (unknown) {
    throw new Error(`Неизвестный флаг: ${unknown}. Использование: migrate.ts [status|check] [--json]`);
  }
  if (positional.length > 1) {
    throw new Error(`Лишние аргументы: ${positional.slice(1).join(' ')}`);
  }

  const cmd = positional[0];
  let mode: Mode;
  if (cmd === undefined) mode = 'apply';
  else if (cmd === 'status') mode = 'status';
  else if (cmd === 'check') mode = 'check';
  else throw new Error(`Неизвестная команда: ${cmd}. Ожидалось: status | check`);

  return { mode, json: flags.includes('--json') };
}

async function main() {
  const { mode, json } = parseArgv(process.argv.slice(2));
  const sql = createRunnerClient();
  try {
    if (mode === 'status' || mode === 'check') {
      const st = await getStatus(sql);
      if (json) {
        // Единственная запись в stdout: JSON одной строкой, последней.
        process.stdout.write(`${JSON.stringify({ ok: true, ...st })}\n`);
      } else {
        // Человеческий вывод — в stderr, чтобы stdout оставался парсабельным.
        console.error(`applied: ${st.applied.length}`);
        for (const f of st.pending) console.error(`  pending: ${f}`);
        for (const f of st.missing) console.error(`  ! в журнале, но не на диске: ${f}`);
        if (st.pending.length === 0 && st.missing.length === 0) console.error('up to date');
      }
      if (mode === 'check') {
        if (st.missing.length > 0) {
          console.error(
            `Журнал ссылается на файлы, которых нет на диске: ${st.missing.join(', ')}. ` +
              'Код старее базы либо миграцию удалили — разберитесь до деплоя.',
          );
          process.exitCode = EXIT_FAILURE;
        } else if (st.pending.length > 0) {
          process.exitCode = EXIT_PENDING;
        }
      }
      return;
    }

    console.log('Applying migrations…');
    const applied = await withMigrationLock(sql, () => runMigrations(sql));
    if (applied.length === 0) console.log('  Nothing to apply — up to date.');
    else console.log(`Done. Applied ${applied.length} migration(s).`);
  } finally {
    // Закрытие сессии само снимает advisory-лок.
    await sql.end();
  }
}

// Run when invoked directly (tsx src/migrate.ts)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(EXIT_FAILURE);
  });
}
