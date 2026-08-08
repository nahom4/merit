import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { composeFunderBrief, validateBrief, type FunderBriefInput } from './funder-brief.js';
import { computeReachability, type ReachabilityGrant } from './funder-reachability.js';
import { calibrateAsk } from './ask-calibration.js';
import { buildAffinityPaths } from './affinity-path.js';
import { computeFinancialTrend } from './financial-trend.js';

const grant = (overrides: Partial<ReachabilityGrant> = {}): ReachabilityGrant => ({
  granteeKey: 'a',
  granteeName: 'Grantee A',
  granteeState: 'NC',
  granteeNteeMajorGroup: 'B',
  granteeRevenueCents: 600_000_00,
  taxYear: 2023,
  amountCents: 10_000_00,
  irsObjectId: '202403559349300010',
  purpose: null,
  ...overrides,
});

const HISTORY: readonly ReachabilityGrant[] = [
  grant({ granteeKey: 'a', taxYear: 2021, irsObjectId: 'filing-2021' }),
  grant({ granteeKey: 'b', granteeName: 'Grantee B', taxYear: 2022, irsObjectId: 'filing-2022' }),
  grant({
    granteeKey: 'c',
    granteeName: 'Grantee C',
    taxYear: 2023,
    granteeState: 'SC',
    irsObjectId: 'filing-2023',
  }),
];

const input = (overrides: Partial<FunderBriefInput> = {}): FunderBriefInput => {
  const grants = overrides.grants ?? HISTORY;
  return {
    funderEin: '561808737',
    funderName: 'Coastal Community Foundation',
    organizationName: 'Cape Fear Literacy Council',
    organizationState: 'NC',
    grants,
    reachability: computeReachability(grants),
    calibration: calibrateAsk({
      grants,
      organizationRevenueCents: 600_000_00,
      materialityFloorCents: 3_000_00,
    }),
    affinity: buildAffinityPaths([]),
    financials: null,
    ...overrides,
  };
};

describe('every claim cites its source', () => {
  it('attaches at least one citation to every claim it composes', () => {
    const brief = composeFunderBrief(input());

    expect(brief.claims.length).toBeGreaterThan(0);
    for (const claim of brief.claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
    }
  });

  it('cites the IRS object id of the filings a giving claim rests on', () => {
    const brief = composeFunderBrief(input());
    const giving = brief.claims.find((claim) => claim.topic === 'giving')!;
    const citation = giving.citations[0]!;

    expect(citation.kind).toBe('filings');
    expect(citation.kind === 'filings' && citation.irsObjectIds).toContain('filing-2023');
  });

  it('cites ProPublica, not a filing, for a claim about the financial trend', () => {
    const brief = composeFunderBrief(
      input({
        financials: computeFinancialTrend([
          {
            taxYear: 2020,
            formType: 'form_990_pf',
            totalRevenueCents: 1,
            totalExpensesCents: 1,
            totalAssetsEndCents: 100_000_00,
            grantsPaidCents: 10_000_00,
          },
          {
            taxYear: 2023,
            formType: 'form_990_pf',
            totalRevenueCents: 1,
            totalExpensesCents: 1,
            totalAssetsEndCents: 100_000_00,
            grantsPaidCents: 20_000_00,
          },
        ]),
      }),
    );

    const finances = brief.claims.find((claim) => claim.topic === 'finances')!;
    expect(finances.citations[0]?.kind).toBe('propublica');
  });

  it('makes no financial claim at all when ProPublica was unavailable', () => {
    const brief = composeFunderBrief(input({ financials: null }));

    expect(brief.claims.find((claim) => claim.topic === 'finances')).toBeUndefined();
  });
});

describe('the validator', () => {
  it('accepts a brief in which every claim is cited', () => {
    expect(isOk(validateBrief(composeFunderBrief(input())))).toBe(true);
  });

  it('rejects a claim with no citation rather than letting it render', () => {
    const brief = composeFunderBrief(input());
    const tampered = {
      ...brief,
      claims: [
        ...brief.claims,
        { id: 'invented', topic: 'giving' as const, statement: 'It is generous.', citations: [] },
      ],
    };

    const result = validateBrief(tampered);
    expect(isErr(result)).toBe(true);
    expect(isErr(result) && result.error.code).toBe('uncited_claim');
    expect(isErr(result) && result.error.context['claimId']).toBe('invented');
  });

  it('rejects a filings citation that names no filing', () => {
    const brief = composeFunderBrief(input());
    const tampered = {
      ...brief,
      claims: [
        {
          id: 'hollow',
          topic: 'giving' as const,
          statement: 'It gave a lot.',
          citations: [{ kind: 'filings' as const, funderEin: '561808737', irsObjectIds: [], taxYears: [] }],
        },
      ],
    };

    expect(isErr(validateBrief(tampered))).toBe(true);
  });
});

describe('what the claims say', () => {
  it('states the funder’s giving across the years on file', () => {
    const brief = composeFunderBrief(input());
    const giving = brief.claims.find((claim) => claim.topic === 'giving')!;

    expect(giving.statement).toContain('3 grants');
    expect(giving.statement).toContain('2021');
    expect(giving.statement).toContain('2023');
  });

  it('states where the giving goes', () => {
    const brief = composeFunderBrief(input());
    const geography = brief.claims.find((claim) => claim.topic === 'geography')!;

    expect(geography.statement).toContain('NC');
  });

  it('states the calibrated ask and the basis it was calculated on', () => {
    const brief = composeFunderBrief(input());
    const ask = brief.claims.find((claim) => claim.topic === 'ask')!;

    expect(ask.statement).toMatch(/\$[\d,]+/);
  });

  it('labels a proximity claim as shared-funder proximity', () => {
    const brief = composeFunderBrief(
      input({
        affinity: buildAffinityPaths([
          {
            granteeEin: '111111111',
            granteeName: 'Wilmington Reads',
            granteeState: 'NC',
            viaFunderEin: '999999999',
            viaFunderName: 'Another Trust',
            peerEin: '222222222',
            peerName: 'A Peer',
          },
        ]),
      }),
    );

    const proximity = brief.claims.find((claim) => claim.topic === 'proximity')!;
    expect(proximity.statement).toContain('shared-funder proximity');
  });

  it('makes no proximity claim when nothing connects', () => {
    const brief = composeFunderBrief(input({ affinity: buildAffinityPaths([]) }));

    expect(brief.claims.find((claim) => claim.topic === 'proximity')).toBeUndefined();
  });
});

describe('what the evidence does not support', () => {
  it('always states its limitations, never leaving them to be inferred', () => {
    const brief = composeFunderBrief(input());

    expect(brief.limitations.length).toBeGreaterThan(0);
    for (const limitation of brief.limitations) {
      expect(limitation.length).toBeGreaterThan(0);
    }
  });

  it('says the record is what the funder has done, not what it will do', () => {
    const brief = composeFunderBrief(input());

    expect(brief.limitations.join(' ')).toContain('does not');
  });

  it('never expresses the evidence as a chance of winning', () => {
    // Public data has no denominator: nobody publishes who applied and was declined.
    const brief = composeFunderBrief(input());
    const text = [...brief.claims.map((c) => c.statement), ...brief.limitations].join(' ').toLowerCase();

    for (const forbidden of ['probability', 'win rate', 'odds', 'likelihood of success']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('says so when the funder has only one filing year behind it', () => {
    const brief = composeFunderBrief(input({ grants: [grant({ taxYear: 2023 })] }));

    expect(brief.limitations.join(' ')).toContain('one filing year');
  });

  it('says so when the financial trend could not be retrieved', () => {
    const brief = composeFunderBrief(input({ financials: null }));

    expect(brief.limitations.join(' ')).toContain('financial');
  });

  it('says so when grantees could not be matched to the registry', () => {
    const brief = composeFunderBrief(
      input({
        grants: [
          grant({ granteeKey: 'a', taxYear: 2022, granteeNteeMajorGroup: null }),
          grant({ granteeKey: 'b', taxYear: 2023, granteeNteeMajorGroup: 'B' }),
        ],
      }),
    );

    expect(brief.limitations.join(' ')).toContain('program area');
  });

  it('says the agent will not approach the funder', () => {
    const brief = composeFunderBrief(input());

    expect(brief.limitations.join(' ')).toContain('will not contact');
  });
});

describe('claims that depend on what the evidence actually shows', () => {
  it('says plainly that nothing was given in our state when nothing was', () => {
    const brief = composeFunderBrief(
      input({
        grants: [
          grant({ granteeState: 'TX' }),
          grant({ granteeKey: 'b', taxYear: 2022, granteeState: 'TX' }),
        ],
      }),
    );
    const geography = brief.claims.find((claim) => claim.topic === 'geography')!;

    expect(geography.statement).toContain('No grant on file went to an organisation in NC');
  });

  it('quotes the range of comparable asks when the sample is large enough to have one', () => {
    const grants = [
      grant({ granteeKey: 'anchor', taxYear: 2020, amountCents: 1_00 }),
      grant({ granteeKey: 'a', taxYear: 2021, amountCents: 5_000_00 }),
      grant({ granteeKey: 'b', taxYear: 2021, amountCents: 10_000_00 }),
      grant({ granteeKey: 'c', taxYear: 2021, amountCents: 15_000_00 }),
      grant({ granteeKey: 'd', taxYear: 2021, amountCents: 20_000_00 }),
    ];
    const brief = composeFunderBrief(
      input({
        grants,
        calibration: calibrateAsk({
          grants,
          organizationRevenueCents: 600_000_00,
          materialityFloorCents: 3_000_00,
        }),
      }),
    );

    expect(brief.claims.find((claim) => claim.topic === 'ask')!.statement).toContain(
      'Comparable asks ran from',
    );
  });

  it('declines to state a direction of travel it cannot read from the filings on file', () => {
    const brief = composeFunderBrief(
      input({
        financials: computeFinancialTrend([
          {
            taxYear: 2023,
            formType: 'form_990_pf',
            totalRevenueCents: 1,
            totalExpensesCents: 1,
            totalAssetsEndCents: null,
            grantsPaidCents: null,
          },
        ]),
      }),
    );
    const finances = brief.claims.find((claim) => claim.topic === 'finances')!;

    expect(finances.statement).toContain('cannot be read from the years available');
    // No assets figure means no payout rate, and none is claimed.
    expect(finances.statement).not.toContain('paid out');
  });
});

describe('limitations that depend on the shape of the evidence', () => {
  it('says so when grants carry no recipient state', () => {
    const brief = composeFunderBrief(
      input({
        grants: [
          grant({ granteeKey: 'a', taxYear: 2022, granteeState: null }),
          grant({ granteeKey: 'b', taxYear: 2023, granteeState: 'NC' }),
        ],
      }),
    );

    expect(brief.limitations.join(' ')).toContain('no recipient state');
  });

  it('says so when the ask had to be drawn from every grant, renewals included', () => {
    // One year on file: no first grant is observable, so the sample is contaminated by renewals.
    const grants = [
      grant({ granteeKey: 'a', taxYear: 2023, amountCents: 4_000_00 }),
      grant({ granteeKey: 'b', taxYear: 2023, amountCents: 6_000_00 }),
    ];
    const brief = composeFunderBrief(
      input({
        grants,
        calibration: calibrateAsk({
          grants,
          organizationRevenueCents: 600_000_00,
          materialityFloorCents: 3_000_00,
        }),
      }),
    );

    expect(brief.limitations.join(' ')).toContain('including renewals');
  });

  it('says so when no comparable-size organisation appears among the new grantees', () => {
    const grants = [
      grant({ granteeKey: 'anchor', taxYear: 2021, granteeRevenueCents: 40_000_000_00 }),
      grant({
        granteeKey: 'giant',
        taxYear: 2022,
        amountCents: 900_000_00,
        granteeRevenueCents: 40_000_000_00,
      }),
    ];
    const brief = composeFunderBrief(
      input({
        grants,
        calibration: calibrateAsk({
          grants,
          organizationRevenueCents: 600_000_00,
          materialityFloorCents: 3_000_00,
        }),
      }),
    );

    expect(brief.limitations.join(' ')).toContain('No organisation of a comparable size');
  });
});
