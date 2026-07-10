-- СУ-10 tender portal — initial schema (SQL-first, per corp standard §5).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── enums ───
CREATE TYPE org_kind AS ENUM ('internal', 'supplier');
CREATE TYPE role AS ENUM ('admin', 'manager', 'security', 'supplier');
CREATE TYPE tender_type AS ENUM ('smr', 'materials');
CREATE TYPE tender_visibility AS ENUM ('open', 'closed');
CREATE TYPE tender_status AS ENUM ('draft', 'published', 'collecting', 'under_review', 'awarded', 'cancelled', 'closed');
CREATE TYPE bid_status AS ENUM ('draft', 'submitted', 'withdrawn', 'rejected');
CREATE TYPE vat_rate AS ENUM ('vat20', 'vat10', 'vat0', 'none');
CREATE TYPE accreditation_status AS ENUM ('none', 'pending', 'under_review', 'needs_docs', 'accredited', 'rejected', 'suspended');
CREATE TYPE accred_verdict AS ENUM ('approved', 'needs_docs', 'rejected', 'suspended');
CREATE TYPE invite_status AS ENUM ('pending', 'opened', 'accepted', 'expired', 'revoked');
CREATE TYPE unit AS ENUM ('pcs', 'm', 'm2', 'm3', 'kg', 't', 'l', 'set', 'h');
CREATE TYPE file_owner AS ENUM ('tender', 'bid', 'organization', 'position');
CREATE TYPE notif_type AS ENUM ('accreditation', 'invitation', 'outbid', 'tender_matched', 'award', 'deadline');

-- ─── organizations ───
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind org_kind NOT NULL DEFAULT 'supplier',
  full_name text NOT NULL,
  short_name text,
  inn varchar(12) NOT NULL,
  kpp varchar(9),
  ogrn varchar(15) NOT NULL,
  okpo varchar(20),
  okved varchar(20),
  tax_system text,
  is_vat_payer boolean NOT NULL DEFAULT true,
  legal_address text,
  postal_address text,
  bank_name text,
  bank_bik varchar(9),
  bank_corr_account varchar(20),
  settlement_account varchar(20),
  director_name text,
  director_basis text,
  contact_phone varchar(30),
  contact_email text,
  questionnaire jsonb,
  accreditation_status accreditation_status NOT NULL DEFAULT 'none',
  accreditation_submitted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX organizations_inn_kpp_uq ON organizations (inn, coalesce(kpp, '')) WHERE deleted_at IS NULL;
CREATE INDEX organizations_accreditation_status_idx ON organizations (accreditation_status);

-- ─── users ───
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  email citext NOT NULL,
  phone varchar(30),
  full_name text NOT NULL,
  password_hash text,
  role role NOT NULL DEFAULT 'supplier',
  is_active boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_organization_id_idx ON users (organization_id);

-- ─── auth refresh tokens ───
CREATE TABLE auth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_refresh_tokens_user_id_idx ON auth_refresh_tokens (user_id);
CREATE INDEX auth_refresh_tokens_token_hash_idx ON auth_refresh_tokens (token_hash);

-- ─── password reset tokens ───
CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_token_hash_idx ON password_reset_tokens (token_hash);

-- ─── accreditation reviews ───
CREATE TABLE accreditation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reviewer_id uuid,
  verdict accred_verdict NOT NULL,
  note text NOT NULL,
  documents_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accreditation_reviews_org_idx ON accreditation_reviews (organization_id, created_at);

-- ─── categories ───
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  kind tender_type NOT NULL,
  code varchar(50),
  name text NOT NULL,
  path text NOT NULL DEFAULT '/',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_parent_id_idx ON categories (parent_id);
CREATE INDEX categories_kind_idx ON categories (kind);

-- ─── category subscriptions ───
CREATE TABLE category_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  category_id uuid NOT NULL,
  include_subtree boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX category_subscriptions_uq ON category_subscriptions (organization_id, category_id);

-- ─── tenders ───
CREATE TABLE tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number varchar(32) NOT NULL,
  title text NOT NULL,
  type tender_type NOT NULL,
  visibility tender_visibility NOT NULL DEFAULT 'open',
  status tender_status NOT NULL DEFAULT 'draft',
  category_id uuid,
  organization_id uuid NOT NULL,
  created_by uuid NOT NULL,
  description text,
  terms jsonb,
  currency varchar(3) NOT NULL DEFAULT 'RUB',
  expected_vat_rate vat_rate NOT NULL DEFAULT 'vat20',
  ranking_basis text NOT NULL DEFAULT 'with_vat',
  min_step_pct numeric(6,2),
  min_step_abs numeric(18,2),
  starts_at timestamptz,
  deadline_at timestamptz NOT NULL,
  original_deadline_at timestamptz NOT NULL,
  auto_extend_enabled boolean NOT NULL DEFAULT true,
  auto_extend_window_sec integer NOT NULL DEFAULT 300,
  auto_extend_step_sec integer NOT NULL DEFAULT 300,
  auto_extend_max_count integer NOT NULL DEFAULT 3,
  extend_count integer NOT NULL DEFAULT 0,
  awarded_bid_id uuid,
  close_reason text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX tenders_number_uq ON tenders (number);
CREATE INDEX tenders_status_deadline_idx ON tenders (status, deadline_at);
CREATE INDEX tenders_category_id_idx ON tenders (category_id);
CREATE INDEX tenders_visibility_idx ON tenders (visibility);

-- ─── tender positions ───
CREATE TABLE tender_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL,
  position_no integer NOT NULL,
  name text NOT NULL,
  category_id uuid,
  unit unit NOT NULL,
  quantity numeric(18,3) NOT NULL,
  spec text,
  is_required boolean NOT NULL DEFAULT true,
  target_price numeric(18,2)
);
CREATE UNIQUE INDEX tender_positions_tender_no_uq ON tender_positions (tender_id, position_no);

-- ─── bids ───
CREATE TABLE bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL,
  supplier_org_id uuid NOT NULL,
  created_by uuid NOT NULL,
  status bid_status NOT NULL DEFAULT 'submitted',
  total_without_vat numeric(18,2) NOT NULL,
  vat_amount numeric(18,2) NOT NULL,
  total_with_vat numeric(18,2) NOT NULL,
  rank integer,
  is_best boolean NOT NULL DEFAULT false,
  comment text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bids_tender_supplier_uq ON bids (tender_id, supplier_org_id) WHERE status <> 'withdrawn';
CREATE INDEX bids_tender_total_idx ON bids (tender_id, total_with_vat);
CREATE INDEX bids_tender_rank_idx ON bids (tender_id, rank);

-- ─── bid items ───
CREATE TABLE bid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL,
  position_id uuid NOT NULL,
  unit_price_without_vat numeric(18,2) NOT NULL,
  vat_rate vat_rate NOT NULL,
  amount_with_vat numeric(18,2) NOT NULL
);
CREATE INDEX bid_items_bid_id_idx ON bid_items (bid_id);

-- ─── bid history ───
CREATE TABLE bid_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL,
  tender_id uuid NOT NULL,
  supplier_org_id uuid NOT NULL,
  total_with_vat numeric(18,2) NOT NULL,
  rank_after integer,
  triggered_extension boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bid_history_tender_created_idx ON bid_history (tender_id, created_at);

-- ─── invitations ───
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL,
  email citext NOT NULL,
  company_name text,
  suggested_inn varchar(12),
  token_hash varchar(64) NOT NULL,
  status invite_status NOT NULL DEFAULT 'pending',
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  accepted_user_id uuid,
  accepted_org_id uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_token_hash_uq ON invitations (token_hash);
CREATE INDEX invitations_tender_email_idx ON invitations (tender_id, email);

-- ─── files ───
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type file_owner NOT NULL,
  owner_id uuid NOT NULL,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  checksum_sha256 varchar(64),
  uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX files_owner_idx ON files (owner_type, owner_id);

-- ─── notifications ───
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type notif_type NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_read_idx ON notifications (user_id, read_at);

-- ─── external API (designed; endpoints deferred) ───
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  key_prefix varchar(16) NOT NULL,
  key_hash varchar(64) NOT NULL,
  scopes text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  key varchar(128) PRIMARY KEY,
  request_hash varchar(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── foreign keys (added after all tables to allow cyclic refs) ───
ALTER TABLE organizations ADD CONSTRAINT organizations_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE users ADD CONSTRAINT users_organization_id_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE auth_refresh_tokens ADD CONSTRAINT auth_refresh_tokens_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE accreditation_reviews ADD CONSTRAINT accreditation_reviews_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE accreditation_reviews ADD CONSTRAINT accreditation_reviews_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES users(id);
ALTER TABLE category_subscriptions ADD CONSTRAINT category_subscriptions_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE category_subscriptions ADD CONSTRAINT category_subscriptions_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
ALTER TABLE tenders ADD CONSTRAINT tenders_category_fk FOREIGN KEY (category_id) REFERENCES categories(id);
ALTER TABLE tenders ADD CONSTRAINT tenders_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE tenders ADD CONSTRAINT tenders_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE tender_positions ADD CONSTRAINT tender_positions_tender_fk FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
ALTER TABLE tender_positions ADD CONSTRAINT tender_positions_category_fk FOREIGN KEY (category_id) REFERENCES categories(id);
ALTER TABLE bids ADD CONSTRAINT bids_tender_fk FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
ALTER TABLE bids ADD CONSTRAINT bids_supplier_fk FOREIGN KEY (supplier_org_id) REFERENCES organizations(id);
ALTER TABLE bids ADD CONSTRAINT bids_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE bid_items ADD CONSTRAINT bid_items_bid_fk FOREIGN KEY (bid_id) REFERENCES bids(id) ON DELETE CASCADE;
ALTER TABLE bid_items ADD CONSTRAINT bid_items_position_fk FOREIGN KEY (position_id) REFERENCES tender_positions(id) ON DELETE CASCADE;
ALTER TABLE bid_history ADD CONSTRAINT bid_history_bid_fk FOREIGN KEY (bid_id) REFERENCES bids(id) ON DELETE CASCADE;
ALTER TABLE bid_history ADD CONSTRAINT bid_history_tender_fk FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
ALTER TABLE invitations ADD CONSTRAINT invitations_tender_fk FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
ALTER TABLE invitations ADD CONSTRAINT invitations_invited_by_fk FOREIGN KEY (invited_by) REFERENCES users(id);
ALTER TABLE invitations ADD CONSTRAINT invitations_accepted_user_fk FOREIGN KEY (accepted_user_id) REFERENCES users(id);
ALTER TABLE invitations ADD CONSTRAINT invitations_accepted_org_fk FOREIGN KEY (accepted_org_id) REFERENCES organizations(id);
ALTER TABLE files ADD CONSTRAINT files_uploaded_by_fk FOREIGN KEY (uploaded_by) REFERENCES users(id);
ALTER TABLE notifications ADD CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);
