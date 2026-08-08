import { describe, expect, it } from 'vitest';
import { calibrateAsk } from './ask-calibration.js';
import type { ReachabilityGrant } from './funder-reachability.js';

const grant = (overrides: Partial<ReachabilityGrant> = {}): ReachabilityGrant => ({
  granteeKey: 'a',
  granteeName: 'Grantee A',
  granteeState: 'NC',
  granteeNteeMajorGroup: 'B',
  granteeRevenueCents: 600_000_00,
  taxYear: 2023,
  amountCents: 10_000_00,
  irsObjectId: '202403559349300010',
  purpose: null,
  ...overrides,
});

/** A $600k organisation, matching the Cape Fear benchmark's order of magnitude. */
const ORGANIZATION = {
  organizationRevenueCents: 600_000_00,
  materialityFloorCents: 3_000_00,
};

/** Distinct grantees, each appearing for the first time in a year after the first on file, so
 *  every amount counts as an observed first grant rather than a censored one. */
const firstGrants = (amounts: readonly number[], revenueCents: number | null): ReachabilityGrant[] => [
  grant({ granteeKey: 'anchor', taxYear: 2021, amountCents: 1_00, granteeRevenueCents: revenueCents }),
  ...amounts.map((amountCents, index) =>
    grant({ granteeKey: `g${index}`, taxYear: 2022, amountCents, granteeRevenueCents: revenueCents }),
  ),
];

describe('recommended ask', () => {
  it('recommends the median first grant made to organisations in the same size band', () => {
    const result = calibrateAsk({
      grants: firstGrants([5_000_00, 10_000_00, 15_000_00], 600_000_00),
      ...ORGANIZATION,
    });

    expect(result.recommendedCents).toBe(10_000_00);
    expect(result.basis).toBe('first_grants_in_size_band');
  });

  it('gives a range around the recommendation rather than a single false-precision number', () => {
    const result = calibrateAsk({
      grants: firstGrants([5_000_00, 10_000_00, 15_000_00, 20_000_00], 600_000_00),
      ...ORGANIZATION,
    });

    expect(result.lowCents).not.toBeNull();
    expect(result.highCents).not.toBeNull();
    expect(result.lowCents!).toBeLessThanOrEqual(result.recommendedCents!);
    expect(result.highCents!).toBeGreaterThanOrEqual(result.recommendedCents!);
  });

  it('states how many grants the recommendation rests on', () => {
    const result = calibrateAsk({
      grants: firstGrants([5_000_00, 10_000_00, 15_000_00], 600_000_00),
      ...ORGANIZATION,
    });

    expect(result.sampleSize).toBe(3);
  });
});

describe('the size band', () => {
  it('ignores first grants to organisations far larger than this one', () => {
    // A $40M university's first grant says nothing about what a $600k literacy council
    // should ask for, even from the same funder.
    const result = calibrateAsk({
      grants: [
        ...firstGrants([10_000_00], 600_000_00),
        grant({
          granteeKey: 'giant',
          taxYear: 2022,
          amountCents: 900_000_00,
          granteeRevenueCents: 40_000_000_00,
        }),
      ],
      ...ORGANIZATION,
    });

    expect(result.recommendedCents).toBe(10_000_00);
    expect(result.sampleSize).toBe(1);
  });

  it('ignores first grants to organisations far smaller than this one', () => {
    const result = calibrateAsk({
      grants: [
        ...firstGrants([10_000_00], 600_000_00),
        grant({ granteeKey: 'tiny', taxYear: 2022, amountCents: 200_00, granteeRevenueCents: 20_000_00 }),
      ],
      ...ORGANIZATION,
    });

    expect(result.sampleSize).toBe(1);
    expect(result.recommendedCents).toBe(10_000_00);
  });
});

describe('falling back, and saying so', () => {
  it('widens to every first grant when no grantee in the size band has a first grant on file', () => {
    const result = calibrateAsk({
      grants: firstGrants([8_000_00, 12_000_00], 40_000_000_00),
      ...ORGANIZATION,
    });

    expect(result.recommendedCents).toBe(10_000_00);
    expect(result.basis).toBe('first_grants_any_size');
  });

  it('falls back to all grants when the funder has no observable first grant at all', () => {
    // One year on file: every grantee's earliest grant is censored by the corpus window,
    // so no amount here is known to be a first grant.
    const result = calibrateAsk({
      grants: [
        grant({ granteeKey: 'a', taxYear: 2022, amountCents: 4_000_00 }),
        grant({ granteeKey: 'b', taxYear: 2022, amountCents: 6_000_00 }),
      ],
      ...ORGANIZATION,
    });

    expect(result.basis).toBe('all_grants');
    expect(result.recommendedCents).toBe(5_000_00);
  });

  it('recommends nothing rather than a number it cannot support when there are no grants', () => {
    const result = calibrateAsk({ grants: [], ...ORGANIZATION });

    expect(result.recommendedCents).toBeNull();
    expect(result.basis).toBe('no_evidence');
    expect(result.sampleSize).toBe(0);
  });
});

describe('the materiality floor and the organisation’s own scale', () => {
  it('does not recommend an ask below the floor at which an application is worth writing', () => {
    const result = calibrateAsk({
      grants: firstGrants([500_00, 600_00, 700_00], 600_000_00),
      ...ORGANIZATION,
    });

    expect(result.recommendedCents).toBe(ORGANIZATION.materialityFloorCents);
    expect(result.wasRaisedToFloor).toBe(true);
  });

  it('does not recommend asking for more than the organisation raises in a year', () => {
    const result = calibrateAsk({
      grants: firstGrants([2_000_000_00, 3_000_000_00, 4_000_000_00], 600_000_00),
      ...ORGANIZATION,
    });

    expect(result.recommendedCents).toBe(ORGANIZATION.organizationRevenueCents);
    expect(result.wasCappedAtRevenue).toBe(true);
  });

  it('leaves a recommendation inside the band untouched', () => {
    const result = calibrateAsk({
      grants: firstGrants([10_000_00], 600_000_00),
      ...ORGANIZATION,
    });

    expect(result.wasRaisedToFloor).toBe(false);
    expect(result.wasCappedAtRevenue).toBe(false);
  });
});
