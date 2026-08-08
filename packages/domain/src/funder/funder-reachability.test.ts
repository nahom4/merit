import { describe, expect, it } from 'vitest';
import { computeReachability, type ReachabilityGrant } from './funder-reachability.js';

const grant = (overrides: Partial<ReachabilityGrant> = {}): ReachabilityGrant => ({
  granteeKey: 'a',
  granteeName: 'Grantee A',
  granteeState: 'NC',
  granteeNteeMajorGroup: 'B',
  granteeRevenueCents: 50_000_00,
  taxYear: 2023,
  amountCents: 10_000_00,
  irsObjectId: '202403559349300010',
  purpose: 'General operating support',
  ...overrides,
});

describe('grantee list by year', () => {
  it('reports one row per filing year, oldest first', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2024, granteeKey: 'b' }),
      grant({ taxYear: 2022, granteeKey: 'a' }),
      grant({ taxYear: 2023, granteeKey: 'a' }),
    ]);

    expect(reachability.years.map((year) => year.taxYear)).toEqual([2022, 2023, 2024]);
  });

  it('counts distinct grantees in a year, not grants', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2023, granteeKey: 'a', amountCents: 100 }),
      grant({ taxYear: 2023, granteeKey: 'a', amountCents: 200 }),
      grant({ taxYear: 2023, granteeKey: 'b' }),
    ]);

    expect(reachability.years[0]?.granteeCount).toBe(2);
    expect(reachability.years[0]?.grantCount).toBe(3);
  });

  it('totals and medians the amounts given in each year', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2023, granteeKey: 'a', amountCents: 1_000_00 }),
      grant({ taxYear: 2023, granteeKey: 'b', amountCents: 3_000_00 }),
      grant({ taxYear: 2023, granteeKey: 'c', amountCents: 5_000_00 }),
    ]);

    expect(reachability.years[0]?.totalCents).toBe(9_000_00);
    expect(reachability.years[0]?.medianCents).toBe(3_000_00);
  });

  it('names the grantees funded in each year so the row can be opened', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2023, granteeKey: 'a', granteeName: 'Literacy Council' }),
      grant({ taxYear: 2023, granteeKey: 'b', granteeName: 'Reading Partners' }),
    ]);

    expect(reachability.years[0]?.grantees.map((g) => g.name)).toEqual([
      'Literacy Council',
      'Reading Partners',
    ]);
  });
});

describe('turnover over time', () => {
  it('reports no turnover for the first year, which has no predecessor to compare against', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2022, granteeKey: 'a' }),
      grant({ taxYear: 2023, granteeKey: 'a' }),
    ]);

    expect(reachability.years[0]?.turnover).toBeNull();
  });

  it('reports full turnover when a year keeps none of the previous year’s grantees', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2022, granteeKey: 'a' }),
      grant({ taxYear: 2023, granteeKey: 'b' }),
    ]);

    expect(reachability.years[1]?.turnover).toBe(1);
  });

  it('reports zero turnover when every previous grantee is kept', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2022, granteeKey: 'a' }),
      grant({ taxYear: 2022, granteeKey: 'b' }),
      grant({ taxYear: 2023, granteeKey: 'a' }),
      grant({ taxYear: 2023, granteeKey: 'b' }),
    ]);

    expect(reachability.years[1]?.turnover).toBe(0);
  });

  it('separates arrivals from departures — a funder can add without dropping', () => {
    const reachability = computeReachability([
      grant({ taxYear: 2022, granteeKey: 'a' }),
      grant({ taxYear: 2023, granteeKey: 'a' }),
      grant({ taxYear: 2023, granteeKey: 'b' }),
    ]);

    expect(reachability.years[1]?.newGranteeCount).toBe(1);
    expect(reachability.years[1]?.departedGranteeCount).toBe(0);
    expect(reachability.years[1]?.turnover).toBe(0);
  });

  it('treats a gap year as a gap rather than closing it silently', () => {
    // 2023 is absent from the filings. Comparing 2024 against 2022 would invent continuity
    // the record does not show, so the year is compared with the year actually on file and
    // the gap is visible in the series.
    const reachability = computeReachability([
      grant({ taxYear: 2022, granteeKey: 'a' }),
      grant({ taxYear: 2024, granteeKey: 'b' }),
    ]);

    expect(reachability.years.map((year) => year.taxYear)).toEqual([2022, 2024]);
    expect(reachability.years[1]?.turnover).toBe(1);
  });
});

describe('ask distribution', () => {
  it('reports percentiles across every grant on file', () => {
    const amounts = [1_000_00, 2_000_00, 3_000_00, 4_000_00, 5_000_00];
    const reachability = computeReachability(
      amounts.map((amountCents, index) => grant({ amountCents, granteeKey: `g${index}` })),
    );

    expect(reachability.askDistribution.p50).toBe(3_000_00);
    expect(reachability.askDistribution.min).toBe(1_000_00);
    expect(reachability.askDistribution.max).toBe(5_000_00);
    expect(reachability.askDistribution.sampleSize).toBe(5);
  });

  it('reports nothing rather than a fabricated percentile when there are no grants', () => {
    const reachability = computeReachability([]);

    expect(reachability.askDistribution.p50).toBeNull();
    expect(reachability.askDistribution.sampleSize).toBe(0);
    expect(reachability.years).toEqual([]);
  });

  it('buckets the grants so the shape of the distribution is visible, not just its median', () => {
    const reachability = computeReachability([
      grant({ granteeKey: 'a', amountCents: 1_000_00 }),
      grant({ granteeKey: 'b', amountCents: 1_500_00 }),
      grant({ granteeKey: 'c', amountCents: 90_000_00 }),
    ]);

    const total = reachability.askDistribution.buckets.reduce((sum, b) => sum + b.grantCount, 0);
    expect(total).toBe(3);
    expect(reachability.askDistribution.buckets.some((b) => b.grantCount > 0)).toBe(true);
  });
});

describe('geographic spread', () => {
  it('reports each state’s share of the funder’s grants, largest first', () => {
    const reachability = computeReachability([
      grant({ granteeKey: 'a', granteeState: 'NC' }),
      grant({ granteeKey: 'b', granteeState: 'NC' }),
      grant({ granteeKey: 'c', granteeState: 'SC' }),
      grant({ granteeKey: 'd', granteeState: 'SC' }),
      grant({ granteeKey: 'e', granteeState: 'NC' }),
    ]);

    expect(reachability.geographicSpread.states[0]).toEqual({
      state: 'NC',
      grantCount: 3,
      share: 0.6,
    });
    expect(reachability.geographicSpread.distinctStates).toBe(2);
  });

  it('counts grants with no state on file rather than dropping them from the denominator', () => {
    // Silently excluding them would make a funder look more concentrated than the filings show.
    const reachability = computeReachability([
      grant({ granteeKey: 'a', granteeState: 'NC' }),
      grant({ granteeKey: 'b', granteeState: null }),
    ]);

    expect(reachability.geographicSpread.unstatedGrantCount).toBe(1);
    expect(reachability.geographicSpread.states[0]?.share).toBe(0.5);
  });
});

describe('program mix', () => {
  it('reports the share of grantees in each program area, largest first', () => {
    const reachability = computeReachability([
      grant({ granteeKey: 'a', granteeNteeMajorGroup: 'B' }),
      grant({ granteeKey: 'b', granteeNteeMajorGroup: 'B' }),
      grant({ granteeKey: 'c', granteeNteeMajorGroup: 'P' }),
    ]);

    expect(reachability.programMix[0]).toMatchObject({ majorGroup: 'B', granteeCount: 2 });
    expect(reachability.programMix[0]?.share).toBeCloseTo(2 / 3);
  });

  it('names the program area rather than leaving the reader to decode the letter', () => {
    const reachability = computeReachability([grant({ granteeNteeMajorGroup: 'B' })]);

    expect(reachability.programMix[0]?.label).toBe('Education');
  });

  it('counts grantees with no program code on file instead of implying the mix is complete', () => {
    const reachability = computeReachability([
      grant({ granteeKey: 'a', granteeNteeMajorGroup: 'B' }),
      grant({ granteeKey: 'b', granteeNteeMajorGroup: null }),
    ]);

    expect(reachability.programMixUnknownGrantees).toBe(1);
    // The share is of grantees whose program area is known, and the unknown count says so.
    expect(reachability.programMix[0]?.share).toBe(1);
  });

  it('counts a grantee once however many grants it received', () => {
    const reachability = computeReachability([
      grant({ granteeKey: 'a', granteeNteeMajorGroup: 'B', taxYear: 2022 }),
      grant({ granteeKey: 'a', granteeNteeMajorGroup: 'B', taxYear: 2023 }),
      grant({ granteeKey: 'b', granteeNteeMajorGroup: 'P' }),
    ]);

    expect(reachability.programMix.find((mix) => mix.majorGroup === 'B')?.granteeCount).toBe(1);
  });
});

describe('totals', () => {
  it('reports distinct grantees and total grants across the whole history', () => {
    const reachability = computeReachability([
      grant({ granteeKey: 'a', taxYear: 2022 }),
      grant({ granteeKey: 'a', taxYear: 2023 }),
      grant({ granteeKey: 'b', taxYear: 2023 }),
    ]);

    expect(reachability.distinctGrantees).toBe(2);
    expect(reachability.totalGrants).toBe(3);
    expect(reachability.totalCents).toBe(30_000_00);
  });
});
