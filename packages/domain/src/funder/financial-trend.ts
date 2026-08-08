/**
 * A funder's financial trend and grantmaking capacity, from the summary figures its own
 * filings carry.
 *
 * "Should we bother" has a money answer as well as a behavioural one: a foundation whose
 * giving has halved over three years is a worse prospect than an identically-behaved one whose
 * giving has doubled, and neither fact is visible in the grant rows alone.
 */

/** Which return the year's figures came off. Different forms carry different fields, and the
 *  difference is reported rather than flattened. */
export type FilerFormType = 'form_990' | 'form_990_ez' | 'form_990_pf';

export interface FunderFinancialYear {
  readonly taxYear: number;
  readonly formType: FilerFormType;
  readonly totalRevenueCents: number | null;
  readonly totalExpensesCents: number | null;
  readonly totalAssetsEndCents: number | null;
  /**
   * Contributions and grants paid. 990-PF carries this directly; a 990 filer reports its
   * grants on Schedule I instead, so this is null for those years and the year is named in
   * `yearsWithoutGrantsPaid` rather than counted as zero giving.
   */
  readonly grantsPaidCents: number | null;
}

export type TrendDirection = 'rising' | 'falling' | 'steady' | 'unknown';

export interface Trend {
  readonly direction: TrendDirection;
  /** Proportional change from the earliest to the latest year with a figure. Null when undefined. */
  readonly changeRatio: number | null;
  readonly fromYear: number | null;
  readonly toYear: number | null;
}

export interface FinancialTrend {
  readonly years: readonly FunderFinancialYear[];
  readonly latest: FunderFinancialYear | null;
  readonly grantsPaid: Trend;
  readonly assets: Trend;
  /**
   * Grants paid as a share of assets in the latest year. A private foundation must distribute
   * roughly 5% of its investment assets annually (IRC section 4942), so this reads directly as
   * "is this funder giving at the minimum, or above it".
   */
  readonly payoutRate: number | null;
  readonly yearsWithoutGrantsPaid: readonly number[];
}

/**
 * Below this, a change is ordinary year-to-year variation in a foundation's payout schedule
 * -- one large multi-year commitment landing on either side of a filing date moves a small
 * funder by more than this -- and calling it a direction would be reading a signal into noise.
 */
const MATERIAL_CHANGE = 0.1;

const UNKNOWN: Trend = { direction: 'unknown', changeRatio: null, fromYear: null, toYear: null };

const trendOf = (
  years: readonly FunderFinancialYear[],
  pick: (year: FunderFinancialYear) => number | null,
): Trend => {
  const observed = years
    .map((year) => ({ taxYear: year.taxYear, value: pick(year) }))
    .filter((point): point is { taxYear: number; value: number } => point.value !== null);

  if (observed.length < 2) return UNKNOWN;

  const first = observed[0]!;
  const last = observed[observed.length - 1]!;
  // A ratio against zero is undefined, not infinite growth. Growth from nothing is a real
  // fact but not one this measure can express, so it declines to.
  if (first.value === 0) return { ...UNKNOWN, fromYear: first.taxYear, toYear: last.taxYear };

  const changeRatio = (last.value - first.value) / first.value;
  const direction: TrendDirection =
    Math.abs(changeRatio) < MATERIAL_CHANGE ? 'steady' : changeRatio > 0 ? 'rising' : 'falling';

  return { direction, changeRatio, fromYear: first.taxYear, toYear: last.taxYear };
};

export const computeFinancialTrend = (filings: readonly FunderFinancialYear[]): FinancialTrend => {
  const years = [...filings].sort((a, b) => a.taxYear - b.taxYear);
  const latest = years[years.length - 1] ?? null;

  const payoutRate =
    latest === null ||
    latest.grantsPaidCents === null ||
    latest.totalAssetsEndCents === null ||
    latest.totalAssetsEndCents === 0
      ? null
      : latest.grantsPaidCents / latest.totalAssetsEndCents;

  return {
    years,
    latest,
    grantsPaid: trendOf(years, (year) => year.grantsPaidCents),
    assets: trendOf(years, (year) => year.totalAssetsEndCents),
    payoutRate,
    yearsWithoutGrantsPaid: years.filter((year) => year.grantsPaidCents === null).map((year) => year.taxYear),
  };
};
