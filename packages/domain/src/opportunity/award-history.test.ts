import { describe, expect, it } from 'vitest';
import {
  computeWinnerCohort,
  NO_DENOMINATOR_CAVEAT,
  type FederalAward,
  type WinnerCohortInput,
} from './award-history.js';

const award = (overrides: Partial<FederalAward> = {}): FederalAward => ({
  awardId: '90YE0104',
  recipientName: 'Coastal Literacy Alliance',
  recipientKey: 'recipient_1',
  amountCents: 200_000_00,
  startDate: '2024-09-30',
  programNumber: '93.647',
  awardingAgency: 'Department of Health and Human Services',
  ...overrides,
});

const cohort = (overrides: Partial<WinnerCohortInput> = {}) =>
  computeWinnerCohort({
    programNumber: '93.647',
    awards: [award()],
    awardCeilingCents: null,
    announcementExpectsAwards: null,
    ...overrides,
  });

/** Three years, three awards each, two of them to one repeat winner. */
const threeYears = (): readonly FederalAward[] =>
  [2022, 2023, 2024].flatMap((year, yearIndex) =>
    [0, 1, 2].map((index) =>
      award({
        awardId: `award_${year}_${index}`,
        recipientKey: index === 0 ? 'incumbent' : `recipient_${yearIndex}_${index}`,
        amountCents: (index + 1) * 100_000_00,
        startDate: `${year}-09-30`,
      }),
    ),
  );

describe('computeWinnerCohort — size and shape', () => {
  it('reports the median, smallest and largest award actually made', () => {
    const result = cohort({
      awards: [
        award({ awardId: 'a', amountCents: 50_000_00 }),
        award({ awardId: 'b', amountCents: 200_000_00 }),
        award({ awardId: 'c', amountCents: 900_000_00 }),
      ],
    });

    expect(result.medianAwardCents).toBe(200_000_00);
    expect(result.smallestAwardCents).toBe(50_000_00);
    expect(result.largestAwardCents).toBe(900_000_00);
  });

  it('buckets awards into bands a development director actually asks about', () => {
    const result = cohort({
      awards: [
        award({ awardId: 'a', amountCents: 20_000_00 }),
        award({ awardId: 'b', amountCents: 100_000_00 }),
        award({ awardId: 'c', amountCents: 150_000_00 }),
      ],
    });

    expect(result.sizeBands.map((band) => band.label)).toEqual(['under $50k', '$50k – $250k']);
    expect(result.sizeBands[1]?.count).toBe(2);
  });

  it('compares the median award against the ceiling the announcement advertises', () => {
    // The most useful sentence on the page: the ceiling is what an announcement advertises,
    // the median is what it pays.
    const result = cohort({
      awards: [award({ amountCents: 150_000_00 })],
      awardCeilingCents: 300_000_00,
    });

    expect(result.medianVsCeiling).toContain('$150,000');
    expect(result.medianVsCeiling).toContain('50%');
    expect(result.medianVsCeiling).toContain('$300,000');
  });

  it('states no ceiling comparison when the announcement states no ceiling', () => {
    expect(cohort({ awardCeilingCents: null }).medianVsCeiling).toBeNull();
  });
});

describe('computeWinnerCohort — cycles and trend', () => {
  it('counts awards per cycle from the year each award started', () => {
    const result = cohort({ awards: threeYears() });

    expect(result.cycles).toHaveLength(3);
    expect(result.cycles[0]).toMatchObject({ year: 2022, awardCount: 3 });
    expect(result.cycles[0]?.totalCents).toBe(600_000_00);
  });

  it('refuses to call a direction from too few cycles', () => {
    // Two points is a line through anything. The honest answer is its own answer, not a
    // defaulted "steady" that reads like a finding.
    const result = cohort({
      awards: [
        award({ awardId: 'a', startDate: '2023-01-01' }),
        award({ awardId: 'b', startDate: '2024-01-01' }),
      ],
    });

    expect(result.trend).toBe('not_enough_cycles');
    expect(result.trendStatement).toContain('too few');
  });

  it('calls a program rising when the later years make materially more awards', () => {
    const awards = [
      ...[1, 2].map((index) => award({ awardId: `a${index}`, startDate: '2021-09-30' })),
      ...[1, 2].map((index) => award({ awardId: `b${index}`, startDate: '2022-09-30' })),
      ...[1, 2, 3, 4, 5].map((index) => award({ awardId: `c${index}`, startDate: '2023-09-30' })),
      ...[1, 2, 3, 4, 5, 6].map((index) => award({ awardId: `d${index}`, startDate: '2024-09-30' })),
    ];

    expect(cohort({ awards }).trend).toBe('rising');
  });

  it('calls a shrinking program falling, and says a shrinking program is harder', () => {
    const awards = [
      ...[1, 2, 3, 4, 5, 6].map((index) => award({ awardId: `a${index}`, startDate: '2021-09-30' })),
      ...[1, 2, 3, 4, 5].map((index) => award({ awardId: `b${index}`, startDate: '2022-09-30' })),
      ...[1, 2].map((index) => award({ awardId: `c${index}`, startDate: '2023-09-30' })),
      ...[1].map((index) => award({ awardId: `d${index}`, startDate: '2024-09-30' })),
    ];

    const result = cohort({ awards });

    expect(result.trend).toBe('falling');
    expect(result.trendStatement).toContain('harder program');
  });

  it('does not call a one-award swing a trend', () => {
    const awards = [
      ...[1, 2, 3, 4, 5].map((index) => award({ awardId: `a${index}`, startDate: '2022-09-30' })),
      ...[1, 2, 3, 4, 5].map((index) => award({ awardId: `b${index}`, startDate: '2023-09-30' })),
      ...[1, 2, 3, 4].map((index) => award({ awardId: `c${index}`, startDate: '2024-09-30' })),
    ];

    expect(cohort({ awards }).trend).toBe('steady');
  });

  it('ignores an award with no start date rather than inventing a year for it', () => {
    const result = cohort({
      awards: [...threeYears(), award({ awardId: 'undated', startDate: null })],
    });

    expect(result.cycles.reduce((sum, cycle) => sum + cycle.awardCount, 0)).toBe(9);
    // It still counts as an award: dropping it entirely would understate the program.
    expect(result.awardCount).toBe(10);
  });
});

describe('computeWinnerCohort — repeat concentration', () => {
  it('reports the share of awards going to organisations that won more than once', () => {
    const result = cohort({ awards: threeYears() });

    // One recipient won in all three years; the other six won once each.
    expect(result.repeatWinnerShare).toBeCloseTo(3 / 9);
    expect(result.repeatStatement).toContain('33%');
  });

  it('warns about incumbents when most awards go to repeat winners', () => {
    const awards = [
      ...[1, 2, 3].map((index) => award({ awardId: `a${index}`, recipientKey: 'incumbent' })),
      award({ awardId: 'b', recipientKey: 'newcomer' }),
    ];

    const result = cohort({ awards });

    expect(result.repeatWinnerShare).toBe(0.75);
    expect(result.repeatStatement).toContain('incumbents');
  });

  it('says plainly when no organisation has ever won twice', () => {
    const awards = [1, 2, 3].map((index) =>
      award({ awardId: `a${index}`, recipientKey: `recipient_${index}` }),
    );

    const result = cohort({ awards });

    expect(result.repeatWinnerShare).toBe(0);
    expect(result.repeatStatement).toContain('No organisation has won twice');
  });
});

describe('computeWinnerCohort — the competitive base rate', () => {
  it('carries the no-denominator caveat on the value itself', () => {
    // The caveat travels with the number so that rendering the number without it takes
    // deliberate effort rather than forgetfulness.
    expect(cohort({ awards: threeYears() }).baseRate.caveat).toBe(NO_DENOMINATOR_CAVEAT);
  });

  it('never claims a probability of winning, in any of its wording', () => {
    const result = cohort({
      awards: threeYears(),
      announcementExpectsAwards: 4,
      awardCeilingCents: 300_000_00,
    });
    const everySentence = [
      result.baseRate.caveat,
      result.baseRate.comparison ?? '',
      result.trendStatement,
      result.repeatStatement,
      result.medianVsCeiling ?? '',
      result.coverage.statement,
    ].join(' ');

    expect(everySentence).not.toMatch(/win probability|chance of winning|odds of|success rate/iu);
    expect(result.baseRate.caveat).toContain('never records who applied');
  });

  it('reports awards and distinct winners per cycle, which are different numbers', () => {
    const result = cohort({ awards: threeYears() });

    expect(result.baseRate.awardsPerCycle).toBe(3);
    expect(result.baseRate.winnersPerCycle).toBe(3);
  });

  it('flags an announcement promising far more awards than the program has ever made', () => {
    const result = cohort({ awards: threeYears(), announcementExpectsAwards: 12 });

    expect(result.baseRate.comparison).toContain('12 awards');
    expect(result.baseRate.comparison).toContain('optimistic');
  });

  it('says when the announcement is in line with the program’s own history', () => {
    const result = cohort({ awards: threeYears(), announcementExpectsAwards: 3 });

    expect(result.baseRate.comparison).toContain('in line with');
  });

  it('offers no comparison when the announcement states no expected count', () => {
    expect(cohort({ awards: threeYears() }).baseRate.comparison).toBeNull();
  });
});

describe('computeWinnerCohort — coverage', () => {
  it('states how many awards and how many years the figures rest on', () => {
    const result = cohort({ awards: threeYears() });

    expect(result.coverage.statement).toContain('9 awards across 3 years');
  });

  it('reports awards recorded under a different primary listing rather than hiding them', () => {
    // Real behaviour of the live API: filtering on 93.647 returned 94 awards displaying 93.647
    // and 6 displaying another listing, because one award can be funded under several.
    const result = cohort({
      awards: [...threeYears(), award({ awardId: 'other', programNumber: '93.595' })],
    });

    expect(result.coverage.awardsUnderExactProgram).toBe(9);
    expect(result.coverage.statement).toContain('different primary assistance listing');
  });

  it('says an empty record is a gap, not evidence that nothing was awarded', () => {
    const result = cohort({ awards: [] });

    expect(result.awardCount).toBe(0);
    expect(result.medianAwardCents).toBeNull();
    expect(result.coverage.statement).toContain('gap in the record');
    expect(result.coverage.statement).not.toContain('no awards were made');
  });
});
