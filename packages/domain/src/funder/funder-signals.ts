/**
 * A funder's behavioural profile, computed as arithmetic over its own filing history.
 * None of this is model output, and none of it is something a foundation publishes about
 * itself -- which is exactly why it is worth computing.
 */

/** One grant, reduced to what a signal needs. `granteeKey` is a resolved entity id where
 *  resolution succeeded, and a normalised name otherwise. */
export interface GranteeGrant {
  readonly granteeKey: string;
  readonly taxYear: number;
  readonly amountCents: number;
  readonly granteeState: string | null;
}

export interface FunderSignals {
  /**
   * Share of a year's grantees absent from the prior year, averaged over years that have a
   * predecessor. Null when only one year is on file -- unknown, not open.
   *
   * This carries the most weight in the prospect score: it is the closest available proxy
   * for whether a newcomer can get in.
   */
  readonly turnover: number | null;
  readonly newGranteesPerYear: number | null;
  readonly newGranteeShare: number | null;
  /** Herfindahl index over grant amounts: 1 is one dominant grantee, near 0 is even spread. */
  readonly concentration: number | null;
  readonly askP50: number | null;
  readonly askP90: number | null;
  /** Median first grant to a new grantee. What a newcomer actually receives. */
  readonly firstTimeAskP50: number | null;
  /** Median consecutive years a grantee is kept. */
  readonly retentionYearsP50: number | null;
  /** Share of grants by recipient state, so geographic reach can be read off directly. */
  readonly stateShares: Readonly<Record<string, number>>;
  readonly distinctGrantees: number;
  readonly totalGrants: number;
  readonly yearsCovered: readonly number[];
}

const EMPTY: FunderSignals = {
  turnover: null,
  newGranteesPerYear: null,
  newGranteeShare: null,
  concentration: null,
  askP50: null,
  askP90: null,
  firstTimeAskP50: null,
  retentionYearsP50: null,
  stateShares: {},
  distinctGrantees: 0,
  totalGrants: 0,
  yearsCovered: [],
};

/** Nearest-rank percentile. No interpolation: grant amounts are real observed values, and a
 *  median of $10,000 is a statement about a grant that was actually made. */
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

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

export const computeFunderSignals = (grants: readonly GranteeGrant[]): FunderSignals => {
  if (grants.length === 0) return EMPTY;

  const years = [...new Set(grants.map((g) => g.taxYear))].sort((a, b) => a - b);
  const granteesByYear = new Map<number, Set<string>>();
  for (const g of grants) {
    const set = granteesByYear.get(g.taxYear) ?? new Set<string>();
    set.add(g.granteeKey);
    granteesByYear.set(g.taxYear, set);
  }

  const turnoverByYear: number[] = [];
  const newCountByYear: number[] = [];
  const newShareByYear: number[] = [];
  for (let i = 1; i < years.length; i += 1) {
    const current = granteesByYear.get(years[i]!)!;
    const previous = granteesByYear.get(years[i - 1]!)!;
    // Turnover is departures -- last year's grantees who are gone this year. The new-grantee
    // rate is arrivals. They are different questions: a foundation can add five newcomers
    // while keeping everyone it had, and one that drops half its list has a seat free.
    const departed = [...previous].filter((key) => !current.has(key)).length;
    const fresh = [...current].filter((key) => !previous.has(key)).length;
    turnoverByYear.push(departed / previous.size);
    newCountByYear.push(fresh);
    newShareByYear.push(fresh / current.size);
  }

  // A grantee's first year on file. Used for the first-time ask, which is the number that
  // matters to an organisation that has never been funded by this foundation.
  const firstYearOf = new Map<string, number>();
  for (const g of grants) {
    const seen = firstYearOf.get(g.granteeKey);
    if (seen === undefined || g.taxYear < seen) firstYearOf.set(g.granteeKey, g.taxYear);
  }
  // A grantee whose first year on file is the first year of the corpus may have been funded
  // for a decade before it -- its earliest observed grant is not necessarily a first grant.
  // Where genuinely new grantees exist, use only those.
  const observedFirstGrants = grants
    .filter((g) => firstYearOf.get(g.granteeKey) === g.taxYear)
    .map((g) => g.amountCents);
  const uncensoredFirstGrants = grants
    .filter((g) => firstYearOf.get(g.granteeKey) === g.taxYear && g.taxYear !== years[0])
    .map((g) => g.amountCents);
  const firstGrantAmounts = (
    uncensoredFirstGrants.length > 0 ? uncensoredFirstGrants : observedFirstGrants
  ).sort((a, b) => a - b);

  const amounts = grants.map((g) => g.amountCents).sort((a, b) => a - b);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const byGrantee = new Map<string, number>();
  for (const g of grants) byGrantee.set(g.granteeKey, (byGrantee.get(g.granteeKey) ?? 0) + g.amountCents);
  const concentration =
    total === 0 ? null : [...byGrantee.values()].reduce((sum, amount) => sum + (amount / total) ** 2, 0);

  const stateCounts = new Map<string, number>();
  for (const g of grants) {
    if (g.granteeState === null) continue;
    stateCounts.set(g.granteeState, (stateCounts.get(g.granteeState) ?? 0) + 1);
  }
  const stateShares = Object.fromEntries(
    [...stateCounts].map(([state, count]) => [state, count / grants.length]),
  );

  return {
    turnover: mean(turnoverByYear),
    newGranteesPerYear: mean(newCountByYear),
    newGranteeShare: mean(newShareByYear),
    concentration,
    askP50: percentile(amounts, 0.5),
    askP90: percentile(amounts, 0.9),
    firstTimeAskP50: percentile(firstGrantAmounts, 0.5),
    retentionYearsP50: percentile(longestRuns(grants), 0.5),
    stateShares,
    distinctGrantees: byGrantee.size,
    totalGrants: grants.length,
    yearsCovered: years,
  };
};

/** Longest run of consecutive years each grantee was funded. */
const longestRuns = (grants: readonly GranteeGrant[]): readonly number[] => {
  const yearsByGrantee = new Map<string, Set<number>>();
  for (const g of grants) {
    const set = yearsByGrantee.get(g.granteeKey) ?? new Set<number>();
    set.add(g.taxYear);
    yearsByGrantee.set(g.granteeKey, set);
  }

  const runs: number[] = [];
  for (const years of yearsByGrantee.values()) {
    const sorted = [...years].sort((a, b) => a - b);
    let longest = 1;
    let current = 1;
    for (let i = 1; i < sorted.length; i += 1) {
      current = sorted[i]! === sorted[i - 1]! + 1 ? current + 1 : 1;
      longest = Math.max(longest, current);
    }
    runs.push(longest);
  }
  return runs.sort((a, b) => a - b);
};
