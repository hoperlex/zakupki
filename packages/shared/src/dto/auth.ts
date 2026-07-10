import { z } from 'zod';
import { email, password } from '../common';
import { ROLES, ACCREDITATION_STATUSES } from '../enums';

export const registerInput = z.object({
  fullName: z.string().trim().min(2, 'Укажите ФИО').max(200),
  email: email(),
  password: password(),
  phone: z.string().trim().max(30).optional(),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  email: email(),
  password: z.string().min(1, 'Введите пароль'),
});
export type LoginInput = z.infer<typeof loginInput>;

export const forgotPasswordInput = z.object({ email: email() });
export const resetPasswordInput = z.object({
  token: z.string().min(10),
  password: password(),
});

/** Current authenticated user, returned by /auth/me and login/register. */
export const authUser = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(ROLES),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  accreditationStatus: z.enum(ACCREDITATION_STATUSES).nullable(),
  companyCardComplete: z.boolean(),
});
export type AuthUser = z.infer<typeof authUser>;

/** Login/register/refresh responses include the CSRF token (also set as a readable cookie). */
export const authResponse = z.object({
  user: authUser,
  csrfToken: z.string(),
});
export type AuthResponse = z.infer<typeof authResponse>;
