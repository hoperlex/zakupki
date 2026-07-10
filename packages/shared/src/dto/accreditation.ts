import { z } from 'zod';
import { ACCRED_VERDICTS, ACCREDITATION_STATUSES } from '../enums';

export const verdictInput = z.object({
  verdict: z.enum(ACCRED_VERDICTS),
  note: z.string().trim().min(3, 'Обоснование обязательно').max(2000),
});
export type VerdictInput = z.infer<typeof verdictInput>;

export const accreditationQueueItem = z.object({
  organizationId: z.string().uuid(),
  fullName: z.string(),
  inn: z.string(),
  accreditationStatus: z.enum(ACCREDITATION_STATUSES),
  documentsCount: z.number().int(),
  submittedAt: z.string().nullable(),
});
export type AccreditationQueueItem = z.infer<typeof accreditationQueueItem>;

export const accreditationReview = z.object({
  id: z.string().uuid(),
  verdict: z.enum(ACCRED_VERDICTS),
  note: z.string(),
  reviewerName: z.string().nullable(),
  createdAt: z.string(),
});
export type AccreditationReview = z.infer<typeof accreditationReview>;
