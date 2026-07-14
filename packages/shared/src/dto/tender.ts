import { z } from 'zod';
import { money, quantity } from '../common';
import {
  TENDER_TYPES,
  TENDER_VISIBILITIES,
  TENDER_STATUSES,
  UNITS,
  VAT_RATES,
} from '../enums';

export const tenderTerms = z
  .object({
    payment: z.string().max(2000).optional(),
    delivery: z.string().max(2000).optional(),
    warranty: z.string().max(2000).optional(),
    deliveryPlace: z.string().max(500).optional(),
    deliveryDeadline: z.string().max(200).optional(),
  })
  .partial();
export type TenderTerms = z.infer<typeof tenderTerms>;

export const positionInput = z.object({
  positionNo: z.number().int().positive(),
  name: z.string().trim().min(1, 'Укажите наименование').max(500),
  categoryId: z.string().uuid().optional().nullable(),
  unit: z.enum(UNITS),
  quantity: quantity(),
  spec: z.string().max(2000).optional().nullable(),
  isRequired: z.boolean().default(true),
  targetPrice: money().optional().nullable(),
  /** Единица в написании внешнего источника — только для аудита. Кабинет не заполняет. */
  sourceUnit: z.string().max(32).optional().nullable(),
});
export type PositionInput = z.infer<typeof positionInput>;

export const positionOutput = positionInput.extend({
  id: z.string().uuid(),
});
export type PositionOutput = z.infer<typeof positionOutput>;

export const createTenderInput = z.object({
  title: z.string().trim().min(5, 'Укажите название тендера').max(300),
  type: z.enum(TENDER_TYPES),
  visibility: z.enum(TENDER_VISIBILITIES).default('open'),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).optional().nullable(),
  terms: tenderTerms.optional(),
  expectedVatRate: z.enum(VAT_RATES).default('vat20'),
  minStepPct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional().nullable(),
  minStepAbs: money().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  deadlineAt: z.string().datetime(),
  autoExtendEnabled: z.boolean().default(true),
  autoExtendWindowSec: z.number().int().positive().default(300),
  autoExtendStepSec: z.number().int().positive().default(300),
  autoExtendMaxCount: z.number().int().nonnegative().default(3),
  positions: z.array(positionInput).min(1, 'Добавьте хотя бы одну позицию'),
});
export type CreateTenderInput = z.infer<typeof createTenderInput>;

export const updateTenderInput = createTenderInput.partial().omit({ positions: true });
export type UpdateTenderInput = z.infer<typeof updateTenderInput>;

// Row for the public / supplier catalog list.
export const tenderSummary = z.object({
  id: z.string().uuid(),
  number: z.string(),
  title: z.string(),
  type: z.enum(TENDER_TYPES),
  visibility: z.enum(TENDER_VISIBILITIES),
  status: z.enum(TENDER_STATUSES),
  categoryName: z.string().nullable(),
  organizationName: z.string(),
  positionsCount: z.number().int(),
  participantsCount: z.number().int(),
  startsAt: z.string().nullable(),
  deadlineAt: z.string(),
  createdAt: z.string(),
});
export type TenderSummary = z.infer<typeof tenderSummary>;

// Full detail as seen by a supplier / public (no competitor prices).
export const tenderDetail = tenderSummary.extend({
  description: z.string().nullable(),
  terms: tenderTerms.nullable(),
  expectedVatRate: z.enum(VAT_RATES),
  minStepPct: z.string().nullable(),
  minStepAbs: z.string().nullable(),
  autoExtendEnabled: z.boolean(),
  autoExtendWindowSec: z.number().int(),
  autoExtendStepSec: z.number().int(),
  autoExtendMaxCount: z.number().int(),
  extendCount: z.number().int(),
  originalDeadlineAt: z.string(),
  awardedBidId: z.string().uuid().nullable(),
  positions: z.array(positionOutput),
  documents: z.array(
    z.object({ id: z.string().uuid(), originalName: z.string(), sizeBytes: z.number() }),
  ),
  // supplier-context flags
  canBid: z.boolean(),
  bidBlockReason: z.string().nullable(),
});
export type TenderDetail = z.infer<typeof tenderDetail>;

export const tenderListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(15),
  type: z.enum(TENDER_TYPES).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(TENDER_STATUSES).optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['deadline_asc', 'deadline_desc', 'created_desc']).default('deadline_asc'),
});
export type TenderListQuery = z.infer<typeof tenderListQuery>;
