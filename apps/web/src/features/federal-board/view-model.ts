import { isHighFit } from '@merit/domain';
import type { FederalBoard, RunLog, ScreenedOpportunity } from '@merit/application';

/**
 * Everything the federal board renders, formatted once and unit-tested.
 *
 * The JSX below this file contains no arithmetic, no bucketing, and no conditional label logic.
 * Two product rules are enforced here rather than hoped for: a fit score never renders without
 * its matched program areas and gaps, and a screened-out opportunity renders no score at all.
 */

export interface FitView {
  readonly score: string;
  readonly isHighFit: boolean;
  readonly rationale: string;
  readonly matchedProgramAreas: readonly string[];
  readonly matchedEmptyReason: string | null;
  readonly gaps: readonly string[];
  readonly gapsEmptyReason: string | null;
}

export interface OpportunityRowView {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly agency: string;
  readonly programNumber: string;
  readonly closes: string;
  readonly awardRange: string;
  readonly expectedAwards: string;
  /** Null on anything screened out or not yet scored -- never a zero standing in for a score. */
  readonly fit: FitView | null;
  readonly notScoredReason: string | null;
  readonly rejections: readonly string[];
  readonly unresolved: readonly string[];
}

export interface RunLogView {
  readonly lines: readonly string[];
}

export interface FederalBoardView {
  readonly organizationName: string;
  readonly backHref: string;
  readonly coverage: string;
  readonly scoreCaveat: string;
  readonly rows: readonly OpportunityRowView[];
  readonly emptyReason: string | null;
  readonly runLog: RunLogView;
}

const count = (value: number): string => value.toLocaleString('en-US');

const money = (cents: number | null): string =>
  cents === null ? 'not stated' : `$${Math.round(cents / 100).toLocaleString('en-US')}`;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** ISO in, "24 August 2026" out. Formatted by hand: `toLocaleDateString` follows the server's
 *  locale, and a deadline that renders differently per machine is a deadline nobody trusts. */
const day = (iso: string | null): string => {
  if (iso === null) return 'no deadline stated';
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (parts === null) return iso;
  return `${Number(parts[3])} ${MONTHS[Number(parts[2]) - 1] ?? parts[2]} ${parts[1]}`;
};

const plural = (value: number, one: string, many: string): string =>
  `${count(value)} ${value === 1 ? one : many}`;

const fitView = (row: ScreenedOpportunity): FitView | null => {
  if (row.fit === null) return null;

  return {
    score: `${row.fit.fitScore}/100`,
    isHighFit: isHighFit(row.fit.fitScore),
    rationale: row.fit.rationale,
    matchedProgramAreas: row.fit.matchedProgramAreas,
    matchedEmptyReason:
      row.fit.matchedProgramAreas.length > 0
        ? null
        : 'This announcement matched no program area this organisation works in.',
    gaps: row.fit.gaps,
    gapsEmptyReason:
      row.fit.gaps.length > 0
        ? null
        : 'No gaps were identified against this announcement, which is a claim rather than a guarantee.',
  };
};

const rowView = (row: ScreenedOpportunity): OpportunityRowView => ({
  id: row.opportunity.id,
  number: row.opportunity.number,
  title: row.opportunity.title,
  agency: row.opportunity.agency,
  programNumber: row.opportunity.programNumbers[0] ?? 'not stated',
  closes: day(row.opportunity.closeDate),
  awardRange:
    row.opportunity.awardFloorCents === null && row.opportunity.awardCeilingCents === null
      ? 'not stated'
      : `${money(row.opportunity.awardFloorCents)} – ${money(row.opportunity.awardCeilingCents)}`,
  expectedAwards:
    row.opportunity.expectedAwardCount === null
      ? 'not stated'
      : plural(row.opportunity.expectedAwardCount, 'award expected', 'awards expected'),
  fit: fitView(row),
  notScoredReason: row.fit === null && row.fitState === 'queued' ? row.fitStateReason : null,
  rejections: row.screening.rejections.map((check) => check.reason),
  unresolved: row.screening.unresolved.map((check) => check.reason),
});

const runLogView = (log: RunLog): RunLogView => {
  const lines: string[] = [];

  lines.push(
    log.sweep === null
      ? 'No federal sweep has run yet, so this board shows only what is already stored.'
      : `Last sweep read ${plural(log.sweep.hitsSeen, 'opportunity', 'opportunities')} across ` +
          `${plural(log.sweep.searchesRun, 'search', 'searches')}: ` +
          `${count(log.sweep.opportunitiesInserted)} new, ` +
          `${count(log.sweep.opportunitiesUpdated)} updated, ` +
          `${plural(log.sweep.parseFaults, 'parse fault', 'parse faults')}.`,
  );

  lines.push(
    `Model spend since the last day: ${plural(log.spend.calls, 'call', 'calls')}, of which ` +
      `${count(log.spend.cacheHits)} cache hits, ` +
      `${count(log.spend.promptTokens + log.spend.responseTokens)} tokens, ` +
      `${plural(log.spend.repairs, 'repair', 'repairs')}, ` +
      `${plural(log.spend.failures, 'failure', 'failures')}.`,
  );

  return { lines };
};

export const toFederalBoardView = (board: FederalBoard, log: RunLog): FederalBoardView => {
  const { coverage } = board;

  return {
    organizationName: board.organization.name,
    backHref: `/organizations/${board.organization.id}`,
    coverage:
      `${plural(coverage.opportunitiesConsidered, 'open federal opportunity', 'open federal opportunities')} ` +
      `screened: ${count(coverage.eligible)} eligible, ` +
      `${count(coverage.undecided)} undecided, ` +
      `${count(coverage.screenedOut)} screened out. ` +
      `${count(coverage.scored)} scored for fit, ${count(coverage.queued)} not scored yet.`,
    scoreCaveat:
      'A fit score says how closely an announcement matches what this organisation already does. ' +
      'It is not a prediction of whether an application would succeed: public data records who ' +
      'won, never who applied, so there is no denominator to compute one from.',
    rows: board.rows.map(rowView),
    emptyReason:
      board.rows.length > 0
        ? null
        : 'No federal opportunities have been swept into the graph yet. The daily sweep brings ' +
          'them in; until it has run, this board has nothing to screen.',
    runLog: runLogView(log),
  };
};
