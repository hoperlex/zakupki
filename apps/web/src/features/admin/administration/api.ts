import type {
  ChangePasswordInput,
  CreateUserInput,
  UpdateUserInput,
  UserSummary,
} from '@zakupki/shared';
import { api } from '../../../api/client';

export const listUsers = () => api<UserSummary[]>('/users');

export const createUser = (body: CreateUserInput) =>
  api<UserSummary>('/users', { method: 'POST', body });

export const updateUser = (id: string, body: UpdateUserInput) =>
  api<UserSummary>(`/users/${id}`, { method: 'PATCH', body });

export const changeUserPassword = (id: string, body: ChangePasswordInput) =>
  api(`/users/${id}/password`, { method: 'POST', body });

export const deleteUser = (id: string) => api(`/users/${id}`, { method: 'DELETE' });
