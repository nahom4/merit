import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { Cents } from './money.js';

describe('Cents', () => {
  it('converts whole dollars to integer cents', () => {
    const result = Cents.fromDollars(655_738);
    expect(isOk(result) && Cents.toNumber(result.value)).toBe(65_573_800);
  });

  it('rounds a fractional dollar amount to the nearest cent rather than carrying a float', () => {
    const result = Cents.fromDollars(0.005);
    expect(isOk(result) && Cents.toNumber(result.value)).toBe(1);
  });

  it('accepts zero, because a filing may state a zero grant', () => {
    expect(isOk(Cents.parse(0))).toBe(true);
  });

  it('rejects a negative amount', () => {
    expect(isErr(Cents.parse(-1))).toBe(true);
  });

  it('rejects a non-integer number of cents', () => {
    expect(isErr(Cents.parse(1.5))).toBe(true);
  });

  it('rejects NaN', () => {
    expect(isErr(Cents.parse(Number.NaN))).toBe(true);
  });

  it('rejects a non-number', () => {
    expect(isErr(Cents.parse('100'))).toBe(true);
  });

  it('reports whole dollars for display', () => {
    const result = Cents.fromDollars(9_500);
    expect(isOk(result) && Cents.toDollars(result.value)).toBe(9_500);
  });
});
