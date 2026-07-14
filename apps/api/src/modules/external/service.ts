// Внешний машинный API: маппинг «контракт источника ↔ домен портала».
// Доменные правила не дублируются — берутся из modules/tenders/service.

import { createHash } from 'node:crypto';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  RESULT_READY_STATUSES,
  UNITS,
  createTenderInput,
  mapUnit,
  normalizeQuantity,
  normalizeTitle,
  toExternalStatus,
  type CreateTenderInput,
  type ExternalCancelResult,
  type ExternalCreateTenderInput,
  type ExternalOutcome,
  type ExternalResults,
  type ExternalTenderCreated,
  type ExternalTenderState,
} from '@zakupki/shared';
import { bids, tenders, type Database, type DbClient, type Transaction } from '@zakupki/db';
import { env } from '../../config/env';
import {
  badRequest,
  cannotCancelAfterDeadline,
  idempotencyConflict,
  notFound,
  resultsNotReady,
} from '../../lib/errors';
import { bus } from '../../lib/events';
import { cancelTenderTx, insertTenderTx, publishTenderTx, type Viewer } from '../tenders/service';

/** Система-источник. Часть ключа идемпотентности, поэтому значение фиксировано. */
export const SOURCE_SYSTEM = 'estimat';

/** Пространство advisory-локов идемпотентности (не пересекается с локом номеров). */
const SOURCE_REF_LOCK = 774_202;

type TenderRow = typeof tenders.$inferSelect;

export interface ExternalContext {
  viewer: Viewer;
  apiKeyId: string;
}

// PUBLIC_WEB_URL может прийти с хвостовым слэшем — иначе получим `//admin/...`
const webBase = (): string => env.PUBLIC_WEB_URL.replace(/\/+$/, '');
const adminUrl = (id: string): string => `${webBase()}/admin/tenders/${id}`;
const publicUrl = (id: string): string => `${webBase()}/tenders/${id}`;

// ─── идемпотентность ───

/** Стабильное представление тела: порядок ключей в JSON не должен менять хэш. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .sort()
        .map((k) => [k, canonical(src[k])]),
    );
  }
  return value;
}

/**
 * Хэш СЫРОГО тела запроса — до trim, zod-трансформов и дефолтов.
 * Повтор того же тела — реплей, изменённое тело — конфликт. Порядок ключей не
 * важен; пробелы внутри строк, порядок items и явный vs пропущенный параметр —
 * важны (это разное содержимое лота).
 */
export const payloadHash = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(canonical(body)), 'utf8').digest('hex');

/**
 * Сериализует параллельные создания с одним external_ref.
 * Без лока оба запроса дошли бы до вставки и один упал бы на уникальном индексе;
 * с локом второй дожидается первого и честно отдаёт реплей.
 */
async function lockSourceRef(tx: Transaction, orgId: string, externalRef: string): Promise<void> {
  const key = `${orgId}:${SOURCE_SYSTEM}:${externalRef}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SOURCE_REF_LOCK}::int4, hashtext(${key})::int4)`,
  );
}

/** Уникальность (organization_id, source_system, external_ref) нарушена — гонка создаваний. */
function isSourceRefConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string } | null;
  return e?.code === '23505' && e.constraint_name === 'tenders_source_ref_uq';
}

// ─── валидация входа (контракт требует 400, а не 422) ───

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function parseDeadline(raw: string | undefined): Date {
  const value = raw?.trim();
  if (!value) throw badRequest('Не указан deadline_at — срок приёма предложений обязателен');
  if (!ISO_DATETIME.test(value)) {
    throw badRequest(
      'deadline_at должен быть датой-временем ISO 8601 с зоной, например 2026-07-20T12:00:00.000Z',
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('deadline_at не распознан как дата');
  if (date.getTime() <= Date.now()) throw badRequest('deadline_at должен быть в будущем');
  return date;
}

function toPositions(items: ExternalCreateTenderInput['items']): CreateTenderInput['positions'] {
  return items.map((item, i) => {
    const no = i + 1;
    // Неизвестную единицу НЕ подменяем на pcs: это исказило бы предмет закупки.
    const unit = mapUnit(item.unit);
    if (!unit) {
      throw badRequest(
        `Позиция ${no}: неизвестная единица измерения «${item.unit}». Допустимы коды ${UNITS.join(', ')} либо обычные написания (шт, м2, кг, компл…)`,
      );
    }
    const quantity = normalizeQuantity(item.quantity);
    if (!quantity) {
      throw badRequest(
        `Позиция ${no}: некорректное количество «${item.quantity}» — ожидается положительное число не более чем с 3 знаками после запятой`,
      );
    }
    return {
      positionNo: no,
      name: item.material,
      categoryId: null,
      unit,
      quantity,
      spec: item.spec ?? null,
      isRequired: true,
      // Внутреннюю НМЦ источника не принимаем: она не должна утечь поставщикам.
      targetPrice: null,
      sourceUnit: item.unit.trim(),
    };
  });
}

/** Внешний контракт → createTenderInput. Дефолты домена (автопродление и пр.) даёт zod. */
function toDomainInput(input: ExternalCreateTenderInput, deadline: Date): CreateTenderInput {
  return createTenderInput.parse({
    title: normalizeTitle(input.title),
    type: 'materials',
    visibility: 'open',
    expectedVatRate: input.vat_rate ?? 'vat20',
    deadlineAt: deadline.toISOString(),
    terms: {
      payment: input.conditions?.payment,
      delivery: input.conditions?.delivery,
      deliveryPlace: input.conditions?.place,
      deliveryDeadline: input.conditions?.deadline,
    },
    positions: toPositions(input.items),
  });
}

// ─── чтение ───

function findBySourceRef(db: DbClient, orgId: string, externalRef: string) {
  // deletedAt не фильтруем: удалённая строка всё ещё занимает уникальный индекс,
  // и повтор обязан опознать её, а не пытаться вставить заново.
  return db.query.tenders.findFirst({
    where: and(
      eq(tenders.organizationId, orgId),
      eq(tenders.sourceSystem, SOURCE_SYSTEM),
      eq(tenders.externalRef, externalRef),
    ),
  });
}

function orgOf(viewer: Viewer): string {
  if (!viewer.orgId) throw badRequest('Ключ не привязан к организации');
  return viewer.orgId;
}

/** Тендер чужой организации неотличим от несуществующего: 404, а не 403 (admin не в счёт). */
async function loadOwnTender(db: DbClient, id: string, orgId: string): Promise<TenderRow> {
  const tender = await db.query.tenders.findFirst({
    where: and(eq(tenders.id, id), isNull(tenders.deletedAt), eq(tenders.organizationId, orgId)),
  });
  if (!tender) throw notFound('Тендер не найден');
  return tender;
}

function toCreated(row: TenderRow, replayed: boolean): ExternalTenderCreated {
  return {
    id: row.id,
    number: row.number,
    external_ref: row.externalRef ?? '',
    status: toExternalStatus(row.status),
    url: adminUrl(row.id),
    public_url: publicUrl(row.id),
    deadline_at: row.deadlineAt.toISOString(),
    revision: row.revision,
    replayed,
  };
}

/** Повтор: то же тело — отдаём тот же тендер; другое тело — расхождение данных. */
function replayOf(row: TenderRow, hash: string): ExternalTenderCreated {
  // char(64) в PG дополняется пробелами — сравниваем по обрезанному значению
  if (row.sourcePayloadHash?.trim() !== hash) {
    throw idempotencyConflict(
      'Тендер с таким external_ref уже создан с другим содержимым. Изменить опубликованный лот повтором запроса нельзя — используйте новый external_ref',
    );
  }
  return toCreated(row, true);
}

// ─── операции ───

/**
 * Создаёт тендер и СРАЗУ публикует его — одной транзакцией: промежуточного draft
 * при сбое не остаётся.
 *
 * Порядок принципиален. Существующая запись ищется ДО валидации дедлайна: повтор
 * запроса, чей deadline_at уже наступил, обязан вернуть 200 replayed, а не 400.
 * Иначе источник счёл бы живой опубликованный лот несозданным.
 */
export async function createExternalTender(
  db: Database,
  rawBody: unknown,
  input: ExternalCreateTenderInput,
  ctx: ExternalContext,
): Promise<{ status: 200 | 201; body: ExternalTenderCreated }> {
  const orgId = orgOf(ctx.viewer);
  const externalRef = input.external_ref;
  const hash = payloadHash(rawBody);

  try {
    const outcome = await db.transaction(async (tx) => {
      await lockSourceRef(tx, orgId, externalRef);

      const existing = await findBySourceRef(tx, orgId, externalRef);
      if (existing) return { row: existing, replayed: true as const };

      // Валидация, зависящая от времени и содержимого, — только для нового тендера.
      const deadline = parseDeadline(input.deadline_at);
      const domainInput = toDomainInput(input, deadline);

      const { id } = await insertTenderTx(tx, domainInput, ctx.viewer, {
        sourceSystem: SOURCE_SYSTEM,
        externalRef,
        sourceRevision: input.source_revision ?? null,
        sourcePayloadHash: hash,
        sourceApiKeyId: ctx.apiKeyId,
      });
      if (input.publication_mode === 'publish') await publishTenderTx(tx, id, ctx.viewer);

      const [row] = await tx.select().from(tenders).where(eq(tenders.id, id));
      return { row: row!, replayed: false as const };
    });

    // replayOf бросает 409 — вызываем вне транзакции, чтобы не откатывать чужую работу
    if (outcome.replayed) return { status: 200, body: replayOf(outcome.row, hash) };
    bus.emitTenderChanged(outcome.row.id, 'status');
    return { status: 201, body: toCreated(outcome.row, false) };
  } catch (err) {
    // Последний рубеж: уникальный индекс. Читаем ВНЕ откатившейся транзакции —
    // в аборченной запрос уже не выполнить.
    if (isSourceRefConflict(err)) {
      const row = await findBySourceRef(db, orgId, externalRef);
      if (row) return { status: 200, body: replayOf(row, hash) };
    }
    throw err;
  }
}

export async function getExternalTenderState(
  db: Database,
  id: string,
  viewer: Viewer,
): Promise<ExternalTenderState> {
  const tender = await loadOwnTender(db, id, orgOf(viewer));
  return {
    id: tender.id,
    external_ref: tender.externalRef,
    status: toExternalStatus(tender.status),
    url: adminUrl(tender.id),
    revision: tender.revision,
  };
}

/**
 * Итоги тендера. Раскрывает ставки и имена конкурентов, поэтому доступ строго по
 * организации-заказчику из ключа.
 *
 * Читается одной repeatable-read транзакцией: тендер и ставки обязаны быть из
 * одного снимка, иначе award между двумя запросами даст противоречивый ответ.
 * Блокировок не берём — read-эндпоинт не должен тормозить award/cancel.
 */
export async function getExternalResults(
  db: Database,
  id: string,
  viewer: Viewer,
): Promise<ExternalResults> {
  const orgId = orgOf(viewer);
  return db.transaction(
    async (tx) => {
      const tender = await loadOwnTender(tx, id, orgId);
      if (!RESULT_READY_STATUSES.includes(tender.status)) throw resultsNotReady();

      const rows = await tx.query.bids.findMany({
        where: and(eq(bids.tenderId, id), ne(bids.status, 'withdrawn')),
        with: { supplierOrg: true },
        // Детерминированный порядок: у машинного клиента не должно быть «плавания»
        orderBy: [asc(bids.totalWithVat), asc(bids.submittedAt), asc(bids.id)],
      });

      const participants = new Map<string, ExternalResults['participants'][number]>();
      for (const b of rows) {
        if (participants.has(b.supplierOrgId)) continue;
        participants.set(b.supplierOrgId, {
          id: b.supplierOrgId,
          name: b.supplierOrg?.shortName ?? b.supplierOrg?.fullName ?? '—',
          inn: b.supplierOrg?.inn ?? '',
        });
      }

      // Победитель — ТОЛЬКО выбранный менеджером bid, а не автоминимум по цене.
      let winner: ExternalResults['winner'] = null;
      if (tender.awardedBidId) {
        const awardedId = tender.awardedBidId;
        const awarded =
          rows.find((b) => b.id === awardedId) ??
          (await tx.query.bids.findFirst({ where: eq(bids.id, awardedId) }));
        // Ставка-победитель обязана существовать. Отдать в такой ситуации
        // outcome='no_award' значило бы соврать клиенту про итог — падаем.
        if (!awarded) {
          throw new Error(
            `Нарушен инвариант: тендер ${tender.id} ссылается на awarded_bid_id=${awardedId}, которого нет`,
          );
        }
        winner = { participant_id: awarded.supplierOrgId, bid_id: awarded.id };
      }

      const outcome: ExternalOutcome =
        tender.status === 'under_review' ? 'pending' : winner ? 'awarded' : 'no_award';

      return {
        tender_id: tender.id,
        status: toExternalStatus(tender.status),
        outcome,
        participants: [...participants.values()],
        bids: rows.map((b) => ({
          participant_id: b.supplierOrgId,
          bid_id: b.id,
          // decimal-строка: сумма в float потеряла бы копейки
          amount: b.totalWithVat,
          currency: tender.currency,
          submitted_at: b.submittedAt ? b.submittedAt.toISOString() : null,
        })),
        winner,
        finished_at: tender.finishedAt ? tender.finishedAt.toISOString() : null,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export async function cancelExternalTender(
  db: Database,
  id: string,
  viewer: Viewer,
  reason?: string,
): Promise<ExternalCancelResult> {
  const orgId = orgOf(viewer);
  const result = await db.transaction(async (tx) => {
    const [tender] = await tx
      .select()
      .from(tenders)
      .where(and(eq(tenders.id, id), isNull(tenders.deletedAt), eq(tenders.organizationId, orgId)))
      .for('update');
    if (!tender) throw notFound('Тендер не найден');

    // Повторная отмена — успех: клиент мог не получить ответ на первую. Проверяем
    // ДО дедлайна, иначе ретрай отменённого лота после дедлайна вернул бы 409.
    if (tender.status === 'cancelled') return { row: tender, changed: false };

    if (tender.deadlineAt <= new Date()) throw cannotCancelAfterDeadline();
    await cancelTenderTx(tx, id, viewer, reason);
    const [updated] = await tx.select().from(tenders).where(eq(tenders.id, id));
    return { row: updated!, changed: true };
  });

  if (result.changed) bus.emitTenderChanged(id, 'status');
  return {
    id: result.row.id,
    status: toExternalStatus(result.row.status),
    revision: result.row.revision,
  };
}
