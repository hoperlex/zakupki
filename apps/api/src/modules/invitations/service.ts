import { and, desc, eq } from 'drizzle-orm';
import type {
  CreateInvitationsInput,
  InvitationOutput,
  InvitationPreview,
} from '@zakupki/shared';
import { invitations, tenders, users, type Database, type DbClient } from '@zakupki/db';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/tokens';
import { sendMail } from '../../lib/mail';
import { env } from '../../config/env';
import type { Viewer } from '../tenders/service';

const INVITE_TTL_DAYS = 30;

export async function createInvitations(
  db: Database,
  tenderId: string,
  viewer: Viewer,
  input: CreateInvitationsInput,
): Promise<InvitationOutput[]> {
  const tender = await db.query.tenders.findFirst({ where: eq(tenders.id, tenderId) });
  if (!tender) throw notFound('Тендер не найден');
  if (viewer.role !== 'admin' && tender.organizationId !== viewer.orgId) {
    throw forbidden('Нет доступа к тендеру');
  }

  const out: InvitationOutput[] = [];
  for (const inv of input.invitations) {
    const raw = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
    const [row] = await db
      .insert(invitations)
      .values({
        tenderId,
        email: inv.email,
        companyName: inv.companyName ?? null,
        suggestedInn: inv.suggestedInn ?? null,
        tokenHash: sha256(raw),
        invitedBy: viewer.userId,
        expiresAt,
      })
      .returning();
    const link = `${env.PUBLIC_WEB_URL}/invite/${raw}`;
    await sendMail({
      to: inv.email,
      subject: `Приглашение к участию в тендере ${tender.number} — СУ-10`,
      text: `Вас приглашают к участию в тендере «${tender.title}».\nПерейдите по ссылке для участия:\n${link}\n\nСсылка действует до ${expiresAt.toLocaleDateString('ru-RU')}.`,
    }).catch(() => {});
    out.push({
      id: row!.id,
      email: row!.email,
      companyName: row!.companyName,
      suggestedInn: row!.suggestedInn,
      status: row!.status,
      expiresAt: row!.expiresAt.toISOString(),
      acceptedAt: null,
      createdAt: row!.createdAt.toISOString(),
      link,
    });
  }
  return out;
}

export async function listInvitations(
  db: Database,
  tenderId: string,
  viewer: Viewer,
): Promise<InvitationOutput[]> {
  const tender = await db.query.tenders.findFirst({ where: eq(tenders.id, tenderId) });
  if (!tender) throw notFound('Тендер не найден');
  if (viewer.role !== 'admin' && tender.organizationId !== viewer.orgId) throw forbidden('Нет доступа');
  const rows = await db.query.invitations.findMany({
    where: eq(invitations.tenderId, tenderId),
    orderBy: [desc(invitations.createdAt)],
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    companyName: row.companyName,
    suggestedInn: row.suggestedInn,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function findValidInvitation(db: Database, token: string) {
  const row = await db.query.invitations.findFirst({
    where: eq(invitations.tokenHash, sha256(token)),
    with: { tender: { with: { organization: true } } },
  });
  return row;
}

export async function getInvitationPreview(
  db: Database,
  token: string,
): Promise<InvitationPreview> {
  const row = await findValidInvitation(db, token);
  if (!row) return { valid: false, reason: 'Приглашение не найдено', tender: null, email: null, suggestedInn: null };
  if (row.status === 'revoked') {
    return { valid: false, reason: 'Приглашение отозвано', tender: null, email: null, suggestedInn: null };
  }
  if (row.expiresAt < new Date()) {
    return { valid: false, reason: 'Срок приглашения истёк', tender: null, email: null, suggestedInn: null };
  }
  if (row.status === 'pending') {
    await db.update(invitations).set({ status: 'opened', openedAt: new Date() }).where(eq(invitations.id, row.id));
  }
  return {
    valid: true,
    reason: null,
    tender: {
      id: row.tender.id,
      number: row.tender.number,
      title: row.tender.title,
      type: row.tender.type,
      organizationName: row.tender.organization?.shortName ?? row.tender.organization?.fullName ?? '—',
      deadlineAt: row.tender.deadlineAt.toISOString(),
    },
    email: row.email,
    suggestedInn: row.suggestedInn,
  };
}

/** Accept an invitation: create (or link) a supplier user, grant access to the tender. */
export async function acceptInvitation(
  db: Database,
  token: string,
  input: { fullName: string; password: string; phone?: string },
  createUser: (email: string, fullName: string, password: string, phone?: string) => Promise<string>,
  existingUserId?: string,
): Promise<{ userId: string; tenderId: string }> {
  const row = await findValidInvitation(db, token);
  if (!row) throw notFound('Приглашение не найдено');
  if (row.status === 'revoked') throw forbidden('Приглашение отозвано');
  if (row.expiresAt < new Date()) throw badRequest('Срок приглашения истёк');
  if (row.status === 'accepted') throw conflict('Приглашение уже использовано');

  let userId = existingUserId;
  if (!userId) {
    const existing = await db.query.users.findFirst({ where: eq(users.email, row.email) });
    if (existing) {
      throw conflict('Пользователь с таким email уже зарегистрирован — войдите и откройте ссылку снова');
    }
    userId = await createUser(row.email, input.fullName, input.password, input.phone);
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  await db
    .update(invitations)
    .set({
      status: 'accepted',
      acceptedUserId: userId,
      acceptedOrgId: user?.organizationId ?? null,
      acceptedAt: new Date(),
    })
    .where(eq(invitations.id, row.id));

  return { userId, tenderId: row.tenderId };
}

/** True if the user was invited to (and accepted) this tender — grants view/bid on closed tenders. */
export async function hasInvitationAccess(
  db: DbClient,
  tenderId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const row = await db.query.invitations.findFirst({
    where: and(eq(invitations.tenderId, tenderId), eq(invitations.acceptedUserId, userId)),
  });
  return Boolean(row);
}

export async function revokeInvitation(
  db: Database,
  invitationId: string,
  viewer: Viewer,
): Promise<void> {
  const row = await db.query.invitations.findFirst({
    where: eq(invitations.id, invitationId),
    with: { tender: true },
  });
  if (!row) throw notFound('Приглашение не найдено');
  if (viewer.role !== 'admin' && row.tender.organizationId !== viewer.orgId) throw forbidden('Нет доступа');
  await db.update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, invitationId));
}
