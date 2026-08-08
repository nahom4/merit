import { unwrapOrThrow } from '@merit/shared';
import { Cents } from '../shared/money.js';

/**
 * 0.5% of revenue -- below this a grant is not worth the hours an application costs.
 * Validated against three real organisations in validation/RESULTS.txt.
 */
export const MATERIALITY_FLOOR_RATE = 0.005;

/**
 * The floor under the floor. For a very small organisation the percentage would admit
 * $500 grants, which are not worth an application to anyone.
 */
export const MATERIALITY_FLOOR_MINIMUM_DOLLARS = 2_500;

/**
 * The smallest typical grant worth pursuing for an organisation of this size.
 * A funder whose median grant sits below this is excluded from the prospect list --
 * which is why a family foundation counted for the $656k literacy council is noise
 * for the $4.5M club.
 */
export const materialityFloor = (annualRevenue: Cents): Cents => {
  const proportional = Cents.toDollars(annualRevenue) * MATERIALITY_FLOOR_RATE;
  return unwrapOrThrow(Cents.fromDollars(Math.max(MATERIALITY_FLOOR_MINIMUM_DOLLARS, proportional)));
};
