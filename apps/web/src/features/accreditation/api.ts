import type {
  AccreditationQueueItem,
  AccreditationReview,
  AccredVerdict,
  FileMeta,
  OrganizationOutput,
} from '@zakupki/shared';
import { api } from '../../api/client';

export function fetchQueue(status?: string): Promise<AccreditationQueueItem[]> {
  return api<AccreditationQueueItem[]>('/accreditation/queue', { query: status ? { status } : undefined });
}

export interface ReviewData {
  org: OrganizationOutput;
  documents: FileMeta[];
  reviews: AccreditationReview[];
}

export function fetchReview(orgId: string): Promise<ReviewData> {
  return api<ReviewData>(`/accreditation/${orgId}`);
}

export function postVerdict(
  orgId: string,
  body: { verdict: AccredVerdict; note: string },
): Promise<{ ok: boolean }> {
  return api(`/accreditation/${orgId}/verdict`, { method: 'POST', body });
}
