import { and, desc, eq, isNull } from 'drizzle-orm';
import type {
  CreateUserInput,
  ChangePasswordInput,
  UpdateUserInput,
  UserSummary,
} from '@zakupki/shared';
import { organizations, users, type Database } from '@zakupki/db';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/passwords';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

type UserWithOrg = typeof users.$inferSelect & {
  organization: typeof organizations.$inferSelect | null;
};

function mapUser(u: UserWithOrg): UserSummary {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    organizationId: u.organizationId,
    organizationName: u.organization?.shortName ?? u.organization?.fullName ?? null,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Количество активных, не удалённых администраторов. */
async function activeAdminIds(db: Database): Promise<string[]> {
  const rows = await db.query.users.findMany({
    where: and(eq(users.role, 'admin'), eq(users.isActive, true), isNull(users.deletedAt)),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Проверка «не остаться без единственного администратора» перед деактивацией/демоутом/удалением. */
async function assertNotLastAdmin(db: Database, target: typeof users.$inferSelect): Promise<void> {
  const isCurrentlyActiveAdmin =
    target.role === 'admin' && target.isActive && target.deletedAt === null;
  if (!isCurrentlyActiveAdmin) return;
  const admins = await activeAdminIds(db);
  if (admins.length <= 1) {
    throw badRequest('Нельзя убрать последнего активного администратора портала');
  }
}

export async function listUsers(db: Database): Promise<UserSummary[]> {
  const rows = await db.query.users.findMany({
    where: isNull(users.deletedAt),
    with: { organization: true },
    orderBy: [desc(users.createdAt)],
  });
  return rows.map((u) => mapUser(u as UserWithOrg));
}

export async function createUser(db: Database, input: CreateUserInput): Promise<UserSummary> {
  const passwordHash = await hashPassword(input.password);
  let userId: string;
  try {
    const [row] = await db
      .insert(users)
      .values({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash,
        role: input.role,
        organizationId: input.organizationId ?? null,
        isActive: input.isActive,
      })
      .returning({ id: users.id });
    userId = row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Пользователь с таким email уже существует');
    throw err;
  }
  const created = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { organization: true },
  });
  return mapUser(created as UserWithOrg);
}

export async function updateUser(
  db: Database,
  actingUserId: string,
  id: string,
  patch: UpdateUserInput,
): Promise<UserSummary> {
  const target = await db.query.users.findFirst({
    where: and(eq(users.id, id), isNull(users.deletedAt)),
  });
  if (!target) throw notFound('Пользователь не найден');

  const deactivatingSelf = id === actingUserId && patch.isActive === false;
  if (deactivatingSelf) throw badRequest('Нельзя деактивировать собственную учётную запись');

  const demotingSelf = id === actingUserId && patch.role !== undefined && patch.role !== 'admin';
  if (demotingSelf) throw badRequest('Нельзя снять с себя роль администратора');

  const willDeactivate = patch.isActive === false;
  const willDemote = patch.role !== undefined && patch.role !== 'admin';
  if (willDeactivate || willDemote) await assertNotLastAdmin(db, target);

  try {
    await db
      .update(users)
      .set({
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.organizationId !== undefined ? { organizationId: patch.organizationId } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Пользователь с таким email уже существует');
    throw err;
  }

  const updated = await db.query.users.findFirst({
    where: eq(users.id, id),
    with: { organization: true },
  });
  return mapUser(updated as UserWithOrg);
}

export async function changePassword(
  db: Database,
  id: string,
  input: ChangePasswordInput,
): Promise<void> {
  const target = await db.query.users.findFirst({
    where: and(eq(users.id, id), isNull(users.deletedAt)),
  });
  if (!target) throw notFound('Пользователь не найден');
  const passwordHash = await hashPassword(input.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function softDeleteUser(
  db: Database,
  actingUserId: string,
  id: string,
): Promise<void> {
  if (id === actingUserId) throw forbidden('Нельзя удалить собственную учётную запись');
  const target = await db.query.users.findFirst({
    where: and(eq(users.id, id), isNull(users.deletedAt)),
  });
  if (!target) throw notFound('Пользователь не найден');
  await assertNotLastAdmin(db, target);
  await db
    .update(users)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(users.id, id));
}
