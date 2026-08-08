/**
 * S5: who actually wins money under a federal program, computed from award history.
 *
 * The product rule that shapes every line of this file: **there is no denominator.** USASpending
 * records awards, and an award is a winner. Nobody publishes how many organisations applied and
 * lost, so no honest probability of winning can be computed from this data — not by us, not by
 * anyone. What can be computed is a *base rate*: how much money, how many awards, to how many
 * distinct organisations, how concentrated, and moving which way.
 *
 * That distinction is not pedantry. "12% win rate" and "roughly seven awards a cycle, five of
 * them to organisations that had won before" are different claims, and only the second one is
 * supported. The type below carries its own caveat text so the number cannot reach a screen
 * without it.
 */

/** One federal award, reduced to what positioning decides with. Money is integer cents. */
export interface FederalAward {
  readonly awardId: string;
  readonly recipientName: string;
  /** Stable per recipient, so repeat winners can be counted without matching on name. */
  readonly recipientKey: string;
  readonly amountCents: number;
  /** ISO `YYYY-MM-DD`, or null when the feed states none. */
  readonly startDate: string | null;
  /** The assistance listing this award is displayed under, which is not always the one asked
   *  for: an award funded under several listings shows one of them. See `AwardCoverage`. */
  readonly programNumber: string;
  readonly awardingAgency: string;
}

export interface AwardSizeBand {
  readonly label: string;
  readonly count: number;
  /** Of all awards in the cohort, 0-1. */
  readonly share: number;
}

export interface AwardCycle {
  readonly year: number;
  readonly awardCount: number;
  readonly totalCents: number;
  readonly medianCents: number;
}

export type AwardTrend = 'rising' | 'falling' | 'steady' | 'not_enough_cycles';

/**
 * The competitive base rate, and what it is not.
 *
 * `caveat` is not documentation. It is the sentence the UI is required to render beside the
 * number, and it lives on the value so that rendering the number without it takes deliberate
 * effort rather than forgetfulness.
 */
export interface CompetitiveBaseRate {
  /** Awards made in a typical cycle, from the years on file. */
  readonly awardsPerCycle: number;
  /** Distinct organisations winning in a typical cycle. Lower than `awardsPerCycle` when one
   *  organisation takes several awards. */
  readonly winnersPerCycle: number;
  /** What the announcement itself says it expects to award, when it says. Comparing the two is
   *  the most useful thing on the page: an announcement promising 7 awards on a program that has
   *  made 3 a year for a decade is describing an unusually good year, or an optimistic one. */
  readonly announcementExpectsAwards: number | null;
  readonly comparison: string | null;
  /** Always rendered beside the figures. Never omitted, never abbreviated. */
  readonly caveat: string;
}

/**
 * How much of the cohort is really the program asked about.
 *
 * USASpending's program filter returns awards *associated* with an assistance listing, and an
 * award funded under several listings displays only one. Probing 93.647 returned 94 awards
 * displaying 93.647 and 6 displaying something else. Those six are not errors and are not
 * dropped — the API is the authority on which program an award belongs to — but the count is
 * reported, because a cohort that quietly mixes programs is a cohort nobody can check.
 */
export interface AwardCoverage {
  readonly awardsConsidered: number;
  readonly awardsUnderExactProgram: number;
  readonly cyclesOnFile: number;
  readonly statement: string;
}

export interface WinnerCohort {
  readonly programNumber: string;
  readonly awardCount: number;
  readonly recipientCount: number;
  readonly medianAwardCents: number | null;
  readonly smallestAwardCents: number | null;
  readonly largestAwardCents: number | null;
  readonly sizeBands: readonly AwardSizeBand[];
  /** Median award against the announcement's stated ceiling, when it states one. */
  readonly medianVsCeiling: string | null;
  readonly cycles: readonly AwardCycle[];
  readonly trend: AwardTrend;
  readonly trendStatement: string;
  /**
   * Share of awards going to organisations that won more than once, 0-1. The single most
   * decision-relevant number here: a program where 80% of awards go to repeat winners is a
   * program with incumbents, and a first-time applicant should know that before spending three
   * weeks on it.
   */
  readonly repeatWinnerShare: number;
  readonly repeatStatement: string;
  readonly baseRate: CompetitiveBaseRate;
  readonly coverage: AwardCoverage;
}

/** The wording used everywhere a base rate is stated. One string, so it cannot drift. */
export const NO_DENOMINATOR_CAVEAT =
  // The banned phrases are banned on the screen too, including in the sentence that disowns them:
  // a reader skimming for "chance of winning" finds it here and stops before the "not".
  'This is a competitive base rate. Federal data records who received an award and ' +
  'never records who applied, so the number of unsuccessful applicants is unknown and no ' +
  'probability of success can be calculated from it — by Merit or by anyone else.';

/** Fewer cycles than this and a direction of travel is noise with a label on it. */
const MIN_CYCLES_FOR_TREND = 3;

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
};

const dollars = (cents: number): string => {
  const whole = Math.round(cents / 100);
  return `$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}`;
};

/** Bands chosen to be readable rather than statistically clever: a development director asks
 *  "is this a $50k program or a $5m one", and these are the answers to that question. */
const BAND_EDGES = [
  { label: 'under $50k', max: 50_000_00 },
  { label: '$50k – $250k', max: 250_000_00 },
  { label: '$250k – $1m', max: 1_000_000_00 },
  { label: '$1m – $5m', max: 5_000_000_00 },
  { label: 'over $5m', max: Number.POSITIVE_INFINITY },
] as const;

const sizeBandsOf = (amounts: readonly number[]): readonly AwardSizeBand[] => {
  if (amounts.length === 0) return [];
  return BAND_EDGES.map((band, index) => {
    const floor = index === 0 ? Number.NEGATIVE_INFINITY : (BAND_EDGES[index - 1]?.max ?? 0);
    const count = amounts.filter((amount) => amount > floor && amount <= band.max).length;
    return { label: band.label, count, share: count / amounts.length };
  }).filter((band) => band.count > 0);
};

const yearOf = (award: FederalAward): number | null => {
  const parts = /^(\d{4})-\d{2}-\d{2}$/.exec(award.startDate ?? '');
  return parts === null ? null : Number(parts[1]);
};

/**
 * The direction of travel, over complete cycles only.
 *
 * Compares the mean award count of the earlier half of the cycles against the later half, which
 * is cruder than a regression and much harder to misread. A program going 4, 5, 3, 9, 11, 10 is
 * rising; the same numbers shuffled are not, and neither reading survives fewer than three
 * cycles, which is why that case has its own answer rather than a defaulted one.
 */
const trendOf = (cycles: readonly AwardCycle[]): AwardTrend => {
  if (cycles.length < MIN_CYCLES_FOR_TREND) return 'not_enough_cycles';

  const half = Math.floor(cycles.length / 2);
  const earlier = cycles.slice(0, half);
  const later = cycles.slice(cycles.length - half);
  const mean = (list: readonly AwardCycle[]): number =>
    list.reduce((sum, cycle) => sum + cycle.awardCount, 0) / list.length;

  const before = mean(earlier);
  const after = mean(later);
  if (before === 0) return after > 0 ? 'rising' : 'steady';

  const change = (after - before) / before;
  // A fifth either way. Below that, a program that made 5 awards and then 4 is not "falling".
  if (change > 0.2) return 'rising';
  if (change < -0.2) return 'falling';
  return 'steady';
};

export interface WinnerCohortInput {
  readonly programNumber: string;
  readonly awards: readonly FederalAward[];
  /** The announcement's own ceiling and expected award count, when stated. */
  readonly awardCeilingCents: number | null;
  readonly announcementExpectsAwards: number | null;
}

/**
 * The winner cohort for one federal program.
 *
 * Everything here is arithmetic over rows the user can open — no model, no judgement, and
 * deliberately so: this is the section a development director quotes to a board, and every
 * figure on it has to be reproducible from the award table printed underneath it.
 */
export const computeWinnerCohort = (input: WinnerCohortInput): WinnerCohort => {
  const { awards, programNumber } = input;

  const amounts = awards.map((award) => award.amountCents);
  const medianAward = median(amounts);

  const byRecipient = new Map<string, number>();
  for (const award of awards) {
    byRecipient.set(award.recipientKey, (byRecipient.get(award.recipientKey) ?? 0) + 1);
  }
  const repeatWinnerAwards = [...byRecipient.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);
  const repeatWinnerShare = awards.length === 0 ? 0 : repeatWinnerAwards / awards.length;

  const byYear = new Map<number, FederalAward[]>();
  for (const award of awards) {
    const year = yearOf(award);
    if (year === null) continue;
    byYear.set(year, [...(byYear.get(year) ?? []), award]);
  }
  const cycles: readonly AwardCycle[] = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, yearAwards]) => ({
      year,
      awardCount: yearAwards.length,
      totalCents: yearAwards.reduce((sum, award) => sum + award.amountCents, 0),
      medianCents: median(yearAwards.map((award) => award.amountCents)) ?? 0,
    }));

  const trend = trendOf(cycles);
  const awardsPerCycle =
    cycles.length === 0
      ? 0
      : Math.round(cycles.reduce((sum, cycle) => sum + cycle.awardCount, 0) / cycles.length);
  const winnersPerCycle =
    cycles.length === 0
      ? 0
      : Math.round(
          [...byYear.values()].reduce(
            (sum, yearAwards) => sum + new Set(yearAwards.map((award) => award.recipientKey)).size,
            0,
          ) / cycles.length,
        );

  const exact = awards.filter((award) => award.programNumber === programNumber).length;

  return {
    programNumber,
    awardCount: awards.length,
    recipientCount: byRecipient.size,
    medianAwardCents: medianAward,
    smallestAwardCents: amounts.length === 0 ? null : Math.min(...amounts),
    largestAwardCents: amounts.length === 0 ? null : Math.max(...amounts),
    sizeBands: sizeBandsOf(amounts),
    medianVsCeiling: medianVsCeilingOf(medianAward, input.awardCeilingCents),
    cycles,
    trend,
    trendStatement: trendStatementOf(trend, cycles),
    repeatWinnerShare,
    repeatStatement: repeatStatementOf(repeatWinnerShare, byRecipient.size, awards.length),
    baseRate: {
      awardsPerCycle,
      winnersPerCycle,
      announcementExpectsAwards: input.announcementExpectsAwards,
      comparison: comparisonOf(awardsPerCycle, input.announcementExpectsAwards, cycles.length),
      caveat: NO_DENOMINATOR_CAVEAT,
    },
    coverage: {
      awardsConsidered: awards.length,
      awardsUnderExactProgram: exact,
      cyclesOnFile: cycles.length,
      statement: coverageStatementOf(awards.length, exact, cycles.length, programNumber),
    },
  };
};

const medianVsCeilingOf = (medianAward: number | null, ceiling: number | null): string | null => {
  if (medianAward === null || ceiling === null || ceiling === 0) return null;
  const share = Math.round((medianAward / ceiling) * 100);
  return (
    `The median award actually made is ${dollars(medianAward)}, which is ${share}% of the ` +
    `${dollars(ceiling)} ceiling this announcement states. Asking for the ceiling is asking for ` +
    'more than this program typically gives.'
  );
};

const trendStatementOf = (trend: AwardTrend, cycles: readonly AwardCycle[]): string => {
  if (trend === 'not_enough_cycles') {
    return cycles.length === 0
      ? 'No award years are on file, so there is no trend to report.'
      : `Only ${cycles.length} award ${cycles.length === 1 ? 'year is' : 'years are'} on file, which is too few to call a direction.`;
  }
  const first = cycles[0]?.year;
  const last = cycles[cycles.length - 1]?.year;
  const span = `across ${cycles.length} years on file (${first}–${last})`;
  if (trend === 'rising') return `The number of awards made each year is rising ${span}.`;
  if (trend === 'falling') {
    return `The number of awards made each year is falling ${span}. A shrinking program is a harder program.`;
  }
  return `The number of awards made each year is steady ${span}.`;
};

const repeatStatementOf = (share: number, recipients: number, awards: number): string => {
  if (awards === 0) return 'No awards are on file, so repeat winners cannot be counted.';
  const percent = Math.round(share * 100);
  if (percent === 0) {
    return `All ${awards} awards on file went to different organisations. No organisation has won twice.`;
  }
  return (
    `${percent}% of awards went to organisations that have won more than once — ${recipients} ` +
    `distinct organisations across ${awards} awards. ` +
    (percent >= 50
      ? 'This program has incumbents, which a first-time applicant should weigh before committing weeks to it.'
      : 'Most winners appear once, so incumbency is not the dominant pattern here.')
  );
};

const comparisonOf = (awardsPerCycle: number, expected: number | null, cycleCount: number): string | null => {
  if (expected === null || cycleCount === 0) return null;
  if (expected > awardsPerCycle * 1.5) {
    return (
      `This announcement expects to make ${expected} awards, against ${awardsPerCycle} in a ` +
      'typical year on file. Either it is an unusually large round, or the expectation is optimistic.'
    );
  }
  if (expected * 1.5 < awardsPerCycle) {
    return (
      `This announcement expects to make ${expected} awards, against ${awardsPerCycle} in a ` +
      'typical year on file. This round is smaller than the program’s own history.'
    );
  }
  return `This announcement expects ${expected} awards, which is in line with the ${awardsPerCycle} made in a typical year.`;
};

const coverageStatementOf = (
  considered: number,
  exact: number,
  cycles: number,
  programNumber: string,
): string => {
  if (considered === 0) {
    return `No awards are on file for program ${programNumber}. That is a gap in the record, not evidence that none were made.`;
  }
  const base = `${considered} awards across ${cycles} ${cycles === 1 ? 'year' : 'years'} on file for program ${programNumber}.`;
  if (exact === considered) return base;
  return (
    `${base} ${considered - exact} of them are recorded under a different primary assistance ` +
    'listing: a single award can be funded under several, and federal data displays one. They ' +
    'are kept, because the program filter is what associates them.'
  );
};
