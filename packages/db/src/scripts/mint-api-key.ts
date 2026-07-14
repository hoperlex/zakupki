// Выпуск машинного api-ключа для внешней интеграции.
//
//   pnpm --filter @zakupki/db db:mint-api-key -- \
//     --organization-id <uuid> --user-id <uuid> [--client-code estimat] [--scopes a,b]
//
// organization_id и user_id передаются ЯВНО: на прод-сиде полагаться нельзя —
// в проде seed не запускают. Полный ключ печатается ОДИН раз; в БД уходит только
// префикс и SHA-256 — восстановить ключ из базы невозможно.

import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { DATABASE_URL, pgSslOption } from '../loadEnv';

const ALL_SCOPES = ['tenders:create', 'tenders:read', 'tenders:cancel'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function fail(message: string): never {
  console.error(`ОШИБКА: ${message}`);
  process.exit(1);
}

/** `zk_<8 символов>` — короткий несекретный идентификатор строки ключа (varchar(16)). */
const newPrefix = (): string => `zk_${randomBytes(6).toString('base64url').slice(0, 8)}`;

async function main(): Promise<void> {
  const organizationId = arg('organization-id');
  const userId = arg('user-id');
  const clientCode = arg('client-code') ?? 'estimat';
  const scopes = (arg('scopes') ?? ALL_SCOPES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

  if (!organizationId || !UUID_RE.test(organizationId)) fail('нужен --organization-id <uuid>');
  if (!userId || !UUID_RE.test(userId)) fail('нужен --user-id <uuid>');
  const unknown = scopes.filter((s) => !ALL_SCOPES.includes(s as (typeof ALL_SCOPES)[number]));
  if (unknown.length > 0) fail(`неизвестные scopes: ${unknown.join(', ')}. Допустимы: ${ALL_SCOPES.join(', ')}`);
  if (clientCode.length > 32) fail('--client-code длиннее 32 символов');

  const sql = postgres(DATABASE_URL, { max: 1, ...pgSslOption() });
  try {
    const [org] = await sql<{ id: string; kind: string; deleted_at: Date | null }[]>`
      SELECT id, kind, deleted_at FROM organizations WHERE id = ${organizationId}
    `;
    if (!org) fail(`организация ${organizationId} не найдена`);
    if (org.deleted_at) fail('организация удалена');
    // Тендеры выставляет заказчик — это внутренняя организация, не поставщик.
    if (org.kind !== 'internal') fail(`организация должна быть kind='internal', а не '${org.kind}'`);

    const [user] = await sql<
      { id: string; role: string; is_active: boolean; organization_id: string | null; deleted_at: Date | null }[]
    >`SELECT id, role, is_active, organization_id, deleted_at FROM users WHERE id = ${userId}`;
    if (!user) fail(`пользователь ${userId} не найден`);
    if (user.deleted_at || !user.is_active) fail('технический пользователь удалён или отключён');
    if (user.role !== 'manager' && user.role !== 'admin') {
      fail(`роль технического пользователя должна быть manager или admin, а не '${user.role}'`);
    }
    if (user.organization_id !== organizationId) {
      fail('технический пользователь не принадлежит указанной организации');
    }

    // 256 бит энтропии; полный ключ = `<prefix>.<secret>`, хэшируется целиком.
    const secret = randomBytes(32).toString('base64url');
    let fullKey = '';
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const prefix = newPrefix();
      fullKey = `${prefix}.${secret}`;
      const keyHash = createHash('sha256').update(fullKey, 'utf8').digest('hex');
      try {
        await sql`
          INSERT INTO api_keys (organization_id, user_id, client_code, key_prefix, key_hash, scopes)
          VALUES (${organizationId}, ${userId}, ${clientCode}, ${prefix}, ${keyHash}, ${sql.array(scopes)})
        `;
        inserted = true;
      } catch (err) {
        // коллизия префикса маловероятна, но повторить дешевле, чем упасть
        if ((err as { code?: string }).code === '23505') continue;
        throw err;
      }
    }
    if (!inserted) fail('не удалось подобрать свободный префикс ключа — повторите запуск');

    // Печатаем только после успешной вставки: иначе выдали бы клиенту мёртвый ключ.
    console.log('\nКлюч выпущен. Показывается ОДИН раз — сохраните его в secret store EstiMat:\n');
    console.log(`  ${fullKey}\n`);
    console.log(`  организация : ${organizationId}`);
    console.log(`  actor       : ${userId} (${user.role})`);
    console.log(`  client_code : ${clientCode}`);
    console.log(`  scopes      : ${scopes.join(', ')}\n`);
    console.log('Заголовок запроса:  Authorization: Bearer <ключ>');
    console.log('Отзыв:  UPDATE api_keys SET revoked_at = now() WHERE key_prefix = \'<префикс>\';\n');
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Не удалось выпустить ключ:', err);
    process.exit(1);
  });
}
