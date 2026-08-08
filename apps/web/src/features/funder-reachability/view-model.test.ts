import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import {
  buildAffinityPaths,
  calibrateAsk,
  composeFunderBrief,
  computeFinancialTrend,
  computeReachability,
  Organization,
  type FunderFinancialYear,
  type ReachabilityGrant,
  type SharedFunderRow,
} from '@merit/domain';
import type { FunderReachabilityReport } from '@merit/application';
import { toFunderReportView } from './view-model.js';

const ORGANIZATION = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '561808737',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 656_000,
  }),
);

const grant = (overrides: Partial<ReachabilityGrant> = {}): ReachabilityGrant => ({
  granteeKey: 'a',
  granteeName: 'Grantee A',
  granteeState: 'NC',
  granteeNteeMajorGroup: 'B',
  granteeRevenueCents: 600_000_00,
  taxYear: 2022,
  amountCents: 10_000_00,
  irsObjectId: 'obj-1',
  purpose: null,
  ...overrides,
});

const HISTORY: readonly ReachabilityGrant[] = [
  grant({ granteeKey: 'a', taxYear: 2021, amountCents: 8_000_00, irsObjectId: 'obj-2021' }),
  grant({
    granteeKey: 'b',
    granteeName: 'Grantee B',
    taxYear: 2022,
    amountCents: 12_000_00,
    irsObjectId: 'obj-2022',
  }),
  grant({ granteeKey: 'a', taxYear: 2022, amountCents: 9_000_00, irsObjectId: 'obj-2022' }),
  grant({
    granteeKey: 'c',
    granteeName: 'Grantee C',
    taxYear: 2023,
    granteeState: 'SC',
    amountCents: 20_000_00,
    irsObjectId: 'obj-2023',
  }),
];

const PATH: SharedFunderRow = {
  granteeEin: '111111111',
  granteeName: 'Wilmington Reads',
  granteeState: 'NC',
  viaFunderEin: '888888888',
  viaFunderName: 'Cape Fear Trust',
  peerEin: '222222222',
  peerName: 'A Peer',
};

const FINANCIAL_YEARS: readonly FunderFinancialYear[] = [
  {
    taxYear: 2020,
    formType: 'form_990_pf',
    totalRevenueCents: 1_000_000_00,
    totalExpensesCents: 500_000_00,
    totalAssetsEndCents: 10_000_000_00,
    grantsPaidCents: 400_000_00,
  },
  {
    taxYear: 2023,
    formType: 'form_990_pf',
    totalRevenueCents: 1_200_000_00,
    totalExpensesCents: 600_000_00,
    totalAssetsEndCents: 10_000_000_00,
    grantsPaidCents: 800_000_00,
  },
];

const report = (overrides: Partial<FunderReachabilityReport> = {}): FunderReachabilityReport => {
  const grants = overrides.reachability === undefined ? HISTORY : [];
  const reachability = overrides.reachability ?? computeReachability(grants);
  const calibration =
    overrides.calibration ??
    calibrateAsk({ grants, organizationRevenueCents: 656_000_00, materialityFloorCents: 3_280_00 });
  const affinity = overrides.affinity ?? buildAffinityPaths([PATH]);
  const financials =
    overrides.financials === undefined ? computeFinancialTrend(FINANCIAL_YEARS) : overrides.financials;

  return {
    organization: ORGANIZATION,
    funder: {
      ein: '999999999',
      name: 'Coastal Community Foundation',
      state: 'NC',
      sourceForms: '990PF',
      firstTaxYear: 2021,
      lastTaxYear: 2023,
    },
    reachability,
    calibration,
    affinity,
    financials,
    financialsError: financials === null ? 'ProPublica did not respond' : null,
    brief: composeFunderBrief({
      funderEin: '999999999',
      funderName: 'Coastal Community Foundation',
      organizationName: ORGANIZATION.name,
      organizationState: 'NC',
      grants,
      reachability,
      calibration,
      affinity,
      financials,
    }),
    coverage: {
      peersFound: 43,
      granteeRowsExamined: grants.length,
      sharedFunderEdgesExamined: 1,
      materialityFloorCents: 3_280_00,
    },
    ...overrides,
  };
};

describe('the header and coverage', () => {
  it('names the funder and links back to the prospect list it was opened from', () => {
    const view = toFunderReportView(report());

    expect(view.funderName).toBe('Coastal Community Foundation');
    expect(view.backHref).toBe('/organizations/org_1/prospects');
  });

  it('states coverage rather than implying the report is complete', () => {
    const view = toFunderReportView(report());

    expect(view.coverage).toContain('43 comparable organisations');
    expect(view.coverage).toContain('grant rows examined');
  });
});

describe('grantees by year', () => {
  it('formats one row per year with turnover, counts, and money', () => {
    const view = toFunderReportView(report());

    expect(view.yearRows.map((row) => row.year)).toEqual(['2021', '2022', '2023']);
    expect(view.yearRows[1]?.turnover).toBe('0%');
    expect(view.yearRows[1]?.total).toBe('$21,000');
  });

  it('says there is no earlier year rather than printing a turnover of zero', () => {
    // A first year has no predecessor. Rendering 0% would claim it kept everyone.
    const view = toFunderReportView(report());

    expect(view.yearRows[0]?.turnover).toBe('no earlier year on file');
  });

  it('lists the grantees behind a year, largest grant first, marking the new ones', () => {
    const view = toFunderReportView(report());

    expect(view.yearRows[1]?.granteeNames[0]).toContain('Grantee B');
    expect(view.yearRows[1]?.granteeNames[0]).toContain('(new)');
  });

  it('explains an empty history instead of rendering a blank table', () => {
    const view = toFunderReportView(report({ reachability: computeReachability([]) }));

    expect(view.yearRows).toHaveLength(0);
    expect(view.yearsEmptyReason).toContain('No grants from this funder');
  });
});

describe('ask distribution, geography, and program mix', () => {
  it('shows percentiles as money and states the sample they rest on', () => {
    const view = toFunderReportView(report());

    expect(view.askDistribution.rows.find((row) => row.label === 'Median')?.value).toBe('$10,500');
    expect(view.askDistribution.sample).toBe('Across 4 grants.');
  });

  it('scales the distribution bars against the largest bucket', () => {
    const view = toFunderReportView(report());
    const widest = Math.max(...view.askDistribution.buckets.map((bucket) => bucket.percent));

    expect(widest).toBe(100);
  });

  it('shows each state’s share of the giving', () => {
    const view = toFunderReportView(report());

    expect(view.geography[0]?.label).toBe('NC');
    expect(view.geography[0]?.value).toContain('75%');
  });

  it('names the program areas rather than the NTEE letters', () => {
    const view = toFunderReportView(report());

    expect(view.programMix[0]?.label).toBe('Education');
  });

  it('notes grantees left out of the program mix instead of implying it is complete', () => {
    const view = toFunderReportView(
      report({ reachability: computeReachability([grant({ granteeNteeMajorGroup: null })]) }),
    );

    expect(view.programMixNote).toContain('could not be matched');
  });
});

describe('ask calibration', () => {
  it('shows a recommended ask with the basis it was calculated on', () => {
    const view = toFunderReportView(report());

    expect(view.calibration.recommended).toMatch(/^\$[\d,]+$/);
    expect(view.calibration.basis).toContain('Calculated from');
  });

  it('says so when the recommendation was raised to the materiality floor', () => {
    const view = toFunderReportView(
      report({
        calibration: calibrateAsk({
          grants: [
            grant({ granteeKey: 'x', taxYear: 2021, amountCents: 100_00 }),
            grant({ granteeKey: 'y', taxYear: 2022, amountCents: 200_00 }),
          ],
          organizationRevenueCents: 656_000_00,
          materialityFloorCents: 3_280_00,
        }),
      }),
    );

    expect(view.calibration.caveat).toContain('below the amount at which an application is worth');
  });

  it('says there is not enough evidence rather than showing a number it cannot support', () => {
    const view = toFunderReportView(
      report({
        reachability: computeReachability([]),
        calibration: calibrateAsk({
          grants: [],
          organizationRevenueCents: 656_000_00,
          materialityFloorCents: 3_280_00,
        }),
      }),
    );

    expect(view.calibration.recommended).toBe('not enough evidence');
  });
});

describe('affinity paths', () => {
  it('carries the label and the denial into the view', () => {
    const view = toFunderReportView(report());

    expect(view.affinity.label).toBe('shared-funder proximity');
    expect(view.affinity.disclaimer).toContain('not a personal connection');
  });

  it('describes each path by the funder that connects it', () => {
    const view = toFunderReportView(report());

    expect(view.affinity.paths[0]?.grantee).toBe('Wilmington Reads');
    expect(view.affinity.paths[0]?.via[0]).toContain('Cape Fear Trust');
    expect(view.affinity.paths[0]?.via[0]).toContain('A Peer');
  });

  it('explains an absence of paths as an absence of evidence, not as proof of none', () => {
    const view = toFunderReportView(report({ affinity: buildAffinityPaths([]) }));

    expect(view.affinity.paths).toHaveLength(0);
    expect(view.affinity.emptyReason).toContain('not');
    expect(view.affinity.emptyReason).toContain('evidence that no connection exists');
  });
});

describe('the financial trend', () => {
  it('summarises the direction and the payout rate', () => {
    const view = toFunderReportView(report());

    expect(view.financials?.summary).toContain('rising');
    expect(view.financials?.payout).toContain('8%');
  });

  it('lists the years most recent first', () => {
    const view = toFunderReportView(report());

    expect(view.financials?.rows.map((row) => row.year)).toEqual(['2023', '2020']);
  });

  it('explains a missing trend rather than leaving a blank panel', () => {
    const view = toFunderReportView(report({ financials: null }));

    expect(view.financials).toBeNull();
    expect(view.financialsUnavailable).toContain('could not be retrieved from ProPublica');
    expect(view.financialsUnavailable).toContain('Everything else on this page comes from IRS filings');
  });

  it('says a 990 year carries no grants-paid figure rather than showing it as nothing given', () => {
    const view = toFunderReportView(
      report({
        financials: computeFinancialTrend([
          {
            taxYear: 2022,
            formType: 'form_990',
            totalRevenueCents: 1,
            totalExpensesCents: 1,
            totalAssetsEndCents: 1,
            grantsPaidCents: null,
          },
          ...FINANCIAL_YEARS,
        ]),
      }),
    );

    expect(view.financials?.note).toContain('Schedule I');
  });
});

describe('the brief', () => {
  it('renders a source beside every claim', () => {
    const view = toFunderReportView(report());

    expect(view.claims.length).toBeGreaterThan(0);
    for (const claim of view.claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
      for (const citation of claim.citations) expect(citation.length).toBeGreaterThan(0);
    }
  });

  it('renders a filing citation as a checkable source with its object ids', () => {
    const view = toFunderReportView(report());
    const giving = view.claims.find((claim) => claim.id === 'giving')!;

    expect(giving.citations[0]).toContain('IRS filings');
    expect(giving.citations[0]).toContain('obj-2021');
  });

  it('names ProPublica as the source of the financial claim', () => {
    const view = toFunderReportView(report());
    const finances = view.claims.find((claim) => claim.id === 'finances')!;

    expect(finances.citations[0]).toContain('ProPublica');
  });

  it('carries the limitations through unchanged', () => {
    const view = toFunderReportView(report());

    expect(view.limitations.length).toBeGreaterThan(0);
    expect(view.limitations.join(' ')).toContain('will not contact');
  });
});

describe('states the report cannot fill in', () => {
  it('notes grants with no recipient state rather than implying the spread is complete', () => {
    const view = toFunderReportView(
      report({
        reachability: computeReachability([
          grant({ granteeKey: 'a', granteeState: null }),
          grant({ granteeKey: 'b', granteeState: 'NC' }),
        ]),
      }),
    );

    expect(view.geographyNote).toContain('no recipient');
  });

  it('says the ask was capped at what the organisation raises in a year', () => {
    const view = toFunderReportView(
      report({
        calibration: calibrateAsk({
          grants: [
            grant({ granteeKey: 'anchor', taxYear: 2020, amountCents: 100 }),
            grant({ granteeKey: 'huge', taxYear: 2021, amountCents: 9_000_000_00 }),
          ],
          organizationRevenueCents: 656_000_00,
          materialityFloorCents: 3_280_00,
        }),
      }),
    );

    expect(view.calibration.caveat).toContain('capped at what you raise in a year');
  });

  it('says a trend cannot be read rather than inventing a direction', () => {
    const view = toFunderReportView(
      report({
        financials: computeFinancialTrend([
          {
            taxYear: 2023,
            formType: 'form_990',
            totalRevenueCents: 1,
            totalExpensesCents: 1,
            totalAssetsEndCents: null,
            grantsPaidCents: null,
          },
        ]),
      }),
    );

    expect(view.financials?.summary).toContain('cannot be read as a trend');
  });

  it('says payout is not stated rather than showing it as zero', () => {
    const view = toFunderReportView(
      report({
        financials: computeFinancialTrend([
          {
            taxYear: 2023,
            formType: 'form_990',
            totalRevenueCents: 1,
            totalExpensesCents: 1,
            totalAssetsEndCents: 1,
            grantsPaidCents: null,
          },
        ]),
      }),
    );

    expect(view.financials?.payout).toContain('not stated');
  });

  it('names the return each year was filed on', () => {
    const view = toFunderReportView(
      report({
        financials: computeFinancialTrend([
          {
            taxYear: 2023,
            formType: 'form_990_ez',
            totalRevenueCents: 1,
            totalExpensesCents: 1,
            totalAssetsEndCents: 1,
            grantsPaidCents: null,
          },
        ]),
      }),
    );

    expect(view.financials?.rows[0]?.form).toBe('Form 990-EZ');
  });

  it('renders a ProPublica citation that names no years without inventing a range', () => {
    const view = toFunderReportView(
      report({
        financials: computeFinancialTrend([]),
        brief: {
          funderName: 'Coastal Community Foundation',
          claims: [
            {
              id: 'finances',
              topic: 'finances',
              statement: 'Something about its finances.',
              citations: [{ kind: 'propublica', ein: '999999999', taxYears: [] }],
            },
          ],
          limitations: ['A limitation.'],
        },
      }),
    );

    expect(view.claims[0]?.citations[0]).toBe('ProPublica Nonprofit Explorer');
  });

  it('truncates a long filing citation while keeping the count honest', () => {
    const view = toFunderReportView(
      report({
        brief: {
          funderName: 'Coastal Community Foundation',
          claims: [
            {
              id: 'giving',
              topic: 'giving',
              statement: 'It gave a great deal.',
              citations: [
                {
                  kind: 'filings',
                  funderEin: '999999999',
                  irsObjectIds: ['a', 'b', 'c', 'd', 'e'],
                  taxYears: [2021],
                },
              ],
            },
          ],
          limitations: ['A limitation.'],
        },
      }),
    );

    expect(view.claims[0]?.citations[0]).toContain('and 2 more');
    expect(view.claims[0]?.citations[0]).toContain('IRS filings 2021');
  });

  it('renders a registry citation by name', () => {
    const view = toFunderReportView(report());
    const program = view.claims.find((claim) => claim.id === 'program')!;

    expect(program.citations).toContain('IRS Business Master File');
  });
});
