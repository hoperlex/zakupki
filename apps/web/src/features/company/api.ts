import type {
  CompanyCardInput,
  InnLookupResult,
  OrganizationOutput,
} from '@zakupki/shared';
import { api } from '../../api/client';

export function fetchMyOrg(): Promise<OrganizationOutput | null> {
  return api<OrganizationOutput | null>('/orgs/me');
}

export function saveCompanyCard(input: CompanyCardInput): Promise<OrganizationOutput> {
  return api<OrganizationOutput>('/orgs/me', { method: 'PUT', body: input });
}

export function submitAccreditation(): Promise<{ ok: boolean }> {
  return api('/orgs/me/submit-accreditation', { method: 'POST' });
}

export function lookupInn(inn: string): Promise<InnLookupResult> {
  return api<InnLookupResult>('/orgs/lookup', { query: { inn } });
}
