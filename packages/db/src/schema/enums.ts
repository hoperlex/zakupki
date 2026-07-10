import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ACCRED_VERDICTS,
  ACCREDITATION_STATUSES,
  BID_STATUSES,
  FILE_OWNERS,
  INVITE_STATUSES,
  NOTIF_TYPES,
  ORG_KINDS,
  ROLES,
  TENDER_STATUSES,
  TENDER_TYPES,
  TENDER_VISIBILITIES,
  UNITS,
  VAT_RATES,
} from '@zakupki/shared';

export const orgKindEnum = pgEnum('org_kind', ORG_KINDS);
export const roleEnum = pgEnum('role', ROLES);
export const tenderTypeEnum = pgEnum('tender_type', TENDER_TYPES);
export const tenderVisibilityEnum = pgEnum('tender_visibility', TENDER_VISIBILITIES);
export const tenderStatusEnum = pgEnum('tender_status', TENDER_STATUSES);
export const bidStatusEnum = pgEnum('bid_status', BID_STATUSES);
export const vatRateEnum = pgEnum('vat_rate', VAT_RATES);
export const accreditationStatusEnum = pgEnum('accreditation_status', ACCREDITATION_STATUSES);
export const accredVerdictEnum = pgEnum('accred_verdict', ACCRED_VERDICTS);
export const inviteStatusEnum = pgEnum('invite_status', INVITE_STATUSES);
export const unitEnum = pgEnum('unit', UNITS);
export const fileOwnerEnum = pgEnum('file_owner', FILE_OWNERS);
export const notifTypeEnum = pgEnum('notif_type', NOTIF_TYPES);
