import { z } from 'zod';
import { money } from '../common';
import { VAT_RATES, BID_STATUSES } from '../enums';

export const bidItemInput = z.object({
  positionId: z.string().uuid(),
  unitPriceWithoutVat: money(),
  vatRate: z.enum(VAT_RATES),
});
export type BidItemInput = z.infer<typeof bidItemInput>;

export const submitBidInput = z.object({
  items: z.array(bidItemInput).min(1, 'Заполните цены по позициям'),
  comment: z.string().max(2000).optional().nullable(),
});
export type SubmitBidInput = z.infer<typeof submitBidInput>;

export const bidItemOutput = z.object({
  positionId: z.string().uuid(),
  unitPriceWithoutVat: z.string(),
  vatRate: z.enum(VAT_RATES),
  amountWithVat: z.string(),
});

// Supplier's own bid view — includes own totals + own rank, never competitor data.
export const myBidOutput = z.object({
  id: z.string().uuid(),
  status: z.enum(BID_STATUSES),
  items: z.array(bidItemOutput),
  totalWithoutVat: z.string(),
  vatAmount: z.string(),
  totalWithVat: z.string(),
  rank: z.number().int().nullable(),
  isBest: z.boolean(),
  participantsCount: z.number().int(),
  comment: z.string().nullable(),
  submittedAt: z.string().nullable(),
});
export type MyBidOutput = z.infer<typeof myBidOutput>;

// Live rank snapshot pushed over SSE / returned by /my-rank. Blind: no competitor prices.
export const rankSnapshot = z.object({
  tenderId: z.string().uuid(),
  yourRank: z.number().int().nullable(),
  participants: z.number().int(),
  isBest: z.boolean(),
  yourTotalWithVat: z.string().nullable(),
  deadlineAt: z.string(),
  status: z.string(),
});
export type RankSnapshot = z.infer<typeof rankSnapshot>;

// Manager/admin comparison row — full visibility (prices + identity).
export const bidComparisonRow = z.object({
  bidId: z.string().uuid(),
  rank: z.number().int().nullable(),
  isBest: z.boolean(),
  supplierOrgId: z.string().uuid(),
  supplierName: z.string(),
  supplierInn: z.string(),
  accreditationStatus: z.string(),
  totalWithoutVat: z.string(),
  vatAmount: z.string(),
  totalWithVat: z.string(),
  comment: z.string().nullable(),
  submittedAt: z.string().nullable(),
  items: z.array(bidItemOutput),
});
export type BidComparisonRow = z.infer<typeof bidComparisonRow>;
