import { and, eq, isNull } from 'drizzle-orm';
import type { AuthUser, Role } from '@zakupki/shared';
import { authRefreshTokens, users, type Database } from '@zakupki/db';
import { env } from '../../config/env';
import { conflict, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/passwords';
import { newUuid, randomToken, sha256 } from '../../lib/tokens';

export async function loadAuthUser(db: Database, userId: string): Promise<AuthUser | null> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), isNull(users.deletedAt)),
    with: { organization: true },
  });
  if (!user) return null;
  const org = user.organization;
  const companyCardComplete = Boolean(org && org.inn && org.ogrn && org.legalAddress);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: org?.shortName ?? org?.fullName ?? null,
    accreditationStatus: org?.accreditationStatus ?? null,
    companyCardComplete,
  };
}

export async function registerUser(
  db: Database,
  input: { fullName: string; email: string; password: string; phone?: string },
  role: Role = 'supplier',
): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: and(eq(users.email, input.email), isNull(users.deletedAt)),
  });
  if (existing) throw conflict('Пользователь с таким email уже зарегистрирован');
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      fullName: input.fullName,
      phone: input.phone ?? null,
      passwordHash,
      role,
    })
    .returning({ id: users.id });
  return row!.id;
}

export async function verifyCredentials(
  db: Database,
  email: string,
  password: string,
): Promise<string> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deletedAt)),
  });
  if (!user || !user.passwordHash || !user.isActive) throw unauthorized('Неверный email или пароль');
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw unauthorized('Неверный email или пароль');
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return user.id;
}

/** Issue a new refresh token in a family. Returns the raw token to set as a cookie. */
export async function issueRefreshToken(
  db: Database,
  userId: string,
  meta: { userAgent?: string; ip?: string },
  familyId = newUuid(),
): Promise<string> {
  const raw = randomToken();
  await db.insert(authRefreshTokens).values({
    userId,
    tokenHash: sha256(raw),
    familyId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  return raw;
}

/** Rotate a refresh token. Detects reuse of a revoked token → revokes the whole family. */
export async function rotateRefreshToken(
  db: Database,
  rawToken: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ userId: string; refresh: string }> {
  const tokenHash = sha256(rawToken);
  const row = await db.query.authRefreshTokens.findFirst({
    where: eq(authRefreshTokens.tokenHash, tokenHash),
  });
  if (!row) throw unauthorized('Сессия недействительна');

  if (row.revokedAt || row.expiresAt < new Date()) {
    // reuse of an already-rotated token → revoke family
    await db
      .update(authRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(authRefreshTokens.familyId, row.familyId));
    throw unauthorized('Сессия недействительна');
  }

  await db
    .update(authRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(authRefreshTokens.id, row.id));
  const refresh = await issueRefreshToken(db, row.userId, meta, row.familyId);
  return { userId: row.userId, refresh };
}

export async function revokeToken(db: Database, rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  const row = await db.query.authRefreshTokens.findFirst({
    where: eq(authRefreshTokens.tokenHash, tokenHash),
  });
  if (row) {
    await db
      .update(authRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(authRefreshTokens.familyId, row.familyId));
  }
}

export function newCsrf(): string {
  return randomToken(24);
}
