import dayjs from 'dayjs';
import { UNIT_LABELS, type Unit } from '@zakupki/shared';

export function formatMoney(value: string | number | null | undefined, withSymbol = true): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  const s = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return withSymbol ? `${s} ₽` : s;
}

export function formatQty(value: string | number, unit?: Unit): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const s = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(n);
  return unit ? `${s} ${UNIT_LABELS[unit]}` : s;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY');
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY HH:mm');
}

/** "через 2 дн. 4 ч." style remaining-time label. */
export function humanizeRemaining(deadline: string | Date): string {
  const ms = dayjs(deadline).diff(dayjs());
  if (ms <= 0) return 'завершён';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} дн. ${hours} ч.`;
  if (hours > 0) return `${hours} ч. ${mins} мин.`;
  return `${mins} мин.`;
}
