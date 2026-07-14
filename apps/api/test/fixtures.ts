// Общая обвязка интеграционных тестов: приложение, чистка данных, фикстуры.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiKeys, organizations, tenders, users } from '@zakupki/db';
import { buildApp } from '../src/server';

export type App = FastifyInstance;

let app: App | null = null;

/** Приложение поднимается один раз на прогон: пул соединений дорог. */
export async function getApp(): Promise<App> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
}

/** Полная очистка между тестами. Порядок не важен — CASCADE разберётся. */
export async function resetData(instance: App): Promise<void> {
  await instance.sql.unsafe(`TRUNCATE TABLE
    bid_history, bid_items, bids, tender_positions, tenders,
    invitations, files, notifications, api_keys, category_subscriptions,
    accreditation_reviews, auth_refresh_tokens, password_reset_tokens,
    users, organizations, categories
    RESTART IDENTITY CASCADE`);
}

let seq = 0;
const uniq = (): string => `${Date.now().toString(36)}-${(seq += 1)}`;

export async function makeOrg(
  instance: App,
  opts: { kind?: 'internal' | 'supplier'; name?: string; accredited?: boolean } = {},
): Promise<string> {
  const [org] = await instance.db
    .insert(organizations)
    .values({
      kind: opts.kind ?? 'supplier',
      fullName: opts.name ?? `ООО «Тест ${uniq()}»`,
      shortName: opts.name ?? `Тест ${uniq()}`,
      inn: String(1_000_000_000 + (seq % 899_999_999)),
      ogrn: String(1_000_000_000_000 + (seq % 899_999_999)),
      legalAddress: 'г. Москва, тестовая ул., 1',
      accreditationStatus: opts.accredited ? 'accredited' : 'none',
    })
    .returning({ id: organizations.id });
  return org!.id;
}

export async function makeUser(
  instance: App,
  opts: { orgId?: string | null; role?: 'admin' | 'manager' | 'security' | 'supplier'; active?: boolean },
): Promise<string> {
  const [user] = await instance.db
    .insert(users)
    .values({
      organizationId: opts.orgId ?? null,
      email: `user-${uniq()}@test.local`,
      fullName: 'Тестовый пользователь',
      role: opts.role ?? 'supplier',
      isActive: opts.active ?? true,
    })
    .returning({ id: users.id });
  return user!.id;
}

export interface MintedKey {
  id: string;
  prefix: string;
  /** Полный ключ для заголовка Authorization: Bearer. */
  token: string;
}

/** Выпускает ключ так же, как CLI: в БД только префикс и SHA-256 полного ключа. */
export async function mintKey(
  instance: App,
  opts: {
    orgId: string;
    userId: string;
    scopes?: string[];
    clientCode?: string;
    revoked?: boolean;
  },
): Promise<MintedKey> {
  const prefix = `zk_${randomBytes(6).toString('base64url').slice(0, 8)}`;
  const token = `${prefix}.${randomBytes(32).toString('base64url')}`;
  const [row] = await instance.db
    .insert(apiKeys)
    .values({
      organizationId: opts.orgId,
      userId: opts.userId,
      clientCode: opts.clientCode ?? 'estimat',
      keyPrefix: prefix,
      keyHash: createHash('sha256').update(token, 'utf8').digest('hex'),
      scopes: opts.scopes ?? ['tenders:create', 'tenders:read', 'tenders:cancel'],
      revokedAt: opts.revoked ? new Date() : null,
    })
    .returning({ id: apiKeys.id });
  return { id: row!.id, prefix, token };
}

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

/** Заказчик + технический actor + ключ — типовая связка EstiMat. */
export async function makeBuyerWithKey(instance: App): Promise<{
  orgId: string;
  userId: string;
  key: MintedKey;
}> {
  const orgId = await makeOrg(instance, { kind: 'internal', name: 'ООО «СУ-10»' });
  const userId = await makeUser(instance, { orgId, role: 'manager' });
  const key = await mintKey(instance, { orgId, userId });
  return { orgId, userId, key };
}

/** Тело запроса на создание тендера в контракте EstiMat. */
export function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Закупочный лот № Л-003',
    external_ref: `estimat:lot:${randomUUID()}`,
    source_revision: 3,
    deadline_at: new Date(Date.now() + 86_400_000).toISOString(),
    vat_rate: 'vat20',
    items: [{ material: 'Цемент М500', quantity: '120.000', unit: 'kg', spec: 'ГОСТ 31108-2020' }],
    conditions: {
      delivery: 'Самовывоз',
      payment: 'Отсрочка 30 дней',
      deadline: 'до 30 июля',
      place: 'г. Москва, объект 1',
    },
    ...over,
  };
}

/** Сдвигает дедлайн в прошлое в обход доменных проверок — имитация «время прошло». */
export async function expireDeadline(instance: App, tenderId: string): Promise<void> {
  await instance.sql.unsafe(
    `UPDATE tenders SET deadline_at = now() - interval '1 minute',
       original_deadline_at = now() - interval '1 minute' WHERE id = $1`,
    [tenderId],
  );
}

export const tenderRow = (instance: App, id: string) =>
  instance.db.query.tenders.findFirst({ where: (t, { eq }) => eq(t.id, id) });

export { tenders };
