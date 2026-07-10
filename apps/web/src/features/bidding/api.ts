import type {
  BidComparisonRow,
  MyBidOutput,
  SubmitBidInput,
} from '@zakupki/shared';
import { api } from '../../api/client';

export const fetchMyBid = (id: string) => api<MyBidOutput | null>(`/tenders/${id}/my-bid`);

export const submitBid = (id: string, body: SubmitBidInput) =>
  api<MyBidOutput>(`/tenders/${id}/bid`, { method: 'POST', body });

export const withdrawBid = (id: string) => api(`/tenders/${id}/bid/withdraw`, { method: 'POST' });

export const fetchComparison = (id: string) => api<BidComparisonRow[]>(`/tenders/${id}/bids`);

export const awardBid = (id: string, bidId: string) =>
  api(`/tenders/${id}/award`, { method: 'POST', body: { bidId } });
