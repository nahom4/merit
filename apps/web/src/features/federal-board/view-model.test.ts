import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Organization, screenEligibility, type FederalOpportunity } from '@merit/domain';
import type { FederalBoard, RunLog, ScreenedOpportunity } from '@merit/application';
import { toFederalBoardView } from './view-model.js';

const organization = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '581613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 656_000,
  }),
);

const opportunity = (overrides: Partial<FederalOpportunity> = {}): FederalOpportunity => ({
  id: '362839',
  number: 'HHS-2026-ACF-OCS-EAH-0027',
  title: 'Affordable Housing and Supportive Services Demonstration',
  agency: 'Administration for Children and Families - OCS',
  status: 'posted',
  openDate: '2026-07-25',
  closeDate: '2026-08-24',
  programNumbers: ['93.647'],
  programTitles: ['Social Services Research and Demonstration'],
  applicantTypeCodes: ['12'],
  eligibilityText: 'Nonprofits may apply.',
  summary: 'Support services for residents of affordable housing.',
  fundingCategories: ['Income Security and Social Services'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachments: [{ id: '344872', fileName: 'nofo.pdf', mimeType: 'application/pdf' }],
  ...overrides,
});

const screening = (federal = opportunity(), charityStatus: 'confirmed' | 'unknown' = 'confirmed') =>
  screenEligibility({
    opportunity: federal,
    organizationName: organization.name,
    organizationState: 'NC',
    charityStatus,
  });

const row = (overrides: Partial<ScreenedOpportunity> = {}): ScreenedOpportunity => ({
  opportunity: opportunity(),
  screening: screening(),
  fit: {
    fitScore: 74,
    rationale: 'The announcement funds supportive services.',
    matchedProgramAreas: ['Income Security and Social Services'],
    gaps: ['No affordable housing partner is named.'],
  },
  fitState: 'scored',
  fitStateReason: null,
  ...overrides,
});

const board = (rows: readonly ScreenedOpportunity[]): FederalBoard => ({
  organization,
  rows,
  coverage: {
    opportunitiesConsidered: rows.length,
    eligible: rows.filter((entry) => entry.screening.outcome === 'eligible').length,
    undecided: rows.filter((entry) => entry.screening.outcome === 'indeterminate').length,
    screenedOut: rows.filter((entry) => entry.screening.outcome === 'ineligible').length,
    scored: rows.filter((entry) => entry.fitState === 'scored').length,
    queued: rows.filter((entry) => entry.fitState === 'queued').length,
  },
});

const runLog: RunLog = {
  sweep: {
    id: 'sweep_1',
    startedAt: '2026-08-08T06:00:00.000Z',
    finishedAt: '2026-08-08T06:04:00.000Z',
    searchesRun: 3,
    hitsSeen: 42,
    opportunitiesInserted: 12,
    opportunitiesUpdated: 30,
    parseFaults: 1,
  },
  spend: { calls: 9, cacheHits: 4, promptTokens: 7_200, responseTokens: 900, repairs: 1, failures: 0 },
  since: '2026-08-07T12:00:00.000Z',
};

const view = (rows: readonly ScreenedOpportunity[], log: RunLog = runLog) =>
  toFederalBoardView(board(rows), log);

describe('toFederalBoardView', () => {
  it('renders a fit score with its scale, never as a bare number', () => {
    const rendered = view([row()]);

    expect(rendered.rows[0]?.fit?.score).toBe('74/100');
  });

  it('renders the matched program areas and the gaps beside the score', () => {
    const rendered = view([row()]);

    expect(rendered.rows[0]?.fit?.matchedProgramAreas).toEqual(['Income Security and Social Services']);
    expect(rendered.rows[0]?.fit?.gaps).toEqual(['No affordable housing partner is named.']);
  });

  it('says so when a scored opportunity matched no program area, rather than showing a blank', () => {
    const rendered = view([
      row({
        fit: {
          fitScore: 12,
          rationale: 'This funds hospital construction.',
          matchedProgramAreas: [],
          gaps: [],
        },
      }),
    ]);

    expect(rendered.rows[0]?.fit?.matchedEmptyReason).toContain('no program area');
    expect(rendered.rows[0]?.fit?.gapsEmptyReason).toContain('No gaps');
  });

  it('marks a high-fit opportunity as worth a look', () => {
    expect(view([row()]).rows[0]?.fit?.isHighFit).toBe(true);
    expect(
      view([
        row({
          fit: { fitScore: 30, rationale: 'Weak overlap.', matchedProgramAreas: [], gaps: [] },
        }),
      ]).rows[0]?.fit?.isHighFit,
    ).toBe(false);
  });

  it('shows no score at all on a screened-out opportunity', () => {
    const rejected = opportunity({ applicantTypeCodes: ['00'] });
    const rendered = view([
      row({
        opportunity: rejected,
        screening: screening(rejected),
        fit: null,
        fitState: 'not_applicable',
      }),
    ]);

    expect(rendered.rows[0]?.fit).toBeNull();
    expect(rendered.rows[0]?.rejections[0]).toContain('State governments');
  });

  it('states which checks could not be decided', () => {
    const rendered = view([row({ screening: screening(opportunity(), 'unknown') })]);

    expect(rendered.rows[0]?.unresolved[0]).toContain('501(c)(3)');
  });

  it('says a queued opportunity has not been scored yet, and why', () => {
    const rendered = view([
      row({ fit: null, fitState: 'queued', fitStateReason: 'Not scored yet: the quota is spent.' }),
    ]);

    expect(rendered.rows[0]?.fit).toBeNull();
    expect(rendered.rows[0]?.notScoredReason).toContain('Not scored yet');
  });

  it('formats the award range and the deadline a user has to act on', () => {
    const rendered = view([row()]);

    expect(rendered.rows[0]?.awardRange).toBe('$150,000 – $300,000');
    expect(rendered.rows[0]?.closes).toBe('24 August 2026');
  });

  it('says when an announcement states no award range rather than showing a dash', () => {
    const rendered = view([
      row({ opportunity: opportunity({ awardCeilingCents: null, awardFloorCents: null }) }),
    ]);

    expect(rendered.rows[0]?.awardRange).toBe('not stated');
  });

  it('keeps the federal program number visible', () => {
    expect(view([row()]).rows[0]?.programNumber).toBe('93.647');
  });

  it('states coverage rather than implying completeness', () => {
    const rejected = opportunity({ id: 'x', applicantTypeCodes: ['00'] });
    const rendered = view([
      row(),
      row({ opportunity: rejected, screening: screening(rejected), fit: null, fitState: 'not_applicable' }),
    ]);

    expect(rendered.coverage).toContain('2 open federal opportunities');
    expect(rendered.coverage).toContain('1 screened out');
  });

  it('reports the run in numbers: records, faults, spend, cache hits', () => {
    const rendered = view([row()]);

    expect(rendered.runLog.lines.join(' ')).toContain('42 opportunities');
    expect(rendered.runLog.lines.join(' ')).toContain('1 parse fault');
    expect(rendered.runLog.lines.join(' ')).toContain('4 cache hits');
    expect(rendered.runLog.lines.join(' ')).toContain('8,100 tokens');
  });

  it('says plainly when no sweep has run rather than printing zeroes', () => {
    const rendered = view([row()], { ...runLog, sweep: null });

    expect(rendered.runLog.lines[0]).toContain('No federal sweep has run yet');
  });

  it('explains an empty board instead of rendering nothing', () => {
    const rendered = view([]);

    expect(rendered.emptyReason).toContain('No federal opportunities');
  });

  it('never calls the fit score a probability of winning', () => {
    const rendered = view([row()]);

    expect(JSON.stringify(rendered).toLowerCase()).not.toContain('probability');
    expect(rendered.scoreCaveat).toContain('not a prediction');
  });
});
