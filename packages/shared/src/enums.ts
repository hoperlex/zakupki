// Domain enums shared between DB (pgEnum), API and UI. Value arrays are the single source of truth.

export const ORG_KINDS = ['internal', 'supplier'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

export const ROLES = ['admin', 'manager', 'security', 'supplier'] as const;
export type Role = (typeof ROLES)[number];

export const TENDER_TYPES = ['smr', 'materials'] as const;
export type TenderType = (typeof TENDER_TYPES)[number];

export const TENDER_VISIBILITIES = ['open', 'closed'] as const;
export type TenderVisibility = (typeof TENDER_VISIBILITIES)[number];

export const TENDER_STATUSES = [
  'draft',
  'published',
  'collecting',
  'under_review',
  'awarded',
  'cancelled',
  'closed',
] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];

export const BID_STATUSES = ['draft', 'submitted', 'withdrawn', 'rejected'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const VAT_RATES = ['vat20', 'vat10', 'vat0', 'none'] as const;
export type VatRate = (typeof VAT_RATES)[number];

// numeric percent for each VAT rate; `none` = без НДС (не облагается)
export const VAT_PERCENT: Record<VatRate, number> = {
  vat20: 20,
  vat10: 10,
  vat0: 0,
  none: 0,
};

export const ACCREDITATION_STATUSES = [
  'none',
  'pending',
  'under_review',
  'needs_docs',
  'accredited',
  'rejected',
  'suspended',
] as const;
export type AccreditationStatus = (typeof ACCREDITATION_STATUSES)[number];

export const ACCRED_VERDICTS = ['approved', 'needs_docs', 'rejected', 'suspended'] as const;
export type AccredVerdict = (typeof ACCRED_VERDICTS)[number];

export const INVITE_STATUSES = ['pending', 'opened', 'accepted', 'expired', 'revoked'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const UNITS = ['pcs', 'm', 'm2', 'm3', 'kg', 't', 'l', 'set', 'h'] as const;
export type Unit = (typeof UNITS)[number];

export const UNIT_LABELS: Record<Unit, string> = {
  pcs: 'шт.',
  m: 'м',
  m2: 'м²',
  m3: 'м³',
  kg: 'кг',
  t: 'т',
  l: 'л',
  set: 'компл.',
  h: 'ч',
};

export const FILE_OWNERS = ['tender', 'bid', 'organization', 'position'] as const;
export type FileOwner = (typeof FILE_OWNERS)[number];

export const NOTIF_TYPES = [
  'accreditation',
  'invitation',
  'outbid',
  'tender_matched',
  'award',
  'deadline',
] as const;
export type NotifType = (typeof NOTIF_TYPES)[number];

// Human-readable Russian labels for UI tags/badges.
export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  collecting: 'Приём предложений',
  under_review: 'На рассмотрении',
  awarded: 'Определён победитель',
  cancelled: 'Отменён',
  closed: 'Завершён',
};

export const TENDER_TYPE_LABELS: Record<TenderType, string> = {
  smr: 'СМР (работы)',
  materials: 'Материалы',
};

export const ACCREDITATION_STATUS_LABELS: Record<AccreditationStatus, string> = {
  none: 'Не заполнено',
  pending: 'Ожидает проверки',
  under_review: 'На проверке СБ',
  needs_docs: 'Требуются документы',
  accredited: 'Аккредитован',
  rejected: 'Отклонён',
  suspended: 'Приостановлен',
};

export const VAT_RATE_LABELS: Record<VatRate, string> = {
  vat20: 'НДС 20%',
  vat10: 'НДС 10%',
  vat0: 'НДС 0%',
  none: 'Без НДС',
};
