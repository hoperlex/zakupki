import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import type {
  CreateTenderInput,
  PositionOutput,
  Role,
  TenderDetail,
  TenderListQuery,
  TenderSummary,
  TenderType,
  UpdateTenderInput,
} from '@zakupki/shared';
import {
  categories,
  files,
  organizations,
  tenderPositions,
  tenders,
  users,
  type Database,
  type DbClient,
  type Transaction,
} from '@zakupki/db';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { bus } from '../../lib/events';
import { hasInvitationAccess } from '../invitations/service';

export interface Viewer {
  userId: string;
  role: Role;
  orgId: string | null;
}

/** Происхождение тендера из внешней системы (машинный API). */
export interface TenderSource {
  sourceSystem: string;
  externalRef: string;
  sourceRevision: number | null;
  sourcePayloadHash: string;
  sourceApiKeyId: string | null;
}

/**
 * Инкремент монотонной ревизии состояния. Внешний клиент применяет только
 * более новое состояние, поэтому каждый переход жизненного цикла обязан
 * двигать revision: публикация, смена/автопродление дедлайна, переход по
 * дедлайну, отмена, award, закрытие без победителя.
 */
export const bumpRevision = () => sql`${tenders.revision} + 1`;

const PUBLIC_STATUSES = ['published', 'collecting', 'under_review', 'awarded', 'closed'] as const;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export async function listTenders(
  db: Database,
  query: TenderListQuery & { mine?: boolean },
  viewer: Viewer | null,
): Promise<{ items: TenderSummary[]; total: number; page: number; limit: number }> {
  const conds = [isNull(tenders.deletedAt)];
  if (query.mine && viewer && (viewer.role === 'manager' || viewer.role === 'admin')) {
    if (viewer.orgId) conds.push(eq(tenders.organizationId, viewer.orgId));
  } else {
    conds.push(eq(tenders.visibility, 'open'));
    conds.push(inArray(tenders.status, [...PUBLIC_STATUSES]));
  }
  if (query.type) conds.push(eq(tenders.type, query.type));
  if (query.categoryId) conds.push(eq(tenders.categoryId, query.categoryId));
  if (query.status) conds.push(eq(tenders.status, query.status));
  if (query.search) conds.push(ilike(tenders.title, `%${query.search}%`));

  const where = and(...conds);
  const orderBy =
    query.sort === 'deadline_desc'
      ? desc(tenders.deadlineAt)
      : query.sort === 'created_desc'
        ? desc(tenders.createdAt)
        : asc(tenders.deadlineAt);

  const offset = (query.page - 1) * query.limit;

  const rows = await db
    .select({
      id: tenders.id,
      number: tenders.number,
      title: tenders.title,
      type: tenders.type,
      visibility: tenders.visibility,
      status: tenders.status,
      categoryName: categories.name,
      organizationName: organizations.shortName,
      organizationFullName: organizations.fullName,
      startsAt: tenders.startsAt,
      deadlineAt: tenders.deadlineAt,
      createdAt: tenders.createdAt,
      positionsCount: sql<number>`(select count(*) from tender_positions p where p.tender_id = ${tenders.id})`.mapWith(
        Number,
      ),
      participantsCount:
        sql<number>`(select count(*) from bids b where b.tender_id = ${tenders.id} and b.status <> 'withdrawn')`.mapWith(
          Number,
        ),
    })
    .from(tenders)
    .leftJoin(categories, eq(categories.id, tenders.categoryId))
    .leftJoin(organizations, eq(organizations.id, tenders.organizationId))
    .where(where)
    .orderBy(orderBy)
    .limit(query.limit)
    .offset(offset);

  const totalRows = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(tenders)
    .where(where);
  const total = totalRows[0]?.total ?? 0;

  const items: TenderSummary[] = rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    type: row.type,
    visibility: row.visibility,
    status: row.status,
    categoryName: row.categoryName,
    organizationName: row.organizationName ?? row.organizationFullName ?? '—',
    positionsCount: row.positionsCount,
    participantsCount: row.participantsCount,
    startsAt: iso(row.startsAt),
    deadlineAt: row.deadlineAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, total, page: query.page, limit: query.limit };
}

function mapPosition(p: typeof tenderPositions.$inferSelect): PositionOutput {
  return {
    id: p.id,
    positionNo: p.positionNo,
    name: p.name,
    categoryId: p.categoryId,
    unit: p.unit,
    quantity: p.quantity,
    spec: p.spec,
    isRequired: p.isRequired,
    targetPrice: p.targetPrice,
  };
}

export async function getTenderDetail(
  db: Database,
  id: string,
  viewer: Viewer | null,
): Promise<TenderDetail> {
  const tender = await db.query.tenders.findFirst({
    where: and(eq(tenders.id, id), isNull(tenders.deletedAt)),
    with: {
      category: true,
      organization: true,
      positions: { orderBy: [asc(tenderPositions.positionNo)] },
    },
  });
  if (!tender) throw notFound('Тендер не найден');

  const isManager = viewer && (viewer.role === 'manager' || viewer.role === 'admin');
  // closed tenders: only owner staff, participants (have a bid), or invited (accepted invitation) may view
  if (tender.visibility === 'closed' && !isManager) {
    const participant = viewer?.orgId
      ? await db.query.bids.findFirst({
          where: (b, { and: a, eq: e }) => a(e(b.tenderId, id), e(b.supplierOrgId, viewer.orgId!)),
        })
      : null;
    const invited = viewer ? await hasInvitationAccess(db, id, viewer.userId) : false;
    if (!participant && !invited) throw forbidden('Тендер доступен только приглашённым участникам');
  }
  if (tender.status === 'draft' && !isManager) throw notFound('Тендер не найден');

  const docs = await db.query.files.findMany({
    where: and(eq(files.ownerType, 'tender'), eq(files.ownerId, id), isNull(files.deletedAt)),
  });

  const participantsCount = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(sql`bids`)
    .where(sql`bids.tender_id = ${id} and bids.status <> 'withdrawn'`)
    .then((r) => r[0]?.n ?? 0);

  const { canBid, bidBlockReason } = await computeCanBid(db, tender, viewer);

  return {
    id: tender.id,
    number: tender.number,
    title: tender.title,
    type: tender.type,
    visibility: tender.visibility,
    status: tender.status,
    categoryName: tender.category?.name ?? null,
    organizationName: tender.organization?.shortName ?? tender.organization?.fullName ?? '—',
    positionsCount: tender.positions.length,
    participantsCount,
    startsAt: iso(tender.startsAt),
    deadlineAt: tender.deadlineAt.toISOString(),
    createdAt: tender.createdAt.toISOString(),
    description: tender.description,
    terms: tender.terms ?? null,
    expectedVatRate: tender.expectedVatRate,
    minStepPct: tender.minStepPct,
    minStepAbs: tender.minStepAbs,
    autoExtendEnabled: tender.autoExtendEnabled,
    autoExtendWindowSec: tender.autoExtendWindowSec,
    autoExtendStepSec: tender.autoExtendStepSec,
    autoExtendMaxCount: tender.autoExtendMaxCount,
    extendCount: tender.extendCount,
    originalDeadlineAt: tender.originalDeadlineAt.toISOString(),
    awardedBidId: tender.awardedBidId,
    positions: tender.positions.map(mapPosition),
    documents: docs.map((d) => ({ id: d.id, originalName: d.originalName, sizeBytes: d.sizeBytes })),
    canBid,
    bidBlockReason,
  };
}

async function computeCanBid(
  db: Database,
  tender: typeof tenders.$inferSelect,
  viewer: Viewer | null,
): Promise<{ canBid: boolean; bidBlockReason: string | null }> {
  if (tender.status !== 'collecting') return { canBid: false, bidBlockReason: 'Приём предложений не открыт' };
  if (tender.deadlineAt < new Date()) return { canBid: false, bidBlockReason: 'Срок приёма истёк' };
  if (!viewer) return { canBid: false, bidBlockReason: 'Войдите, чтобы участвовать' };
  if (viewer.role !== 'supplier')
    return { canBid: false, bidBlockReason: 'Только поставщики подают предложения' };
  // resolve org from DB — the JWT orgId can be stale right after the org is created
  const user = await db.query.users.findFirst({ where: eq(users.id, viewer.userId) });
  const orgId = user?.organizationId;
  if (!orgId) return { canBid: false, bidBlockReason: 'Заполните карточку компании' };
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org || !org.inn || !org.ogrn || !org.legalAddress)
    return { canBid: false, bidBlockReason: 'Заполните карточку компании' };

  // Invited participants on closed tenders may bid without prior accreditation.
  // (Access to a closed tender's detail is already gated to invited/participants.)
  const isClosedInvited = tender.visibility === 'closed';
  if (!isClosedInvited && org.accreditationStatus !== 'accredited') {
    return { canBid: false, bidBlockReason: 'Требуется аккредитация службой безопасности' };
  }
  return { canBid: true, bidBlockReason: null };
}

// ─── manager operations ───

/** Произвольная, но стабильная константа пространства блокировки номеров тендеров. */
const TENDER_NUMBER_LOCK = 774_201;

/**
 * Следующий номер тендера за текущий год.
 *
 * Только внутри транзакции: max+1 без блокировки даёт двум параллельным
 * созданиям один номер (и падение на tenders_number_uq). Advisory-lock
 * сериализует их и снимается вместе с транзакцией.
 */
async function nextTenderNumberTx(tx: Transaction): Promise<string> {
  const year = new Date().getFullYear();
  await tx.execute(sql`select pg_advisory_xact_lock(${TENDER_NUMBER_LOCK}::int4, ${year}::int4)`);
  const prefix = `T-${year}-`;
  const rows = await tx
    .select({ number: tenders.number })
    .from(tenders)
    .where(ilike(tenders.number, `${prefix}%`));
  let max = 0;
  for (const r of rows) {
    const n = Number(r.number.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

/**
 * Вставка тендера с позициями внутри ЧУЖОЙ транзакции — чтобы вызывающий мог
 * доклеить к ней публикацию и не оставить полуфабрикат при сбое.
 * `source` заполняется только машинным API.
 */
export async function insertTenderTx(
  tx: Transaction,
  input: CreateTenderInput,
  viewer: Viewer,
  source?: TenderSource,
): Promise<{ id: string; number: string }> {
  if (!viewer.orgId) throw badRequest('У пользователя не указана организация');
  const number = await nextTenderNumberTx(tx);
  const deadline = new Date(input.deadlineAt);
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const [tender] = await tx
    .insert(tenders)
    .values({
      number,
      title: input.title,
      type: input.type,
      visibility: input.visibility,
      status: 'draft',
      categoryId: input.categoryId ?? null,
      organizationId: viewer.orgId,
      createdBy: viewer.userId,
      description: input.description ?? null,
      terms: input.terms ?? null,
      expectedVatRate: input.expectedVatRate,
      minStepPct: input.minStepPct ?? null,
      minStepAbs: input.minStepAbs ?? null,
      startsAt,
      deadlineAt: deadline,
      originalDeadlineAt: deadline,
      autoExtendEnabled: input.autoExtendEnabled,
      autoExtendWindowSec: input.autoExtendWindowSec,
      autoExtendStepSec: input.autoExtendStepSec,
      autoExtendMaxCount: input.autoExtendMaxCount,
      sourceSystem: source?.sourceSystem ?? null,
      externalRef: source?.externalRef ?? null,
      sourceRevision: source?.sourceRevision ?? null,
      sourcePayloadHash: source?.sourcePayloadHash ?? null,
      sourceApiKeyId: source?.sourceApiKeyId ?? null,
    })
    .returning({ id: tenders.id, number: tenders.number });
  await tx.insert(tenderPositions).values(
    input.positions.map((p) => ({
      tenderId: tender!.id,
      positionNo: p.positionNo,
      name: p.name,
      categoryId: p.categoryId ?? null,
      unit: p.unit,
      quantity: p.quantity,
      spec: p.spec ?? null,
      isRequired: p.isRequired,
      targetPrice: p.targetPrice ?? null,
      sourceUnit: p.sourceUnit ?? null,
    })),
  );
  return { id: tender!.id, number: tender!.number };
}

export async function createTender(
  db: Database,
  input: CreateTenderInput,
  viewer: Viewer,
): Promise<string> {
  const { id } = await db.transaction((tx) => insertTenderTx(tx, input, viewer));
  return id;
}

async function loadOwnedTender(db: DbClient, id: string, viewer: Viewer) {
  const tender = await db.query.tenders.findFirst({
    where: and(eq(tenders.id, id), isNull(tenders.deletedAt)),
  });
  if (!tender) throw notFound('Тендер не найден');
  if (viewer.role !== 'admin' && tender.organizationId !== viewer.orgId) {
    throw forbidden('Нет доступа к этому тендеру');
  }
  return tender;
}

export async function updateTender(
  db: Database,
  id: string,
  input: UpdateTenderInput,
  viewer: Viewer,
): Promise<void> {
  const tender = await loadOwnedTender(db, id, viewer);
  if (!['draft', 'published'].includes(tender.status)) {
    throw conflict('Редактировать можно только черновик или неопубликованный тендер');
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.type !== undefined) patch.type = input.type;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
  if (input.description !== undefined) patch.description = input.description;
  if (input.terms !== undefined) patch.terms = input.terms;
  if (input.expectedVatRate !== undefined) patch.expectedVatRate = input.expectedVatRate;
  if (input.minStepPct !== undefined) patch.minStepPct = input.minStepPct;
  if (input.minStepAbs !== undefined) patch.minStepAbs = input.minStepAbs;
  if (input.autoExtendEnabled !== undefined) patch.autoExtendEnabled = input.autoExtendEnabled;
  if (input.autoExtendWindowSec !== undefined) patch.autoExtendWindowSec = input.autoExtendWindowSec;
  if (input.autoExtendStepSec !== undefined) patch.autoExtendStepSec = input.autoExtendStepSec;
  if (input.autoExtendMaxCount !== undefined) patch.autoExtendMaxCount = input.autoExtendMaxCount;
  if (input.deadlineAt !== undefined) {
    const dl = new Date(input.deadlineAt);
    patch.deadlineAt = dl;
    patch.originalDeadlineAt = dl;
    // сдвиг дедлайна — значимое для внешнего клиента изменение состояния
    patch.revision = bumpRevision();
  }
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  await db.update(tenders).set(patch).where(eq(tenders.id, id));
}

export async function replacePositions(
  db: Database,
  id: string,
  positions: CreateTenderInput['positions'],
  viewer: Viewer,
): Promise<void> {
  const tender = await loadOwnedTender(db, id, viewer);
  if (!['draft', 'published'].includes(tender.status)) {
    throw conflict('Изменять позиции можно только до начала приёма предложений');
  }
  await db.transaction(async (tx) => {
    await tx.delete(tenderPositions).where(eq(tenderPositions.tenderId, id));
    await tx.insert(tenderPositions).values(
      positions.map((p) => ({
        tenderId: id,
        positionNo: p.positionNo,
        name: p.name,
        categoryId: p.categoryId ?? null,
        unit: p.unit,
        quantity: p.quantity,
        spec: p.spec ?? null,
        isRequired: p.isRequired,
        targetPrice: p.targetPrice ?? null,
        sourceUnit: p.sourceUnit ?? null,
      })),
    );
  });
}

/** Публикация внутри чужой транзакции (см. insertTenderTx). */
export async function publishTenderTx(tx: Transaction, id: string, viewer: Viewer): Promise<void> {
  const tender = await loadOwnedTender(tx, id, viewer);
  if (tender.status !== 'draft' && tender.status !== 'published') {
    throw conflict('Тендер уже опубликован или завершён');
  }
  const positionsCount = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(tenderPositions)
    .where(eq(tenderPositions.tenderId, id))
    .then((r) => r[0]?.n ?? 0);
  if (positionsCount === 0) throw badRequest('Добавьте хотя бы одну позицию перед публикацией');

  const now = new Date();
  const status = tender.startsAt && tender.startsAt > now ? 'published' : 'collecting';
  await tx
    .update(tenders)
    .set({ status, publishedAt: now, updatedAt: now, revision: bumpRevision() })
    .where(eq(tenders.id, id));
}

export async function publishTender(db: Database, id: string, viewer: Viewer): Promise<void> {
  await db.transaction((tx) => publishTenderTx(tx, id, viewer));
}

/** Отмена внутри чужой транзакции (см. cancelTender). */
export async function cancelTenderTx(
  tx: Transaction,
  id: string,
  viewer: Viewer,
  reason?: string,
): Promise<void> {
  const tender = await loadOwnedTender(tx, id, viewer);
  if (!['draft', 'published', 'collecting'].includes(tender.status)) {
    throw conflict('Тендер нельзя отменить на текущей стадии');
  }
  await tx
    .update(tenders)
    .set({
      status: 'cancelled',
      closeReason: reason ?? null,
      updatedAt: new Date(),
      revision: bumpRevision(),
    })
    .where(eq(tenders.id, id));
}

export async function cancelTender(
  db: Database,
  id: string,
  viewer: Viewer,
  reason?: string,
): Promise<void> {
  await db.transaction((tx) => cancelTenderTx(tx, id, viewer, reason));
  bus.emitTenderChanged(id, 'status');
}

/**
 * Завершение без победителя: under_review → closed с обязательной причиной.
 * Без этого тендер без ставок (или без выбора) висит «на рассмотрении» вечно,
 * а внешний клиент никогда не получает исход.
 */
export async function closeTenderWithoutAward(
  db: Database,
  id: string,
  viewer: Viewer,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // строчная блокировка: award и закрытие не должны разъехаться
    const [tender] = await tx
      .select()
      .from(tenders)
      .where(and(eq(tenders.id, id), isNull(tenders.deletedAt)))
      .for('update');
    if (!tender) throw notFound('Тендер не найден');
    if (viewer.role !== 'admin' && tender.organizationId !== viewer.orgId) {
      throw forbidden('Нет доступа к этому тендеру');
    }
    if (tender.status !== 'under_review') {
      throw conflict('Завершить без победителя можно только тендер на рассмотрении');
    }
    const now = new Date();
    await tx
      .update(tenders)
      .set({
        status: 'closed',
        closeReason: reason,
        finishedAt: now,
        updatedAt: now,
        revision: bumpRevision(),
      })
      .where(eq(tenders.id, id));
  });
  bus.emitTenderChanged(id, 'status');
}
