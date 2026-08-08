import type { ReachabilityGrant } from './funder-reachability.js';

/**
 * How much to ask this funder for.
 *
 * The number that matters to an organisation that has never been funded here is not the
 * funder's median grant -- that is dominated by renewals to organisations already inside.
 * It is the median *first* grant, made to organisations of roughly this size. Those are two
 * filters on the same rows, and both of them move the answer a long way.
 */

export interface AskCalibrationInput {
  readonly grants: readonly ReachabilityGrant[];
  readonly organizationRevenueCents: number;
  readonly materialityFloorCents: number;
}

/**
 * Which rows the recommendation was actually computed from. Rendered beside the number: a
 * recommendation drawn from two grants to organisations of a different size is a different
 * claim from one drawn from forty in the right band, and the interface must not flatten them.
 */
export type CalibrationBasis =
  'first_grants_in_size_band' | 'first_grants_any_size' | 'all_grants' | 'no_evidence';

export interface AskCalibration {
  readonly recommendedCents: number | null;
  /** The interquartile range of the same sample. Null when the sample is too small to have one. */
  readonly lowCents: number | null;
  readonly highCents: number | null;
  readonly basis: CalibrationBasis;
  readonly sampleSize: number;
  /** The recommendation was below the materiality floor and has been raised to it. */
  readonly wasRaisedToFloor: boolean;
  /** The recommendation exceeded the organisation's annual revenue and has been capped at it. */
  readonly wasCappedAtRevenue: boolean;
}

/**
 * The size band peers are drawn from in S1, reused here so "an organisation like ours" means
 * the same thing on both screens.
 */
const BAND_LOWER = 0.5;
const BAND_UPPER = 4;

const percentile = (sorted: readonly number[], fraction: number): number | null => {
  if (sorted.length === 0) return null;
  if (fraction === 0.5) {
    const middle = sorted.length / 2;
    return sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[Math.floor(middle)]!;
  }
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1]!;
};

/**
 * Grants that are observably a grantee's first from this funder.
 *
 * A grantee whose earliest grant sits in the earliest year on file may have been funded for a
 * decade before the corpus window opened, so that grant is censored, not first. Where genuinely
 * uncensored first grants exist they are used alone; this mirrors `computeFunderSignals`.
 */
const firstGrantsOf = (grants: readonly ReachabilityGrant[]): readonly ReachabilityGrant[] => {
  if (grants.length === 0) return [];
  const earliestYearOnFile = Math.min(...grants.map((g) => g.taxYear));

  const firstYearOf = new Map<string, number>();
  for (const g of grants) {
    const seen = firstYearOf.get(g.granteeKey);
    if (seen === undefined || g.taxYear < seen) firstYearOf.set(g.granteeKey, g.taxYear);
  }

  const observed = grants.filter((g) => firstYearOf.get(g.granteeKey) === g.taxYear);
  const uncensored = observed.filter((g) => g.taxYear !== earliestYearOnFile);
  return uncensored.length > 0 ? uncensored : [];
};

const inSizeBand = (grant: ReachabilityGrant, revenueCents: number): boolean => {
  if (grant.granteeRevenueCents === null) return false;
  // An organisation with nothing on file would otherwise match only other zeroes.
  const scale = Math.max(revenueCents, 1);
  return grant.granteeRevenueCents >= scale * BAND_LOWER && grant.granteeRevenueCents <= scale * BAND_UPPER;
};

const NO_EVIDENCE: AskCalibration = {
  recommendedCents: null,
  lowCents: null,
  highCents: null,
  basis: 'no_evidence',
  sampleSize: 0,
  wasRaisedToFloor: false,
  wasCappedAtRevenue: false,
};

export const calibrateAsk = (input: AskCalibrationInput): AskCalibration => {
  const firstGrants = firstGrantsOf(input.grants);
  const inBand = firstGrants.filter((grant) => inSizeBand(grant, input.organizationRevenueCents));

  // Narrowest defensible sample first, widening only when the narrower one is empty. Each
  // step is recorded rather than smoothed over, because it weakens the claim.
  const [sample, basis]: [readonly ReachabilityGrant[], CalibrationBasis] =
    inBand.length > 0
      ? [inBand, 'first_grants_in_size_band']
      : firstGrants.length > 0
        ? [firstGrants, 'first_grants_any_size']
        : input.grants.length > 0
          ? [input.grants, 'all_grants']
          : [[], 'no_evidence'];

  if (sample.length === 0) return NO_EVIDENCE;

  const amounts = sample.map((grant) => grant.amountCents).sort((a, b) => a - b);
  const median = percentile(amounts, 0.5)!;

  // The recommendation is bounded at both ends by what is worth doing: below the materiality
  // floor the application costs more than the grant, and above the organisation's own annual
  // revenue the ask is not credible whatever the funder's history says.
  const ceiling = Math.max(input.organizationRevenueCents, input.materialityFloorCents);
  const raised = Math.max(median, input.materialityFloorCents);
  const recommended = Math.min(raised, ceiling);

  return {
    recommendedCents: Math.round(recommended),
    lowCents: amounts.length >= 4 ? percentile(amounts, 0.25) : null,
    highCents: amounts.length >= 4 ? percentile(amounts, 0.75) : null,
    basis,
    sampleSize: sample.length,
    wasRaisedToFloor: median < input.materialityFloorCents,
    wasCappedAtRevenue: raised > ceiling,
  };
};
