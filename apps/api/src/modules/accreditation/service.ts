import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  AccreditationQueueItem,
  AccreditationReview,
  AccredVerdict,
  AccreditationStatus,
} from '@zakupki/shared';
import {
  accreditationReviews,
  files,
  organizations,
  users,
  type Database,
} from '@zakupki/db';
import { badRequest, notFound } from '../../lib/errors';
import { notifyOrg } from '../../lib/notify';
import { env } from '../../config/env';

const VERDICT_TO_STATUS: Record<AccredVerdict, AccreditationStatus> = {
  approved: 'accredited',
  needs_docs: 'needs_docs',
  rejected: 'rejected',
  suspended: 'suspended',
};

const VERDICT_MESSAGE: Record<AccredVerdict, string> = {
  approved: 'Ваша компания успешно аккредитована. Теперь вы можете участвовать в открытых тендерах.',
  needs_docs: 'Служба безопасности запросила дополнительные документы для аккредитации.',
  rejected: 'Аккредитация отклонена службой безопасности.',
  suspended: 'Аккредитация вашей компании приостановлена.',
};

export async function getQueue(db: Database, status?: string): Promise<AccreditationQueueItem[]> {
  const statuses = status ? [status] : ['pending', 'under_review', 'needs_docs'];
  const rows = await db
    .select({
      organizationId: organizations.id,
      fullName: organizations.fullName,
      inn: organizations.inn,
      accreditationStatus: organizations.accreditationStatus,
      submittedAt: organizations.accreditationSubmittedAt,
      documentsCount:
        sql<number>`(select count(*) from files f where f.owner_type = 'organization' and f.owner_id = ${organizations.id} and f.deleted_at is null)`.mapWith(
          Number,
        ),
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.kind, 'supplier'),
        inArray(organizations.accreditationStatus, statuses as AccreditationStatus[]),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(asc(organizations.accreditationSubmittedAt));

  return rows.map((r) => ({
    organizationId: r.organizationId,
    fullName: r.fullName,
    inn: r.inn,
    accreditationStatus: r.accreditationStatus,
    documentsCount: r.documentsCount,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
  }));
}

export async function getReviewHistory(
  db: Database,
  orgId: string,
): Promise<AccreditationReview[]> {
  const rows = await db
    .select({
      id: accreditationReviews.id,
      verdict: accreditationReviews.verdict,
      note: accreditationReviews.note,
      createdAt: accreditationReviews.createdAt,
      reviewerName: users.fullName,
    })
    .from(accreditationReviews)
    .leftJoin(users, eq(users.id, accreditationReviews.reviewerId))
    .where(eq(accreditationReviews.organizationId, orgId))
    .orderBy(desc(accreditationReviews.createdAt));

  return rows.map((r) => ({
    id: r.id,
    verdict: r.verdict,
    note: r.note,
    reviewerName: r.reviewerName,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function issueVerdict(
  db: Database,
  reviewerId: string,
  orgId: string,
  input: { verdict: AccredVerdict; note: string },
): Promise<void> {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) throw notFound('Организация не найдена');
  if (org.kind !== 'supplier') throw badRequest('Аккредитация применима только к поставщикам');

  const newStatus = VERDICT_TO_STATUS[input.verdict];
  await db.transaction(async (tx) => {
    await tx.insert(accreditationReviews).values({
      organizationId: orgId,
      reviewerId,
      verdict: input.verdict,
      note: input.note,
    });
    await tx
      .update(organizations)
      .set({ accreditationStatus: newStatus, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
  });

  await notifyOrg(db, orgId, {
    type: 'accreditation',
    title: `Аккредитация: ${VERDICT_MESSAGE[input.verdict].split('.')[0]}`,
    body: `${VERDICT_MESSAGE[input.verdict]} Комментарий СБ: ${input.note}`,
    link: `${env.PUBLIC_WEB_URL}/app/company`,
    email: true,
  });
}

export async function orgDocuments(db: Database, orgId: string) {
  const rows = await db.query.files.findMany({
    where: and(eq(files.ownerType, 'organization'), eq(files.ownerId, orgId), isNull(files.deletedAt)),
  });
  return rows.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    contentType: f.contentType,
    sizeBytes: f.sizeBytes,
    createdAt: f.createdAt.toISOString(),
  }));
}
