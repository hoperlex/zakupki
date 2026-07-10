import type { TenderDetail } from '@zakupki/shared';
import { api } from '../../api/client';

export function fetchTender(id: string): Promise<TenderDetail> {
  return api<TenderDetail>(`/tenders/${id}`);
}
