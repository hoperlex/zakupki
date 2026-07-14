// Контракт ВНЕШНЕГО машинного API (/api/v1/external) для системы-источника
// (сметный портал EstiMat). Поля здесь — snake_case: это чужой контракт,
// а не внутренняя модель портала. Маппинг «внешнее ↔ домен» живёт в
// apps/api/src/modules/external/service.ts.
//
// Модуль обязан оставаться изоморфным (его тянет и web): никаких node-модулей.

import { z } from 'zod';
import { UNITS, VAT_RATES, type TenderStatus, type Unit } from '../enums';

// ─── ось статусов источника ───

/** Огрублённая ось статусов, которую понимает источник. */
export const EXTERNAL_STATUSES = [
  'draft',
  'published',
  'awaiting_results',
  'finished',
  'cancelled',
] as const;
export type ExternalStatus = (typeof EXTERNAL_STATUSES)[number];

/** Домен портала → ось источника. Полная карта: новый статус не забудется. */
export const EXTERNAL_STATUS_BY_TENDER_STATUS: Record<TenderStatus, ExternalStatus> = {
  draft: 'draft',
  published: 'published',
  collecting: 'published',
  under_review: 'awaiting_results',
  awarded: 'finished',
  closed: 'finished',
  cancelled: 'cancelled',
};

export const toExternalStatus = (status: TenderStatus): ExternalStatus =>
  EXTERNAL_STATUS_BY_TENDER_STATUS[status];

/** Исход тендера для источника. */
export const EXTERNAL_OUTCOMES = ['pending', 'awarded', 'no_award'] as const;
export type ExternalOutcome = (typeof EXTERNAL_OUTCOMES)[number];

/** Статусы, на которых итоги уже можно отдавать (иначе — results_not_ready). */
export const RESULT_READY_STATUSES: readonly TenderStatus[] = ['under_review', 'awarded', 'closed'];

// ─── единицы измерения ───

/**
 * Частые написания единиц у источника → коды домена.
 * Кириллица и латиница различаются намеренно: «т» (RU) и «t» (EN) — разные ключи.
 */
export const UNIT_SYNONYMS: Readonly<Record<string, Unit>> = {
  шт: 'pcs',
  штука: 'pcs',
  штук: 'pcs',
  ед: 'pcs',
  единица: 'pcs',
  pc: 'pcs',
  piece: 'pcs',
  м: 'm',
  метр: 'm',
  'пог.м': 'm',
  'пог м': 'm',
  'п.м': 'm',
  пм: 'm',
  мп: 'm',
  м2: 'm2',
  'м²': 'm2',
  'м^2': 'm2',
  'кв.м': 'm2',
  'кв м': 'm2',
  кв: 'm2',
  sqm: 'm2',
  м3: 'm3',
  'м³': 'm3',
  'м^3': 'm3',
  'куб.м': 'm3',
  'куб м': 'm3',
  куб: 'm3',
  cbm: 'm3',
  кг: 'kg',
  килограмм: 'kg',
  т: 't',
  тн: 't',
  тонна: 't',
  ton: 't',
  л: 'l',
  литр: 'l',
  liter: 'l',
  litre: 'l',
  компл: 'set',
  комплект: 'set',
  наб: 'set',
  набор: 'set',
  ч: 'h',
  час: 'h',
  'чел.-ч': 'h',
  'чел-ч': 'h',
  hour: 'h',
};

/**
 * Единица источника → код домена. `null`, если сопоставить нельзя:
 * вызывающий обязан ответить 400, а НЕ подставлять pcs — молчаливая подмена
 * единицы искажает предмет закупки.
 */
export function mapUnit(raw: string): Unit | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  if ((UNITS as readonly string[]).includes(key)) return key as Unit;
  const noTrailingDot = key.replace(/\.+$/, '');
  if ((UNITS as readonly string[]).includes(noTrailingDot)) return noTrailingDot as Unit;
  return UNIT_SYNONYMS[key] ?? UNIT_SYNONYMS[noTrailingDot] ?? null;
}

/**
 * Количество источника → decimal-строка для numeric(18,3).
 * `null`, если это не десятичное число, знаков после запятой больше 3
 * (округлять молча нельзя — это потеря данных) или значение не > 0.
 */
export function normalizeQuantity(raw: string): string | null {
  const value = raw.trim();
  if (!/^\d{1,15}(\.\d{1,3})?$/.test(value)) return null;
  return Number(value) > 0 ? value : null;
}

/** Домен требует title ≥ 5 символов; короткое имя лота не повод отвергать заявку. */
export function normalizeTitle(raw: string): string {
  const title = raw.trim();
  return title.length >= 5 ? title : `Закупка — ${title}`;
}

// ─── вход ───

// Схемы strict: это машинный контракт. Молча проглоченная опечатка в имени поля
// («conditons») обернулась бы потерянными условиями поставки, а не ошибкой.

export const externalConditions = z
  .object({
    delivery: z.string().max(2000).optional(),
    payment: z.string().max(2000).optional(),
    deadline: z.string().max(200).optional(),
    place: z.string().max(500).optional(),
  })
  .partial()
  .strict();
export type ExternalConditions = z.infer<typeof externalConditions>;

export const externalItemInput = z
  .object({
    material: z.string().trim().min(1).max(500),
    // Только строка: JSON-число не представит 120.000 точно, а весь домен
    // (money/quantity) живёт в decimal-строках.
    quantity: z.string(),
    unit: z.string().trim().min(1).max(32),
    spec: z.string().max(2000).optional().nullable(),
  })
  .strict();
export type ExternalItemInput = z.infer<typeof externalItemInput>;

/** Верхняя граница int4: source_revision едет в integer-колонку. */
const INT4_MAX = 2_147_483_647;

/**
 * Тело POST /external/tenders.
 * `deadline_at` намеренно z.string().optional(): контракт требует на пропуск,
 * не-ISO и прошедшую дату отвечать 400 bad_request, а не 422 validation, —
 * поэтому проверка живёт в сервисе, а не в схеме.
 */
export const externalCreateTenderInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    external_ref: z.string().trim().min(1).max(128),
    source_revision: z.number().int().nonnegative().max(INT4_MAX).optional(),
    deadline_at: z.string().optional(),
    vat_rate: z.enum(VAT_RATES).optional(),
    /** Задел: 'draft' оставляет тендер неопубликованным. По умолчанию — публикуем. */
    publication_mode: z.enum(['publish', 'draft']).default('publish'),
    items: z.array(externalItemInput).min(1, 'Добавьте хотя бы одну позицию'),
    conditions: externalConditions.optional(),
  })
  .strict();
export type ExternalCreateTenderInput = z.infer<typeof externalCreateTenderInput>;

export const externalCancelInput = z
  .object({ reason: z.string().max(500).optional() })
  .strict()
  .optional()
  .nullable();

// ─── выход ───

export const externalTenderCreated = z.object({
  id: z.string().uuid(),
  number: z.string(),
  external_ref: z.string(),
  status: z.enum(EXTERNAL_STATUSES),
  url: z.string(),
  public_url: z.string(),
  deadline_at: z.string(),
  revision: z.number().int(),
  /** true — тендер уже существовал, это повтор того же запроса. */
  replayed: z.boolean(),
});
export type ExternalTenderCreated = z.infer<typeof externalTenderCreated>;

export const externalTenderState = z.object({
  id: z.string().uuid(),
  external_ref: z.string().nullable(),
  status: z.enum(EXTERNAL_STATUSES),
  url: z.string(),
  revision: z.number().int(),
});
export type ExternalTenderState = z.infer<typeof externalTenderState>;

export const externalParticipant = z.object({
  id: z.string().uuid(),
  name: z.string(),
  inn: z.string(),
});

/** Суммы — decimal-строки: float здесь потерял бы копейки. */
export const externalBid = z.object({
  participant_id: z.string().uuid(),
  bid_id: z.string().uuid(),
  amount: z.string(),
  currency: z.string(),
  submitted_at: z.string().nullable(),
});

export const externalResults = z.object({
  tender_id: z.string().uuid(),
  status: z.enum(EXTERNAL_STATUSES),
  outcome: z.enum(EXTERNAL_OUTCOMES),
  participants: z.array(externalParticipant),
  bids: z.array(externalBid),
  winner: z
    .object({ participant_id: z.string().uuid(), bid_id: z.string().uuid() })
    .nullable(),
  finished_at: z.string().nullable(),
});
export type ExternalResults = z.infer<typeof externalResults>;

export const externalCancelResult = z.object({
  id: z.string().uuid(),
  status: z.enum(EXTERNAL_STATUSES),
  revision: z.number().int(),
});
export type ExternalCancelResult = z.infer<typeof externalCancelResult>;
