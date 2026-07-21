import { z } from 'zod';
import { email, password } from '../common';
import { ROLES } from '../enums';

/** Строка таблицы пользователей в разделе «Администрирование». */
export const userSummary = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role: z.enum(ROLES),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserSummary = z.infer<typeof userSummary>;

export const createUserInput = z.object({
  fullName: z.string().trim().min(2, 'Укажите ФИО').max(200),
  email: email(),
  phone: z.string().trim().max(30).optional().nullable(),
  password: password(),
  role: z.enum(ROLES),
  organizationId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z.object({
  fullName: z.string().trim().min(2, 'Укажите ФИО').max(200).optional(),
  email: email().optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  role: z.enum(ROLES).optional(),
  organizationId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInput>;

export const changePasswordInput = z.object({
  password: password(),
});
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;
