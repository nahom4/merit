import { describe, expect, it } from 'vitest';
import { mayReachAModel, screenEligibility, type EligibilityInput } from './eligibility-screening.js';
import type { FederalOpportunity } from './federal-opportunity.js';

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
  applicantTypeCodes: ['07', '11', '01', '02', '04', '25', '12'],
  eligibilityText: 'Applications from individuals and foreign entities are not eligible.',
  summary: 'Support services for residents of affordable housing units.',
  fundingCategories: ['Income Security and Social Services'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachments: [{ id: '344872', fileName: 'nofo.pdf', mimeType: 'application/pdf' }],
  ...overrides,
});

const input = (overrides: Partial<EligibilityInput> = {}): EligibilityInput => ({
  opportunity: opportunity(),
  organizationName: 'Cape Fear Literacy Council',
  organizationState: 'NC',
  charityStatus: 'confirmed',
  ...overrides,
});

describe('screenEligibility', () => {
  it('passes an announcement that names 501(c)(3) nonprofits, for a confirmed charity', () => {
    const screening = screenEligibility(input());

    expect(screening.outcome).toBe('eligible');
    expect(screening.rejections).toEqual([]);
  });

  it('runs all four checks and gives every one of them a readable reason', () => {
    const screening = screenEligibility(input());

    expect(screening.checks.map((check) => check.rule)).toEqual([
      'applicant_type',
      'charity_status',
      'geography',
      'country',
    ]);
    expect(screening.checks.every((check) => check.reason.trim().length > 0)).toBe(true);
  });

  it('rejects an announcement open only to state governments, naming who it is for', () => {
    const screening = screenEligibility(input({ opportunity: opportunity({ applicantTypeCodes: ['00'] }) }));

    expect(screening.outcome).toBe('ineligible');
    expect(screening.rejections[0]?.rule).toBe('applicant_type');
    expect(screening.rejections[0]?.reason).toContain('State governments');
  });

  it('rejects an announcement limited to states this organisation is not in', () => {
    const screening = screenEligibility(
      input({
        opportunity: opportunity({
          eligibilityText:
            'Applicants must have capacity to serve populations within the eight Mississippi ' +
            'Delta Region States (Alabama, Arkansas, Illinois, Kentucky, Louisiana, Mississippi, ' +
            'Missouri, and Tennessee).',
        }),
      }),
    );

    expect(screening.outcome).toBe('ineligible');
    const geography = screening.rejections.find((check) => check.rule === 'geography');
    // Both sides of the comparison, in the words a user would check them in.
    expect(geography?.reason).toContain('Tennessee');
    expect(geography?.reason).toContain('North Carolina');
  });

  it('passes geography when this organisation is inside the stated states', () => {
    const screening = screenEligibility(
      input({
        organizationState: 'TN',
        opportunity: opportunity({
          eligibilityText: 'Applicants must be located in Tennessee or Mississippi.',
        }),
      }),
    );

    expect(screening.outcome).toBe('eligible');
  });

  it('rejects when the registry says this organisation does not hold 501(c)(3) status', () => {
    const screening = screenEligibility(input({ charityStatus: 'not_held' }));

    expect(screening.outcome).toBe('ineligible');
    expect(screening.rejections[0]?.code).toBe('charity_status_not_held');
  });

  it('cannot decide, rather than assuming, when the registry has no record of this EIN', () => {
    const screening = screenEligibility(input({ charityStatus: 'unknown' }));

    expect(screening.outcome).toBe('indeterminate');
    expect(screening.unresolved.map((check) => check.rule)).toEqual(['charity_status']);
  });

  it('cannot decide geography when the announcement restricts it without naming a state', () => {
    const screening = screenEligibility(
      input({
        opportunity: opportunity({
          eligibilityText:
            'Eligibility is limited to organizations located in states that have not accepted ' +
            'their Title V allotment.',
        }),
      }),
    );

    expect(screening.outcome).toBe('indeterminate');
    expect(screening.unresolved[0]?.rule).toBe('geography');
  });

  it('rejects an announcement open only to foreign organisations', () => {
    const screening = screenEligibility(
      input({
        opportunity: opportunity({
          eligibilityText: 'Only non-U.S. organizations may apply under this notice.',
        }),
      }),
    );

    expect(screening.rejections.map((check) => check.code)).toContain('foreign_applicants_only');
  });

  it('reports every failure, not just the first', () => {
    const screening = screenEligibility(
      input({
        charityStatus: 'not_held',
        opportunity: opportunity({
          applicantTypeCodes: ['00'],
          eligibilityText: 'Applicants must be located in Tennessee.',
        }),
      }),
    );

    expect(screening.rejections.map((check) => check.rule)).toEqual([
      'applicant_type',
      'charity_status',
      'geography',
    ]);
  });
});

describe('mayReachAModel', () => {
  it('refuses an opportunity this organisation cannot apply for', () => {
    const screening = screenEligibility(input({ opportunity: opportunity({ applicantTypeCodes: ['00'] }) }));

    expect(mayReachAModel(screening)).toBe(false);
  });

  it('allows an eligible opportunity through', () => {
    expect(mayReachAModel(screenEligibility(input()))).toBe(true);
  });

  it('allows an undecidable one through, because unknown is not the same as excluded', () => {
    // The alternative -- treating "we could not confirm" as a rejection -- silently hides live
    // opportunities. The unresolved check is stated on the screen instead.
    expect(mayReachAModel(screenEligibility(input({ charityStatus: 'unknown' })))).toBe(true);
  });
});
