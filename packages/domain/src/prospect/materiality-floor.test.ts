import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Cents } from '../shared/money.js';
import {
  materialityFloor,
  MATERIALITY_FLOOR_RATE,
  MATERIALITY_FLOOR_MINIMUM_DOLLARS,
} from './materiality-floor.js';

const dollars = (amount: number) => unwrapOrThrow(Cents.fromDollars(amount));

describe('materialityFloor', () => {
  it('is 0.5% of revenue for an organisation large enough for the percentage to bind', () => {
    // Cape Fear Literacy Council, $655,738 revenue -> $3,278.69. validation/RESULTS.txt: $3,279.
    expect(Cents.toDollars(materialityFloor(dollars(655_738)))).toBeCloseTo(3_278.69, 2);
  });

  it('is the $2,500 minimum for an organisation below the crossover', () => {
    expect(Cents.toDollars(materialityFloor(dollars(100_000)))).toBe(2_500);
  });

  it('is the $2,500 minimum exactly at the crossover revenue', () => {
    expect(Cents.toDollars(materialityFloor(dollars(500_000)))).toBe(2_500);
  });

  it('is the percentage just above the crossover revenue', () => {
    expect(Cents.toDollars(materialityFloor(dollars(500_001)))).toBeCloseTo(2_500.01, 2);
  });

  it('is the minimum for an organisation with no revenue on file', () => {
    expect(Cents.toDollars(materialityFloor(dollars(0)))).toBe(2_500);
  });

  it('scales with revenue for a larger organisation', () => {
    // Boys & Girls Club of Cabarrus County, $4,536,790 -> $22,683.95. RESULTS.txt: $22,684.
    expect(Cents.toDollars(materialityFloor(dollars(4_536_790)))).toBeCloseTo(22_683.95, 2);
  });

  it('publishes the rate and minimum it was validated against', () => {
    expect(MATERIALITY_FLOOR_RATE).toBe(0.005);
    expect(MATERIALITY_FLOOR_MINIMUM_DOLLARS).toBe(2_500);
  });
});
