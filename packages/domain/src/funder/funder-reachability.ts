import { NteeCode } from '../organization/ntee-code.js';

/**
 * A funder's giving, described rather than scored.
 *
 * S1 asks "is this funder worth ranking". This asks the next question a development director
 * asks once a funder is on the list: *should we bother* -- who does it actually fund, is its
 * list moving, what does a grant from it look like, and how far from home does it give.
 *
 * Every value here is arithmetic over filing rows. None of it is model output, and none of it
 * is something a foundation publishes about itself.
 */

/** One grant, with the grantee detail a report needs that a score does not. */
export interface ReachabilityGrant {
  /** A resolved entity EIN where resolution succeeded, a normalised name otherwise. */
  readonly granteeKey: string;
  readonly granteeName: string;
  readonly granteeState: string | null;
  /** First character of the grantee's NTEE code. Null when the registry has no code for it. */
  readonly granteeNteeMajorGroup: string | null;
  readonly granteeRevenueCents: number | null;
  readonly taxYear: number;
  readonly amountCents: number;
  /** The filing this row came from. Every claim in the brief cites one of these. */
  readonly irsObjectId: string;
  readonly purpose: string | null;
}

export interface YearGrantee {
  readonly granteeKey: string;
  readonly name: string;
  readonly state: string | null;
  readonly amountCents: number;
  /** Absent from the previous year on file. */
  readonly isNew: boolean;
}

export interface ReachabilityYear {
  readonly taxYear: number;
  readonly granteeCount: number;
  readonly grantCount: number;
  readonly totalCents: number;
  readonly medianCents: number | null;
  readonly newGranteeCount: number;
  readonly departedGranteeCount: number;
  /**
   * Share of the previous year's grantees absent this year. Null for the first year on file:
   * there is nothing to compare against, which is not the same as no turnover.
   */
  readonly turnover: number | null;
  readonly grantees: readonly YearGrantee[];
}

export interface AskBucket {
  readonly label: string;
  readonly lowerCents: number;
  /** Null on the open-ended top bucket. */
  readonly upperCents: number | null;
  readonly grantCount: number;
}

export interface AskDistribution {
  readonly min: number | null;
  readonly p10: number | null;
  readonly p25: number | null;
  readonly p50: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly max: number | null;
  readonly sampleSize: number;
  readonly buckets: readonly AskBucket[];
}

export interface StateShare {
  readonly state: string;
  readonly grantCount: number;
  readonly share: number;
}

export interface GeographicSpread {
  readonly states: readonly StateShare[];
  readonly distinctStates: number;
  /**
   * Grants whose recipient state the filing did not state. Counted, never dropped: excluding
   * them from the denominator would make a funder look more concentrated than the record shows.
   */
  readonly unstatedGrantCount: number;
}

export interface ProgramShare {
  readonly majorGroup: string;
  readonly label: string;
  readonly granteeCount: number;
  readonly share: number;
}

export interface FunderReachability {
  readonly years: readonly ReachabilityYear[];
  readonly askDistribution: AskDistribution;
  readonly geographicSpread: GeographicSpread;
  /** Share of grantees whose program area is known. */
  readonly programMix: readonly ProgramShare[];
  readonly programMixUnknownGrantees: number;
  readonly distinctGrantees: number;
  readonly totalGrants: number;
  readonly totalCents: number;
}

/**
 * Grant-size bands, in dollars. The boundaries are the ones a development director already
 * thinks in -- the difference between a $2,500 grant and a $250,000 one is a different
 * conversation, not a different point on a continuum -- and the lowest band sits below the
 * materiality floor so grants excluded from scoring are still visible in the shape.
 */
const BUCKET_EDGES_CENTS: readonly number[] = [
  0, 1_000_00, 5_000_00, 10_000_00, 25_000_00, 50_000_00, 100_000_00, 250_000_00,
];

const dollarsLabel = (cents: number): string =>
  cents >= 1_000_00 ? `$${Math.round(cents / 100_000)}k` : `$${Math.round(cents / 100)}`;

const bucketLabel = (lower: number, upper: number | null): string =>
  upper === null ? `${dollarsLabel(lower)}+` : `${dollarsLabel(lower)}–${dollarsLabel(upper)}`;

/** Nearest-rank percentile, matching `funder-signals`: a median grant is a grant that was
 *  actually made, so no interpolation invents an amount nobody received. */
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

const distributionOf = (grants: readonly ReachabilityGrant[]): AskDistribution => {
  const amounts = grants.map((g) => g.amountCents).sort((a, b) => a - b);

  const buckets = BUCKET_EDGES_CENTS.map((lower, index) => {
    const upper = BUCKET_EDGES_CENTS[index + 1] ?? null;
    return {
      label: bucketLabel(lower, upper),
      lowerCents: lower,
      upperCents: upper,
      grantCount: amounts.filter((amount) => amount >= lower && (upper === null || amount < upper)).length,
    };
  });

  return {
    min: amounts[0] ?? null,
    p10: percentile(amounts, 0.1),
    p25: percentile(amounts, 0.25),
    p50: percentile(amounts, 0.5),
    p75: percentile(amounts, 0.75),
    p90: percentile(amounts, 0.9),
    max: amounts[amounts.length - 1] ?? null,
    sampleSize: amounts.length,
    buckets,
  };
};

const spreadOf = (grants: readonly ReachabilityGrant[]): GeographicSpread => {
  const counts = new Map<string, number>();
  let unstated = 0;
  for (const g of grants) {
    if (g.granteeState === null) {
      unstated += 1;
      continue;
    }
    counts.set(g.granteeState, (counts.get(g.granteeState) ?? 0) + 1);
  }

  const states = [...counts.entries()]
    .map(([state, grantCount]) => ({ state, grantCount, share: grantCount / grants.length }))
    .sort((a, b) =>
      b.grantCount !== a.grantCount ? b.grantCount - a.grantCount : a.state.localeCompare(b.state),
    );

  return { states, distinctStates: states.length, unstatedGrantCount: unstated };
};

const programMixOf = (
  grants: readonly ReachabilityGrant[],
): { mix: readonly ProgramShare[]; unknown: number } => {
  // Per grantee, not per grant: a funder that gave one organisation ten grants has one
  // education grantee, not ten.
  const groupOf = new Map<string, string | null>();
  for (const g of grants) {
    const seen = groupOf.get(g.granteeKey);
    if (seen === undefined || seen === null) groupOf.set(g.granteeKey, g.granteeNteeMajorGroup);
  }

  const counts = new Map<string, number>();
  let unknown = 0;
  for (const group of groupOf.values()) {
    if (group === null) {
      unknown += 1;
      continue;
    }
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  const known = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const mix = [...counts.entries()]
    .map(([majorGroup, granteeCount]) => ({
      majorGroup,
      label: NteeCode.labelForMajorGroup(majorGroup),
      granteeCount,
      share: known === 0 ? 0 : granteeCount / known,
    }))
    .sort((a, b) =>
      b.granteeCount !== a.granteeCount
        ? b.granteeCount - a.granteeCount
        : a.majorGroup.localeCompare(b.majorGroup),
    );

  return { mix, unknown };
};

const EMPTY_YEARS: readonly ReachabilityYear[] = [];

export const computeReachability = (grants: readonly ReachabilityGrant[]): FunderReachability => {
  const { mix, unknown } = programMixOf(grants);
  const base = {
    askDistribution: distributionOf(grants),
    geographicSpread: spreadOf(grants),
    programMix: mix,
    programMixUnknownGrantees: unknown,
    distinctGrantees: new Set(grants.map((g) => g.granteeKey)).size,
    totalGrants: grants.length,
    totalCents: grants.reduce((sum, g) => sum + g.amountCents, 0),
  };

  if (grants.length === 0) return { years: EMPTY_YEARS, ...base };

  const byYear = new Map<number, ReachabilityGrant[]>();
  for (const g of grants) {
    const bucket = byYear.get(g.taxYear) ?? [];
    bucket.push(g);
    byYear.set(g.taxYear, bucket);
  }

  const orderedYears = [...byYear.keys()].sort((a, b) => a - b);
  const years: ReachabilityYear[] = [];

  for (const [index, taxYear] of orderedYears.entries()) {
    const rows = byYear.get(taxYear)!;
    // The previous year *on file*, not the previous calendar year. A funder that skipped a
    // filing year has a gap in the record, and comparing across it would invent continuity.
    const previousYear = index === 0 ? null : orderedYears[index - 1]!;
    const previous =
      previousYear === null ? null : new Set(byYear.get(previousYear)!.map((g) => g.granteeKey));

    const amountByGrantee = new Map<string, { name: string; state: string | null; amountCents: number }>();
    for (const row of rows) {
      const seen = amountByGrantee.get(row.granteeKey);
      amountByGrantee.set(row.granteeKey, {
        name: seen?.name ?? row.granteeName,
        state: seen?.state ?? row.granteeState,
        amountCents: (seen?.amountCents ?? 0) + row.amountCents,
      });
    }

    const grantees = [...amountByGrantee.entries()].map(([granteeKey, detail]) => ({
      granteeKey,
      name: detail.name,
      state: detail.state,
      amountCents: detail.amountCents,
      isNew: previous === null ? false : !previous.has(granteeKey),
    }));

    const current = new Set(amountByGrantee.keys());
    const departed = previous === null ? 0 : [...previous].filter((key) => !current.has(key)).length;
    const amounts = rows.map((row) => row.amountCents).sort((a, b) => a - b);

    years.push({
      taxYear,
      granteeCount: current.size,
      grantCount: rows.length,
      totalCents: amounts.reduce((sum, amount) => sum + amount, 0),
      medianCents: percentile(amounts, 0.5),
      newGranteeCount: grantees.filter((grantee) => grantee.isNew).length,
      departedGranteeCount: departed,
      turnover: previous === null || previous.size === 0 ? null : departed / previous.size,
      grantees,
    });
  }

  return { years, ...base };
};
