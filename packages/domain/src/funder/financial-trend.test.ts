import { describe, expect, it } from 'vitest';
import { computeFinancialTrend, type FunderFinancialYear } from './financial-trend.js';

const year = (overrides: Partial<FunderFinancialYear> = {}): FunderFinancialYear => ({
  taxYear: 2022,
  formType: 'form_990_pf',
  totalRevenueCents: 100_000_000_00,
  totalExpensesCents: 50_000_000_00,
  totalAssetsEndCents: 1_000_000_000_00,
  grantsPaidCents: 50_000_000_00,
  ...overrides,
});

describe('ordering and the latest year', () => {
  it('orders the years oldest first however the source returned them', () => {
    const trend = computeFinancialTrend([year({ taxYear: 2023 }), year({ taxYear: 2021 })]);

    expect(trend.years.map((y) => y.taxYear)).toEqual([2021, 2023]);
  });

  it('reports the most recent year on file as the current picture', () => {
    const trend = computeFinancialTrend([year({ taxYear: 2021 }), year({ taxYear: 2023 })]);

    expect(trend.latest?.taxYear).toBe(2023);
  });

  it('reports nothing rather than inventing a picture when there are no filings', () => {
    const trend = computeFinancialTrend([]);

    expect(trend.latest).toBeNull();
    expect(trend.grantsPaid.direction).toBe('unknown');
    expect(trend.assets.direction).toBe('unknown');
  });
});

describe('direction of travel', () => {
  it('calls giving rising when it has grown materially across the window', () => {
    const trend = computeFinancialTrend([
      year({ taxYear: 2020, grantsPaidCents: 10_000_000_00 }),
      year({ taxYear: 2023, grantsPaidCents: 20_000_000_00 }),
    ]);

    expect(trend.grantsPaid.direction).toBe('rising');
    expect(trend.grantsPaid.changeRatio).toBe(1);
    expect(trend.grantsPaid.fromYear).toBe(2020);
    expect(trend.grantsPaid.toYear).toBe(2023);
  });

  it('calls giving falling when it has shrunk materially across the window', () => {
    const trend = computeFinancialTrend([
      year({ taxYear: 2020, grantsPaidCents: 20_000_000_00 }),
      year({ taxYear: 2023, grantsPaidCents: 10_000_000_00 }),
    ]);

    expect(trend.grantsPaid.direction).toBe('falling');
    expect(trend.grantsPaid.changeRatio).toBe(-0.5);
  });

  it('calls a small movement steady rather than reading a signal into ordinary variation', () => {
    const trend = computeFinancialTrend([
      year({ taxYear: 2020, grantsPaidCents: 10_000_000_00 }),
      year({ taxYear: 2023, grantsPaidCents: 10_500_000_00 }),
    ]);

    expect(trend.grantsPaid.direction).toBe('steady');
  });

  it('cannot state a direction from a single year, and does not pretend otherwise', () => {
    const trend = computeFinancialTrend([year({ taxYear: 2023 })]);

    expect(trend.grantsPaid.direction).toBe('unknown');
    expect(trend.grantsPaid.changeRatio).toBeNull();
  });

  it('tracks assets on the same basis as giving', () => {
    const trend = computeFinancialTrend([
      year({ taxYear: 2020, totalAssetsEndCents: 100_000_000_00 }),
      year({ taxYear: 2023, totalAssetsEndCents: 50_000_000_00 }),
    ]);

    expect(trend.assets.direction).toBe('falling');
  });

  it('reports no direction when the earliest figure is zero, which has no ratio', () => {
    const trend = computeFinancialTrend([
      year({ taxYear: 2020, grantsPaidCents: 0 }),
      year({ taxYear: 2023, grantsPaidCents: 10_000_000_00 }),
    ]);

    expect(trend.grantsPaid.direction).toBe('unknown');
    expect(trend.grantsPaid.changeRatio).toBeNull();
  });
});

describe('capacity', () => {
  it('reports what share of its assets the funder paid out in its latest year', () => {
    const trend = computeFinancialTrend([
      year({ taxYear: 2023, grantsPaidCents: 50_000_000_00, totalAssetsEndCents: 1_000_000_000_00 }),
    ]);

    expect(trend.payoutRate).toBe(0.05);
  });

  it('says nothing about payout when the filing carries no grants-paid figure', () => {
    const trend = computeFinancialTrend([year({ taxYear: 2023, grantsPaidCents: null })]);

    expect(trend.payoutRate).toBeNull();
  });

  it('names the years whose form does not carry a grants-paid figure at all', () => {
    // A 990 filer reports its grants on Schedule I, not in this summary. Leaving that silent
    // would read as "this funder gave nothing", which is a different and false claim.
    const trend = computeFinancialTrend([
      year({ taxYear: 2022, formType: 'form_990', grantsPaidCents: null }),
      year({ taxYear: 2023, formType: 'form_990_pf', grantsPaidCents: 1_000_00 }),
    ]);

    expect(trend.yearsWithoutGrantsPaid).toEqual([2022]);
  });
});
