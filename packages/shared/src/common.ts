import { z } from 'zod';

/**
 * Money is transported as a decimal string (never a JS float) to avoid rounding bugs.
 * Up to 15 integer digits + optional 2 fractional digits.
 */
export const money = () =>
  z
    .string()
    .trim()
    .regex(/^\d{1,15}(\.\d{1,2})?$/, 'Некорректная сумма (до 2 знаков после запятой)');

/** Quantity: up to 3 fractional digits, must be > 0. */
export const quantity = () =>
  z
    .string()
    .trim()
    .regex(/^\d{1,15}(\.\d{1,3})?$/, 'Некорректное количество')
    .refine((v) => Number(v) > 0, 'Количество должно быть больше 0');

export const uuid = () => z.string().uuid();

export const email = () => z.string().trim().toLowerCase().email('Некорректный email');

export const inn = () =>
  z
    .string()
    .trim()
    .regex(/^(\d{10}|\d{12})$/, 'ИНН должен содержать 10 (юрлицо) или 12 (ИП) цифр');

export const kpp = () =>
  z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'КПП должен содержать 9 цифр');

export const ogrn = () =>
  z
    .string()
    .trim()
    .regex(/^(\d{13}|\d{15})$/, 'ОГРН — 13 цифр, ОГРНИП — 15 цифр');

export const bik = () =>
  z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'БИК должен содержать 9 цифр');

export const account = () =>
  z
    .string()
    .trim()
    .regex(/^\d{20}$/, 'Счёт должен содержать 20 цифр');

export const password = () =>
  z.string().min(8, 'Минимум 8 символов').max(200);

/** Standard paginated list envelope. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  });

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(15),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;
