import {
  boolean,
  char,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import type { Questionnaire, TenderTerms } from '@zakupki/shared';
import { citext, createdAt, deletedAt, pk, updatedAt } from './columns';
import {
  accredVerdictEnum,
  accreditationStatusEnum,
  bidStatusEnum,
  fileOwnerEnum,
  inviteStatusEnum,
  notifTypeEnum,
  orgKindEnum,
  roleEnum,
  tenderStatusEnum,
  tenderTypeEnum,
  tenderVisibilityEnum,
  unitEnum,
  vatRateEnum,
} from './enums';

// ─── organizations (buyer internal org + supplier counterparties) ───
export const organizations = pgTable('organizations', {
  id: pk(),
  kind: orgKindEnum('kind').notNull().default('supplier'),
  fullName: text('full_name').notNull(),
  shortName: text('short_name'),
  inn: varchar('inn', { length: 12 }).notNull(),
  kpp: varchar('kpp', { length: 9 }),
  ogrn: varchar('ogrn', { length: 15 }).notNull(),
  okpo: varchar('okpo', { length: 20 }),
  okved: varchar('okved', { length: 20 }),
  taxSystem: text('tax_system'), // 'osn' | 'usn'
  isVatPayer: boolean('is_vat_payer').notNull().default(true),
  legalAddress: text('legal_address'),
  postalAddress: text('postal_address'),
  bankName: text('bank_name'),
  bankBik: varchar('bank_bik', { length: 9 }),
  bankCorrAccount: varchar('bank_corr_account', { length: 20 }),
  settlementAccount: varchar('settlement_account', { length: 20 }),
  directorName: text('director_name'),
  directorBasis: text('director_basis'),
  contactPhone: varchar('contact_phone', { length: 30 }),
  contactEmail: text('contact_email'),
  questionnaire: jsonb('questionnaire').$type<Questionnaire>(),
  accreditationStatus: accreditationStatusEnum('accreditation_status').notNull().default('none'),
  accreditationSubmittedAt: timestamp('accreditation_submitted_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

// ─── users (own auth) ───
export const users = pgTable('users', {
  id: pk(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  email: citext('email').notNull(),
  phone: varchar('phone', { length: 30 }),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash'),
  role: roleEnum('role').notNull().default('supplier'),
  isActive: boolean('is_active').notNull().default(true),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

// ─── auth refresh tokens (rotation + reuse detection) ───
export const authRefreshTokens = pgTable('auth_refresh_tokens', {
  id: pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  familyId: uuid('family_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ip: varchar('ip', { length: 64 }),
  createdAt: createdAt(),
});

// ─── password reset tokens ───
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ─── accreditation reviews (append-only СБ verdict history) ───
export const accreditationReviews = pgTable('accreditation_reviews', {
  id: pk(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  verdict: accredVerdictEnum('verdict').notNull(),
  note: text('note').notNull(),
  documentsSnapshot: jsonb('documents_snapshot'),
  createdAt: createdAt(),
});

// ─── categories (self-referencing tree) ───
export const categories = pgTable('categories', {
  id: pk(),
  parentId: uuid('parent_id'),
  kind: tenderTypeEnum('kind').notNull(),
  code: varchar('code', { length: 50 }),
  name: text('name').notNull(),
  path: text('path').notNull().default('/'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

// ─── category subscriptions ───
export const categorySubscriptions = pgTable('category_subscriptions', {
  id: pk(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id, { onDelete: 'cascade' }),
  includeSubtree: boolean('include_subtree').notNull().default(true),
  createdAt: createdAt(),
});

// ─── tenders ───
export const tenders = pgTable('tenders', {
  id: pk(),
  number: varchar('number', { length: 32 }).notNull(),
  title: text('title').notNull(),
  type: tenderTypeEnum('type').notNull(),
  visibility: tenderVisibilityEnum('visibility').notNull().default('open'),
  status: tenderStatusEnum('status').notNull().default('draft'),
  categoryId: uuid('category_id').references(() => categories.id),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  description: text('description'),
  terms: jsonb('terms').$type<TenderTerms>(),
  currency: varchar('currency', { length: 3 }).notNull().default('RUB'),
  expectedVatRate: vatRateEnum('expected_vat_rate').notNull().default('vat20'),
  rankingBasis: text('ranking_basis').notNull().default('with_vat'),
  minStepPct: numeric('min_step_pct', { precision: 6, scale: 2 }),
  minStepAbs: numeric('min_step_abs', { precision: 18, scale: 2 }),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
  originalDeadlineAt: timestamp('original_deadline_at', { withTimezone: true }).notNull(),
  autoExtendEnabled: boolean('auto_extend_enabled').notNull().default(true),
  autoExtendWindowSec: integer('auto_extend_window_sec').notNull().default(300),
  autoExtendStepSec: integer('auto_extend_step_sec').notNull().default(300),
  autoExtendMaxCount: integer('auto_extend_max_count').notNull().default(3),
  extendCount: integer('extend_count').notNull().default(0),
  awardedBidId: uuid('awarded_bid_id'),
  closeReason: text('close_reason'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  // Итоги подведены: award либо закрытие без победителя.
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // ─── происхождение из внешней системы (машинный API) ───
  sourceSystem: varchar('source_system', { length: 32 }),
  externalRef: varchar('external_ref', { length: 128 }),
  sourceRevision: integer('source_revision'),
  sourcePayloadHash: char('source_payload_hash', { length: 64 }),
  sourceApiKeyId: uuid('source_api_key_id'),
  // Монотонная ревизия состояния для внешнего клиента (см. bumpRevision).
  revision: integer('revision').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

// ─── tender positions (flat line items under a tender) ───
export const tenderPositions = pgTable('tender_positions', {
  id: pk(),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id, { onDelete: 'cascade' }),
  positionNo: integer('position_no').notNull(),
  name: text('name').notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
  unit: unitEnum('unit').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
  spec: text('spec'),
  isRequired: boolean('is_required').notNull().default(true),
  targetPrice: numeric('target_price', { precision: 18, scale: 2 }),
  // Единица в написании источника («шт», «м²») — для аудита маппинга.
  // Отдельно от spec: spec видит поставщик, это не место для метаданных.
  sourceUnit: varchar('source_unit', { length: 32 }),
});

// ─── bids (one active per supplier org per tender) ───
export const bids = pgTable('bids', {
  id: pk(),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id, { onDelete: 'cascade' }),
  supplierOrgId: uuid('supplier_org_id')
    .notNull()
    .references(() => organizations.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  status: bidStatusEnum('status').notNull().default('submitted'),
  totalWithoutVat: numeric('total_without_vat', { precision: 18, scale: 2 }).notNull(),
  vatAmount: numeric('vat_amount', { precision: 18, scale: 2 }).notNull(),
  totalWithVat: numeric('total_with_vat', { precision: 18, scale: 2 }).notNull(),
  rank: integer('rank'),
  isBest: boolean('is_best').notNull().default(false),
  comment: text('comment'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── bid items (per-position price) ───
export const bidItems = pgTable('bid_items', {
  id: pk(),
  bidId: uuid('bid_id')
    .notNull()
    .references(() => bids.id, { onDelete: 'cascade' }),
  positionId: uuid('position_id')
    .notNull()
    .references(() => tenderPositions.id, { onDelete: 'cascade' }),
  unitPriceWithoutVat: numeric('unit_price_without_vat', { precision: 18, scale: 2 }).notNull(),
  vatRate: vatRateEnum('vat_rate').notNull(),
  amountWithVat: numeric('amount_with_vat', { precision: 18, scale: 2 }).notNull(),
});

// ─── bid history (append-only, one row per submit) ───
export const bidHistory = pgTable('bid_history', {
  id: pk(),
  bidId: uuid('bid_id')
    .notNull()
    .references(() => bids.id, { onDelete: 'cascade' }),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id, { onDelete: 'cascade' }),
  supplierOrgId: uuid('supplier_org_id').notNull(),
  totalWithVat: numeric('total_with_vat', { precision: 18, scale: 2 }).notNull(),
  rankAfter: integer('rank_after'),
  triggeredExtension: boolean('triggered_extension').notNull().default(false),
  createdAt: createdAt(),
});

// ─── invitations (tokenized links for closed tenders / unregistered suppliers) ───
export const invitations = pgTable('invitations', {
  id: pk(),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id, { onDelete: 'cascade' }),
  email: citext('email').notNull(),
  companyName: text('company_name'),
  suggestedInn: varchar('suggested_inn', { length: 12 }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  status: inviteStatusEnum('status').notNull().default('pending'),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  acceptedUserId: uuid('accepted_user_id').references(() => users.id),
  acceptedOrgId: uuid('accepted_org_id').references(() => organizations.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ─── files (metadata; bytes live on disk/S3 behind StorageAdapter) ───
export const files = pgTable('files', {
  id: pk(),
  ownerType: fileOwnerEnum('owner_type').notNull(),
  ownerId: uuid('owner_id').notNull(),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  checksumSha256: varchar('checksum_sha256', { length: 64 }),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

// ─── notifications ───
export const notifications = pgTable('notifications', {
  id: pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: notifTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ─── external API surface (машинные ключи для интеграций) ───
// Секрет ключа не хранится: только префикс (для поиска) и SHA-256 полного ключа.
export const apiKeys = pgTable('api_keys', {
  id: pk(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  // Технический пользователь-actor: под ним пишется tenders.created_by.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  clientCode: varchar('client_code', { length: 32 }),
  keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  scopes: text('scopes').array(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: varchar('key', { length: 128 }).primaryKey(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
