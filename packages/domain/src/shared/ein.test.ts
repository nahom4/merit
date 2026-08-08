import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { Ein } from './ein.js';

describe('Ein', () => {
  it('accepts nine digits', () => {
    const result = Ein.parse('581613254');
    expect(isOk(result) && Ein.toString(result.value)).toBe('581613254');
  });

  it('accepts the hyphenated form the IRS prints and stores it digits-only', () => {
    const result = Ein.parse('58-1613254');
    expect(isOk(result) && Ein.toString(result.value)).toBe('581613254');
  });

  it('left-pads an EIN that lost a leading zero to a spreadsheet', () => {
    const result = Ein.parse('34108119');
    expect(isOk(result) && Ein.toString(result.value)).toBe('034108119');
  });

  it('rejects a value with too many digits', () => {
    const result = Ein.parse('5816132540');
    expect(isErr(result) && result.error.context['field']).toBe('ein');
  });

  it('rejects a value containing letters', () => {
    expect(isErr(Ein.parse('58161325A'))).toBe(true);
  });

  it('rejects the all-zero EIN, which filings use as a placeholder for "not stated"', () => {
    expect(isErr(Ein.parse('000000000'))).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isErr(Ein.parse(''))).toBe(true);
  });

  it('rejects a non-string', () => {
    expect(isErr(Ein.parse(581613254))).toBe(true);
  });

  it('rejects null', () => {
    expect(isErr(Ein.parse(null))).toBe(true);
  });

  it('treats two spellings of the same EIN as equal', () => {
    const a = Ein.parse('58-1613254');
    const b = Ein.parse('581613254');
    expect(isOk(a) && isOk(b) && Ein.equals(a.value, b.value)).toBe(true);
  });
});
