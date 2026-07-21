import { z } from 'zod';
import { account, bik, inn, kpp, ogrn } from '../common';
import { ACCREDITATION_STATUSES, COUNTERPARTY_TYPES, ORG_KINDS } from '../enums';

// Counterparty questionnaire (анкета контрагента) — free-form key answers kept as jsonb.
export const questionnaire = z
  .object({
    hasSro: z.boolean().optional(),
    sroNumber: z.string().max(100).optional(),
    employeesCount: z.number().int().nonnegative().optional(),
    yearsOnMarket: z.number().int().nonnegative().optional(),
    website: z.string().max(200).optional(),
    beneficiaries: z.string().max(2000).optional(),
    hasLitigation: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
  })
  .partial();
export type Questionnaire = z.infer<typeof questionnaire>;

// Company card (карточка компании / реквизиты). KPP nullable (ИП без КПП).
export const companyCardInput = z.object({
  fullName: z.string().trim().min(3, 'Укажите полное наименование').max(300),
  shortName: z.string().trim().max(200).optional().nullable(),
  inn: inn(),
  kpp: kpp().optional().nullable(),
  ogrn: ogrn(),
  okpo: z.string().trim().max(20).optional().nullable(),
  okved: z.string().trim().max(20).optional().nullable(),
  taxSystem: z.enum(['osn', 'usn']).optional().nullable(),
  isVatPayer: z.boolean().default(true),
  legalAddress: z.string().trim().min(3, 'Укажите юр. адрес').max(500),
  postalAddress: z.string().trim().max(500).optional().nullable(),
  bankName: z.string().trim().max(300).optional().nullable(),
  bankBik: bik().optional().nullable(),
  bankCorrAccount: account().optional().nullable(),
  settlementAccount: account().optional().nullable(),
  directorName: z.string().trim().max(200).optional().nullable(),
  directorBasis: z.string().trim().max(200).optional().nullable(),
  contactPhone: z.string().trim().max(30).optional().nullable(),
  contactEmail: z.string().trim().max(200).optional().nullable(),
  questionnaire: questionnaire.optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
});
export type CompanyCardInput = z.infer<typeof companyCardInput>;

export const organizationOutput = companyCardInput.extend({
  id: z.string().uuid(),
  kind: z.enum(['internal', 'supplier']),
  accreditationStatus: z.enum(ACCREDITATION_STATUSES),
  createdAt: z.string(),
});
export type OrganizationOutput = z.infer<typeof organizationOutput>;

export const orgSummary = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  shortName: z.string().nullable(),
  inn: z.string(),
  kpp: z.string().nullable(),
  accreditationStatus: z.enum(ACCREDITATION_STATUSES),
  createdAt: z.string(),
});
export type OrgSummary = z.infer<typeof orgSummary>;

// ─── Справочник контрагентов ───
// Строка таблицы контрагентов (все организации: internal + supplier).
export const counterpartySummary = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  shortName: z.string().nullable(),
  inn: z.string(),
  kpp: z.string().nullable(),
  kind: z.enum(ORG_KINDS),
  counterpartyType: z.enum(COUNTERPARTY_TYPES),
  isGeneralContractor: z.boolean(),
  accreditationStatus: z.enum(ACCREDITATION_STATUSES),
  createdAt: z.string(),
});
export type CounterpartySummary = z.infer<typeof counterpartySummary>;

export const setCounterpartyTypeInput = z.object({
  counterpartyType: z.enum(COUNTERPARTY_TYPES),
});
export type SetCounterpartyTypeInput = z.infer<typeof setCounterpartyTypeInput>;

export const setGeneralContractorInput = z.object({
  organizationId: z.string().uuid(),
});
export type SetGeneralContractorInput = z.infer<typeof setGeneralContractorInput>;

// ИНН autofill result.
export const innLookupResult = z.object({
  found: z.boolean(),
  fullName: z.string().optional(),
  shortName: z.string().optional(),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  okpo: z.string().optional(),
  okved: z.string().optional(),
  legalAddress: z.string().optional(),
  directorName: z.string().optional(),
});
export type InnLookupResult = z.infer<typeof innLookupResult>;
