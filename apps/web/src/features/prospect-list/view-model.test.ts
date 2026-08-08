import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Organization, type FunderSignals } from '@merit/domain';
import type { Prospect, ProspectListing } from '@merit/application';
import { toProspectListView } from './view-model.js';

const capeFear = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '581613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 655_738,
  }),
);

const signals: FunderSignals = {
  turnover: 0.5,
  newGranteesPerYear: 4,
  newGranteeShare: 0.4,
  concentration: 0.2,
  askP50: 1_500_000,
  askP90: 5_000_000,
  firstTimeAskP50: 1_000_000,
  retentionYearsP50: 2,
  stateShares: { NC: 0.8, SC: 0.2 },
  distinctGrantees: 20,
  totalGrants: 40,
  yearsCovered: [2023, 2024],
};

const prospect = (overrides: Partial<Prospect> = {}): Prospect => ({
  funderEin: '561234567',
  funderName: 'THE CANNON FOUNDATION INC',
  funderState: 'NC',
  score: {
    openness: 0.62,
    affinity: 0.5,
    geographyFit: 0.92,
    sizeFit: 1,
    total: 0.7,
    isCredible: true,
    credibilityReason: 'credible',
  },
  signals,
  peerGranteeCount: 3,
  regionalGranteeCount: 2,
  evidence: [
    {
      entityEin: '561111111',
      name: 'WILMINGTON READS',
      city: 'WILMINGTON',
      state: 'NC',
      taxYear: 2024,
      amountCents: 2_500_000,
      purpose: 'ADULT LITERACY',
    },
  ],
  ...overrides,
});

const listing = (overrides: Partial<ProspectListing> = {}): ProspectListing => ({
  organization: capeFear,
  prospects: [prospect()],
  coverage: {
    peersFound: 42,
    candidateFundersConsidered: 300,
    credibleFunders: 1,
    materialityFloorCents: 327_869,
  },
  ...overrides,
});

describe('toProspectListView', () => {
  it('renders four score bars, never one number', () => {
    const view = toProspectListView(listing());
    expect(view.rows[0]?.bars.map((bar) => bar.label)).toEqual([
      'Openness',
      'Affinity',
      'Geography',
      'Size fit',
    ]);
  });

  it('never exposes a single composite score to the screen', () => {
    const view = toProspectListView(listing());
    expect(JSON.stringify(view.rows[0])).not.toContain('total');
  });

  it('converts each component to a percentage for the bar', () => {
    const view = toProspectListView(listing());
    expect(view.rows[0]?.bars[0]?.percent).toBe(62);
    expect(view.rows[0]?.bars[0]?.value).toBe('62%');
  });

  it('says a component is unknown rather than showing it as zero', () => {
    const view = toProspectListView(
      listing({ prospects: [prospect({ score: { ...prospect().score, openness: null } })] }),
    );
    expect(view.rows[0]?.bars[0]?.percent).toBeNull();
    expect(view.rows[0]?.bars[0]?.value).toBe('not enough filings');
  });

  it('explains what each component measures, in plain words', () => {
    const view = toProspectListView(listing());
    expect(view.rows[0]?.bars[0]?.explanation).toContain('changes from year to year');
  });

  it('formats the median grant and the suggested first ask as dollars', () => {
    const view = toProspectListView(listing());
    expect(view.rows[0]?.medianGrant).toBe('$15,000');
    expect(view.rows[0]?.suggestedAsk).toBe('$10,000');
  });

  it('summarises the evidence behind the row', () => {
    const view = toProspectListView(listing());
    expect(view.rows[0]?.granteeSummary).toBe(
      'Funded 3 comparable organisations, 2 of them in your region. Based on 2 filing years (2023–2024).',
    );
  });

  it('says so plainly when none of the comparable grantees is nearby', () => {
    const view = toProspectListView({
      ...listing(),
      prospects: [prospect({ regionalGranteeCount: 0 })],
    });
    expect(view.rows[0]?.granteeSummary).toContain('none of them near you');
  });

  it('exposes the grantee rows behind the score', () => {
    const view = toProspectListView(listing());
    expect(view.rows[0]?.evidence[0]).toEqual({
      name: 'WILMINGTON READS',
      location: 'WILMINGTON, NC',
      year: '2024',
      amount: '$25,000',
    });
  });

  it('states coverage rather than implying completeness', () => {
    const view = toProspectListView(listing());
    expect(view.coverage).toBe(
      '42 comparable organisations found. 300 funders of those organisations were examined, ' +
        'of which 1 are credible and material for you.',
    );
  });

  it('reports the materiality floor that excluded the small funders', () => {
    expect(toProspectListView(listing()).materialityFloor).toBe('$3,279');
  });

  it('has no empty-state reason when there are results', () => {
    expect(toProspectListView(listing()).emptyReason).toBeNull();
  });

  it('explains an empty list caused by having no peers at all', () => {
    const view = toProspectListView(
      listing({ prospects: [], coverage: { ...listing().coverage, peersFound: 0 } }),
    );
    expect(view.emptyReason).toContain('No comparable organisations were found');
  });

  it('explains an empty list caused by peers with no funders on file', () => {
    const view = toProspectListView(
      listing({ prospects: [], coverage: { ...listing().coverage, candidateFundersConsidered: 0 } }),
    );
    expect(view.emptyReason).toContain('none of them has a funder on file');
  });

  it('explains an empty list caused by the credibility bar, naming the floor', () => {
    const view = toProspectListView(listing({ prospects: [] }));
    expect(view.emptyReason).toContain('none met the credibility bar');
    expect(view.emptyReason).toContain('$3,279');
  });

  it('marks a regional funder so the list can lead with it', () => {
    expect(toProspectListView(listing()).rows[0]?.isRegional).toBe(true);
  });
});
