import type {
  CreateTenderInput,
  PositionInput,
  TenderDetail,
  UpdateTenderInput,
} from '@zakupki/shared';
import { api } from '../../api/client';

export const createTender = (body: CreateTenderInput) =>
  api<{ id: string }>('/tenders', { method: 'POST', body });

export const updateTender = (id: string, body: UpdateTenderInput) =>
  api(`/tenders/${id}`, { method: 'PUT', body });

export const setPositions = (id: string, positions: PositionInput[]) =>
  api(`/tenders/${id}/positions`, { method: 'PUT', body: { positions } });

export const publishTender = (id: string) => api(`/tenders/${id}/publish`, { method: 'POST' });

export const cancelTender = (id: string, reason?: string) =>
  api(`/tenders/${id}/cancel`, { method: 'POST', body: { reason } });

export const awardTender = (id: string, bidId: string) =>
  api(`/tenders/${id}/award`, { method: 'POST', body: { bidId } });

export const fetchTenderDetail = (id: string) => api<TenderDetail>(`/tenders/${id}`);
