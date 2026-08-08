import type { FunderReachabilityReport } from '@merit/application';
import type { AskCalibration, BriefClaim, Citation, FinancialTrend } from '@merit/domain';

/**
 * Everything the reachability report renders, formatted once and unit-tested.
 *
 * The JSX below this file contains no arithmetic, no bucketing, and no conditional label
 * logic: if a sentence changes depending on the data, it is decided here.
 */

export interface YearRowView {
  readonly year: string;
  readonly grantees: string;
  readonly newGrantees: string;
  readonly departed: string;
  readonly turnover: string;
  readonly total: string;
  readonly median: string;
  readonly granteeNames: readonly string[];
}

export interface BarView {
  readonly label: string;
  readonly value: string;
  /** 0–100, for the bar width. */
  readonly percent: number;
}

export interface AskDistributionView {
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly buckets: readonly BarView[];
  readonly sample: string;
}

export interface CalibrationView {
  readonly recommended: string;
  readonly range: string | null;
  readonly basis: string;
  readonly caveat: string | null;
}

export interface AffinityPathView {
  readonly grantee: string;
  readonly location: string;
  readonly strengthPercent: number;
  readonly via: readonly string[];
}

export interface AffinityView {
  readonly label: string;
  readonly disclaimer: string;
  readonly summary: string;
  readonly paths: readonly AffinityPathView[];
  readonly emptyReason: string | null;
}

export interface FinancialYearRowView {
  readonly year: string;
  readonly form: string;
  readonly revenue: string;
  readonly expenses: string;
  readonly assets: string;
  readonly grantsPaid: string;
}

export interface FinancialTrendView {
  readonly summary: string;
  readonly payout: string;
  readonly rows: readonly FinancialYearRowView[];
  readonly note: string | null;
}

export interface BriefClaimView {
  readonly id: string;
  readonly statement: string;
  readonly citations: readonly string[];
}

export interface FunderReportView {
  readonly funderName: string;
  readonly funderLocation: string;
  readonly organizationName: string;
  readonly backHref: string;
  readonly coverage: string;
  readonly yearRows: readonly YearRowView[];
  readonly yearsEmptyReason: string | null;
  readonly askDistribution: AskDistributionView;
  readonly geography: readonly BarView[];
  readonly geographyNote: string | null;
  readonly programMix: readonly BarView[];
  readonly programMixNote: string | null;
  readonly calibration: CalibrationView;
  readonly affinity: AffinityView;
  /** Null when ProPublica could not be read; `financialsUnavailable` then explains. */
  readonly financials: FinancialTrendView | null;
  readonly financialsUnavailable: string | null;
  readonly claims: readonly BriefClaimView[];
  readonly limitations: readonly string[];
}

const money = (cents: number | null): string =>
  cents === null ? 'not stated' : `$${Math.round(cents / 100).toLocaleString('en-US')}`;

const count = (value: number): string => value.toLocaleString('en-US');

const percentOf = (fraction: number | null): string =>
  fraction === null ? 'not enough filings' : `${Math.round(fraction * 100)}%`;

const FORM_LABELS: Readonly<Record<string, string>> = {
  form_990: 'Form 990',
  form_990_ez: 'Form 990-EZ',
  form_990_pf: 'Form 990-PF',
};

const BASIS_LABELS: Readonly<Record<AskCalibration['basis'], string>> = {
  first_grants_in_size_band: 'first grants this funder made to organisations of a comparable size',
  first_grants_any_size: 'first grants to organisations of any size',
  all_grants: 'grants on file, including renewals to organisations already inside',
  no_evidence: 'no grants on file',
};

/** A citation is rendered as the source a reader could go and check, never as a bare id. */
const renderCitation = (citation: Citation): string => {
  if (citation.kind === 'registry') return 'IRS Business Master File';
  if (citation.kind === 'propublica') {
    return citation.taxYears.length === 0
      ? 'ProPublica Nonprofit Explorer'
      : `ProPublica Nonprofit Explorer, ${citation.taxYears[0]}–${citation.taxYears[citation.taxYears.length - 1]}`;
  }

  const years =
    citation.taxYears.length === 0
      ? ''
      : citation.taxYears.length === 1
        ? ` ${citation.taxYears[0]}`
        : ` ${citation.taxYears[0]}–${citation.taxYears[citation.taxYears.length - 1]}`;
  // Long lists are truncated with the count kept, so the citation never implies it names
  // every filing when it names three of forty.
  const shown = citation.irsObjectIds.slice(0, 3).join(', ');
  const rest = citation.irsObjectIds.length > 3 ? ` and ${citation.irsObjectIds.length - 3} more` : '';
  return `IRS filings${years} — object ${shown}${rest}`;
};

const claimView = (claim: BriefClaim): BriefClaimView => ({
  id: claim.id,
  statement: claim.statement,
  citations: claim.citations.map(renderCitation),
});

const calibrationView = (calibration: AskCalibration): CalibrationView => {
  if (calibration.recommendedCents === null) {
    return {
      recommended: 'not enough evidence',
      range: null,
      basis: 'This funder has no grants on file, so no ask can be calibrated from its history.',
      caveat: null,
    };
  }

  const caveat = calibration.wasRaisedToFloor
    ? 'This funder’s typical first grant is below the amount at which an application is worth ' +
      'writing for an organisation your size, so the figure shown is that floor rather than its median.'
    : calibration.wasCappedAtRevenue
      ? 'This funder’s typical first grant exceeds your annual revenue, so the figure shown is ' +
        'capped at what you raise in a year rather than what it typically gives.'
      : null;

  return {
    recommended: money(calibration.recommendedCents),
    range:
      calibration.lowCents === null || calibration.highCents === null
        ? null
        : `${money(calibration.lowCents)} – ${money(calibration.highCents)}`,
    basis: `Calculated from ${count(calibration.sampleSize)} ${BASIS_LABELS[calibration.basis]}.`,
    caveat,
  };
};

const financialsView = (trend: FinancialTrend): FinancialTrendView => {
  const direction =
    trend.grantsPaid.direction === 'unknown'
      ? 'Its reported grantmaking cannot be read as a trend from the filings available.'
      : `Its reported grantmaking has been ${trend.grantsPaid.direction} between ` +
        `${trend.grantsPaid.fromYear} and ${trend.grantsPaid.toYear}.`;

  return {
    summary: direction,
    payout:
      trend.payoutRate === null
        ? 'Payout against assets is not stated on this funder’s return.'
        : `It paid out ${percentOf(trend.payoutRate)} of its assets in ${trend.latest?.taxYear}.`,
    rows: [...trend.years]
      .sort((a, b) => b.taxYear - a.taxYear)
      .map((year) => ({
        year: String(year.taxYear),
        form: FORM_LABELS[year.formType] ?? year.formType,
        revenue: money(year.totalRevenueCents),
        expenses: money(year.totalExpensesCents),
        assets: money(year.totalAssetsEndCents),
        grantsPaid: money(year.grantsPaidCents),
      })),
    note:
      trend.yearsWithoutGrantsPaid.length === 0
        ? null
        : `${trend.yearsWithoutGrantsPaid.join(', ')} were filed on a return that does not carry a ` +
          'grants-paid figure. Those grants are reported on Schedule I instead, not missing.',
  };
};

export const toFunderReportView = (report: FunderReachabilityReport): FunderReportView => {
  const { reachability, affinity } = report;

  const yearRows = reachability.years.map((year): YearRowView => ({
    year: String(year.taxYear),
    grantees: count(year.granteeCount),
    newGrantees: count(year.newGranteeCount),
    departed: count(year.departedGranteeCount),
    turnover: year.turnover === null ? 'no earlier year on file' : percentOf(year.turnover),
    total: money(year.totalCents),
    median: money(year.medianCents),
    granteeNames: [...year.grantees]
      .sort((a, b) => b.amountCents - a.amountCents)
      .map((grantee) => `${grantee.name} — ${money(grantee.amountCents)}${grantee.isNew ? ' (new)' : ''}`),
  }));

  const distribution = reachability.askDistribution;
  const largestBucket = Math.max(1, ...distribution.buckets.map((bucket) => bucket.grantCount));

  return {
    funderName: report.funder.name,
    funderLocation: report.funder.state ?? 'location not stated',
    organizationName: report.organization.name,
    backHref: `/organizations/${report.organization.id}/prospects`,
    coverage:
      `${count(report.coverage.granteeRowsExamined)} grant rows examined for this funder. ` +
      `Proximity was checked against ${count(report.coverage.peersFound)} comparable organisations, ` +
      `finding ${count(report.coverage.sharedFunderEdgesExamined)} shared-funder connections. ` +
      `Grants below ${money(report.coverage.materialityFloorCents)} are not material for you.`,

    yearRows,
    yearsEmptyReason:
      yearRows.length > 0
        ? null
        : 'No grants from this funder are in the corpus, so there is nothing to describe by year. ' +
          'It may not have filed electronically for the years ingested.',

    askDistribution: {
      rows: [
        { label: 'Smallest', value: money(distribution.min) },
        { label: '25th percentile', value: money(distribution.p25) },
        { label: 'Median', value: money(distribution.p50) },
        { label: '75th percentile', value: money(distribution.p75) },
        { label: '90th percentile', value: money(distribution.p90) },
        { label: 'Largest', value: money(distribution.max) },
      ],
      buckets: distribution.buckets.map((bucket) => ({
        label: bucket.label,
        value: count(bucket.grantCount),
        percent: Math.round((bucket.grantCount / largestBucket) * 100),
      })),
      sample:
        distribution.sampleSize === 0
          ? 'No grants on file.'
          : `Across ${count(distribution.sampleSize)} grants.`,
    },

    geography: reachability.geographicSpread.states.slice(0, 10).map((state) => ({
      label: state.state,
      value: `${percentOf(state.share)} (${count(state.grantCount)})`,
      percent: Math.round(state.share * 100),
    })),
    geographyNote:
      reachability.geographicSpread.unstatedGrantCount === 0
        ? null
        : `${count(reachability.geographicSpread.unstatedGrantCount)} grants carry no recipient ` +
          'state on the filing, so this is a floor rather than a complete picture.',

    programMix: reachability.programMix.slice(0, 10).map((program) => ({
      label: program.label,
      value: `${percentOf(program.share)} (${count(program.granteeCount)})`,
      percent: Math.round(program.share * 100),
    })),
    programMixNote:
      reachability.programMixUnknownGrantees === 0
        ? null
        : `${count(reachability.programMixUnknownGrantees)} grantees could not be matched to a ` +
          'program area in the registry and are not counted in these shares.',

    calibration: calibrationView(report.calibration),

    affinity: {
      label: affinity.label,
      disclaimer: affinity.disclaimer,
      summary:
        affinity.paths.length === 0
          ? 'No shared funders found.'
          : `${count(affinity.paths.length)} of this funder's grantees share a funder with ` +
            `organisations comparable to yours, across ${count(affinity.distinctIntermediaryFunders)} ` +
            `shared ${affinity.distinctIntermediaryFunders === 1 ? 'funder' : 'funders'}.`,
      paths: affinity.paths.map((path) => ({
        grantee: path.granteeName,
        location: path.granteeState ?? 'location not stated',
        strengthPercent: Math.round(path.strength * 100),
        via: path.via.map(
          (intermediary) =>
            `${intermediary.funderName} — also funds ${intermediary.peers.map((peer) => peer.name).join(', ')}`,
        ),
      })),
      emptyReason:
        affinity.paths.length > 0
          ? null
          : 'No funder in the corpus gives both to this funder’s grantees and to organisations ' +
            'comparable to yours. That is an absence of evidence in the filings ingested, not ' +
            'evidence that no connection exists.',
    },

    financials: report.financials === null ? null : financialsView(report.financials),
    financialsUnavailable:
      report.financials === null
        ? 'The financial trend could not be retrieved from ProPublica, so this report says nothing ' +
          'about whether this funder’s capacity is growing or shrinking. Everything else on this ' +
          'page comes from IRS filings and is unaffected.'
        : null,

    claims: report.brief.claims.map(claimView),
    limitations: report.brief.limitations,
  };
};
