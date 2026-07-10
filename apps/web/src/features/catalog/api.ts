import type { CategoryNode, TenderListQuery, TenderSummary } from '@zakupki/shared';
import { api } from '../../api/client';

export interface TenderPage {
  items: TenderSummary[];
  total: number;
  page: number;
  limit: number;
}

export function fetchTenders(
  q: Partial<TenderListQuery> & { mine?: boolean },
): Promise<TenderPage> {
  return api<TenderPage>('/tenders', { query: q as Record<string, string | number | boolean> });
}

export function fetchCategories(kind?: 'smr' | 'materials'): Promise<CategoryNode[]> {
  return api<CategoryNode[]>('/categories', { query: kind ? { kind } : undefined });
}
