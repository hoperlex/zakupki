import { describe, expect, it } from 'vitest';
import { lineAmountWithVat, lt, meetsMinStep, money, sum } from './money';

describe('lineAmountWithVat', () => {
  it('computes VAT 20% line total exactly', () => {
    const r = lineAmountWithVat('1200', '500', 'vat20');
    expect(r.withoutVat).toBe('600000.00');
    expect(r.vatAmount).toBe('120000.00');
    expect(r.withVat).toBe('720000.00');
  });

  it('computes VAT 10%', () => {
    const r = lineAmountWithVat('100', '10', 'vat10');
    expect(r.withVat).toBe('1100.00');
  });

  it('handles «без НДС» (none)', () => {
    const r = lineAmountWithVat('100', '10', 'none');
    expect(r.vatAmount).toBe('0.00');
    expect(r.withVat).toBe('1000.00');
  });

  it('is decimal-safe for values that break JS floats', () => {
    // 0.1 * 3 in float = 0.30000000000000004
    const r = lineAmountWithVat('0.10', '3', 'vat0');
    expect(r.withoutVat).toBe('0.30');
  });
});

describe('sum + money', () => {
  it('sums decimal strings exactly', () => {
    expect(sum(['1.1', '2.2', '3.3'])).toBe('6.60');
  });
  it('formats to fixed 2', () => {
    expect(money('99.9')).toBe('99.90');
  });
});

describe('lt', () => {
  it('strict less-than', () => {
    expect(lt('99.99', '100.00')).toBe(true);
    expect(lt('100.00', '100.00')).toBe(false);
    expect(lt('100.01', '100.00')).toBe(false);
  });
});

describe('meetsMinStep', () => {
  it('requires strictly lower with no step', () => {
    expect(meetsMinStep('999999.99', '1000000.00', {})).toBe(true);
    expect(meetsMinStep('1000000.00', '1000000.00', {})).toBe(false);
    expect(meetsMinStep('1000000.01', '1000000.00', {})).toBe(false);
  });

  it('enforces absolute step', () => {
    expect(meetsMinStep('995000.00', '1000000.00', { absStep: '5000' })).toBe(true);
    expect(meetsMinStep('996000.00', '1000000.00', { absStep: '5000' })).toBe(false);
  });

  it('enforces percentage step', () => {
    // 0.5% of 1,000,000 = 5,000 → threshold 995,000
    expect(meetsMinStep('995000.00', '1000000.00', { pctStep: '0.5' })).toBe(true);
    expect(meetsMinStep('995000.01', '1000000.00', { pctStep: '0.5' })).toBe(false);
  });

  it('allows improving your own rank without beating an (invisible) leader', () => {
    // supplier lowers own 1.2M -> 1.15M; still may be behind, but the offer is valid
    expect(meetsMinStep('1150000.00', '1200000.00', {})).toBe(true);
  });
});
