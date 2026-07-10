import type {
  AuthResponse,
  CreateInvitationsInput,
  InvitationOutput,
  InvitationPreview,
} from '@zakupki/shared';
import { api } from '../../api/client';

export const fetchInvitePreview = (token: string) =>
  api<InvitationPreview>(`/invitations/${token}`);

export const acceptInvite = (
  token: string,
  body: { fullName?: string; password?: string; phone?: string },
) => api<AuthResponse & { tenderId: string }>(`/invitations/${token}/accept`, { method: 'POST', body });

export const fetchTenderInvitations = (id: string) =>
  api<InvitationOutput[]>(`/tenders/${id}/invitations`);

export const createInvitations = (id: string, body: CreateInvitationsInput) =>
  api<InvitationOutput[]>(`/tenders/${id}/invitations`, { method: 'POST', body });

export const revokeInvitation = (invId: string) =>
  api(`/invitations/${invId}/revoke`, { method: 'POST' });
