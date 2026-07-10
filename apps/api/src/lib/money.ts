import { Decimal } from 'decimal.js';
import { VAT_PERCENT, type VatRate } from '@zakupki/shared';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/** Money as a fixed-2 decimal string. All server-side money math goes through Decimal. */
export function money(value: Decimal.Value): string {
  return new Decimal(value).toFixed(2);
}

export function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/** amount (with VAT) for a line: unitPrice * qty * (1 + vat%). Returns fixed-2 string. */
export function lineAmountWithVat(
  unitPriceWithoutVat: Decimal.Value,
  quantity: Decimal.Value,
  vatRate: VatRate,
): { withoutVat: string; withVat: string; vatAmount: string } {
  const base = new Decimal(unitPriceWithoutVat).times(quantity);
  const vat = base.times(VAT_PERCENT[vatRate]).dividedBy(100);
  return {
    withoutVat: base.toFixed(2),
    vatAmount: vat.toFixed(2),
    withVat: base.plus(vat).toFixed(2),
  };
}

export function sum(values: Decimal.Value[]): string {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0)).toFixed(2);
}

/** true if a < b (decimal-safe). */
export function lt(a: Decimal.Value, b: Decimal.Value): boolean {
  return new Decimal(a).lessThan(b);
}

export function lte(a: Decimal.Value, b: Decimal.Value): boolean {
  return new Decimal(a).lessThanOrEqualTo(b);
}

/**
 * A re-offer must be strictly lower than the org's own current bid, and — if a
 * min-step is configured — beat it by at least that absolute amount / percent.
 * No comparison against competitors (the leader is invisible to suppliers).
 */
export function meetsMinStep(
  newTotal: Decimal.Value,
  existingTotal: Decimal.Value,
  opts: { absStep?: string | null; pctStep?: string | null },
): boolean {
  const n = new Decimal(newTotal);
  const e = new Decimal(existingTotal);
  if (!n.lessThan(e)) return false;
  if (opts.absStep) {
    return n.lessThanOrEqualTo(e.minus(opts.absStep));
  }
  if (opts.pctStep) {
    const threshold = e.times(new Decimal(1).minus(new Decimal(opts.pctStep).dividedBy(100)));
    return n.lessThanOrEqualTo(threshold);
  }
  return true;
}
