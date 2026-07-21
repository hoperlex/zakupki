import type { CounterpartySummary, CounterpartyType } from '@zakupki/shared';
import { api } from '../../../api/client';

export const listCounterparties = () => api<CounterpartySummary[]>('/orgs/counterparties');

export const setCounterpartyType = (id: string, counterpartyType: CounterpartyType) =>
  api(`/orgs/${id}/counterparty-type`, { method: 'PATCH', body: { counterpartyType } });

export const setGeneralContractor = (organizationId: string) =>
  api('/orgs/general-contractor', { method: 'POST', body: { organizationId } });
