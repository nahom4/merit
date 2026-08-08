import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { TaxYear } from './tax-year.js';

describe('TaxYear', () => {
  it('accepts a four-digit year', () => {
    const result = TaxYear.parse(2024);
    expect(isOk(result) && TaxYear.toNumber(result.value)).toBe(2024);
  });

  it('accepts the string form the XML carries', () => {
    const result = TaxYear.parse('2023');
    expect(isOk(result) && TaxYear.toNumber(result.value)).toBe(2023);
  });

  it('rejects a year before electronic filing existed, rather than storing an impossible date', () => {
    expect(isErr(TaxYear.parse(1899))).toBe(true);
  });

  it('rejects a year far in the future', () => {
    expect(isErr(TaxYear.parse(2999))).toBe(true);
  });

  it('rejects a non-numeric string', () => {
    expect(isErr(TaxYear.parse('twenty-four'))).toBe(true);
  });

  it('rejects null', () => {
    expect(isErr(TaxYear.parse(null))).toBe(true);
  });

  it('orders years', () => {
    const a = TaxYear.parse(2023);
    const b = TaxYear.parse(2024);
    expect(isOk(a) && isOk(b) && TaxYear.compare(a.value, b.value)).toBeLessThan(0);
  });
});
