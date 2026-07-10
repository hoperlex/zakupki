import { Tag } from 'antd';
import {
  ACCREDITATION_STATUS_LABELS,
  TENDER_STATUS_LABELS,
  type AccreditationStatus,
  type TenderStatus,
} from '@zakupki/shared';

const TENDER_COLORS: Record<TenderStatus, string> = {
  draft: 'default',
  published: 'blue',
  collecting: 'green',
  under_review: 'gold',
  awarded: 'purple',
  cancelled: 'red',
  closed: 'default',
};

export function TenderStatusTag({ status }: { status: TenderStatus }) {
  return <Tag color={TENDER_COLORS[status]}>{TENDER_STATUS_LABELS[status]}</Tag>;
}

const ACCRED_COLORS: Record<AccreditationStatus, string> = {
  none: 'default',
  pending: 'blue',
  under_review: 'gold',
  needs_docs: 'orange',
  accredited: 'green',
  rejected: 'red',
  suspended: 'volcano',
};

export function AccreditationTag({ status }: { status: AccreditationStatus }) {
  return <Tag color={ACCRED_COLORS[status]}>{ACCREDITATION_STATUS_LABELS[status]}</Tag>;
}
