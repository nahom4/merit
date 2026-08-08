import type { Prospect, ProspectListing } from '@merit/application';

export interface ScoreBarView {
  readonly label: string;
  readonly explanation: string;
  /** 0-100 for the bar width. Null when there is not enough history to say. */
  readonly percent: number | null;
  readonly value: string;
}

export interface EvidenceRowView {
  readonly name: string;
  readonly location: string;
  readonly year: string;
  readonly amount: string;
}

export interface ProspectRowView {
  readonly funderEin: string;
  readonly name: string;
  /** The S2 reachability report for this funder, in the context of this organisation. */
  readonly reportHref: string;
  readonly location: string;
  readonly isRegional: boolean;
  readonly bars: readonly ScoreBarView[];
  readonly medianGrant: string;
  readonly suggestedAsk: string;
  readonly granteeSummary: string;
  readonly evidence: readonly EvidenceRowView[];
}

export interface ProspectListView {
  readonly organizationName: string;
  readonly coverage: string;
  readonly materialityFloor: string;
  readonly emptyReason: string | null;
  readonly rows: readonly ProspectRowView[];
}

const money = (cents: number | null): string =>
  cents === null ? 'not stated' : `$${Math.round(cents / 100).toLocaleString('en-US')}`;

const percent = (value: number | null): number | null => (value === null ? null : Math.round(value * 100));

const barValue = (value: number | null): string =>
  value === null ? 'not enough filings' : `${percent(value)}%`;

/**
 * Four bars, never one number. A development director has to defend a prospect list to a
 * board, so each component says what it measures and every one is traceable to grantee rows.
 */
const barsFor = (prospect: Prospect): readonly ScoreBarView[] => [
  {
    label: 'Openness',
    explanation: 'How much of this funder’s grantee list changes from year to year.',
    percent: percent(prospect.score.openness),
    value: barValue(prospect.score.openness),
  },
  {
    label: 'Affinity',
    explanation: 'How much of its giving goes to organisations like yours.',
    percent: percent(prospect.score.affinity),
    value: barValue(prospect.score.affinity),
  },
  {
    label: 'Geography',
    explanation: 'How much of its giving stays in your state and the states around it.',
    percent: percent(prospect.score.geographyFit),
    value: barValue(prospect.score.geographyFit),
  },
  {
    label: 'Size fit',
    explanation: 'Whether its typical grant is the right size for an organisation your size.',
    percent: percent(prospect.score.sizeFit),
    value: barValue(prospect.score.sizeFit),
  },
];

const granteeSummary = (prospect: Prospect): string => {
  const peers = prospect.peerGranteeCount;
  const regional = prospect.regionalGranteeCount;
  const peerPhrase = `${peers} comparable ${peers === 1 ? 'organisation' : 'organisations'}`;
  const regionPhrase = regional === 0 ? 'none of them near you' : `${regional} of them in your region`;
  const years = prospect.signals.yearsCovered;
  const yearPhrase =
    years.length === 0
      ? 'no filing years on file'
      : years.length === 1
        ? `one filing year (${years[0]})`
        : `${years.length} filing years (${years[0]}–${years[years.length - 1]})`;
  return `Funded ${peerPhrase}, ${regionPhrase}. Based on ${yearPhrase}.`;
};

export const toProspectListView = (listing: ProspectListing): ProspectListView => {
  const rows = listing.prospects.map((prospect): ProspectRowView => ({
    funderEin: prospect.funderEin,
    name: prospect.funderName,
    reportHref: `/organizations/${listing.organization.id}/funders/${prospect.funderEin}`,
    location: prospect.funderState ?? 'location not stated',
    isRegional: prospect.regionalGranteeCount > 0,
    bars: barsFor(prospect),
    medianGrant: money(prospect.signals.askP50),
    suggestedAsk: money(prospect.signals.firstTimeAskP50),
    granteeSummary: granteeSummary(prospect),
    evidence: prospect.evidence.map((row) => ({
      name: row.name,
      location: [row.city, row.state].filter((part) => part !== null).join(', ') || 'location not stated',
      year: String(row.taxYear),
      amount: money(row.amountCents),
    })),
  }));

  return {
    organizationName: listing.organization.name,
    // Coverage is stated, never implied. Silence would suggest the list is complete.
    coverage:
      `${listing.coverage.peersFound.toLocaleString('en-US')} comparable organisations found. ` +
      `${listing.coverage.candidateFundersConsidered.toLocaleString('en-US')} funders of those ` +
      `organisations were examined, of which ${listing.coverage.credibleFunders.toLocaleString('en-US')} ` +
      `are credible and material for you.`,
    materialityFloor: money(listing.coverage.materialityFloorCents),
    emptyReason: emptyReasonFor(listing),
    rows,
  };
};

/** An empty list explains itself. A blank panel is never acceptable. */
const emptyReasonFor = (listing: ProspectListing): string | null => {
  if (listing.prospects.length > 0) return null;
  if (listing.coverage.peersFound === 0) {
    return (
      'No comparable organisations were found in this program area and size band, so there is ' +
      'no peer set to draw funders from. This usually means the corpus has not been ingested ' +
      'yet, or the program code is unusual.'
    );
  }
  if (listing.coverage.candidateFundersConsidered === 0) {
    return (
      `${listing.coverage.peersFound} comparable organisations were found, but none of them has a ` +
      'funder on file. Their funders may not have filed electronically for the years ingested.'
    );
  }
  return (
    `${listing.coverage.candidateFundersConsidered} funders were examined, but none met the ` +
    `credibility bar: two or more comparable grantees, or one in your region, with a median ` +
    `grant above ${money(listing.coverage.materialityFloorCents)}.`
  );
};
