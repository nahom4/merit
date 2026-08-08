import { describe, expect, it } from 'vitest';
import { detectCountryRestriction, detectGeographicRestriction } from './geographic-restriction.js';

/** HRSA-26-045, the Delta States Rural Development Network Program, exactly as the live API
 *  returned its eligibility text. Hand-written prose would test the wording we imagined. */
const DELTA_STATES =
  'Eligible applicants include domestic public or private, non-profit or for-profit entities ' +
  'including domestic faith-based and community-based organizations, tribes and tribal ' +
  'organizations.  The applicant organization may be located in a rural or urban area and must ' +
  'have demonstrated experience serving, or capacity to serve, populations in rural areas within ' +
  'the eight Mississippi Delta Region States (Alabama, Arkansas, Illinois, Kentucky, Louisiana, ' +
  'Mississippi, Missouri, and Tennessee).  The applicant organization may not previously have ' +
  'received an award under 42 U.S.C. 254c(f) for the same or a similar project unless the entity ' +
  'is proposing to expand the scope of the project or the area that will be served through the ' +
  'project.';

/** HHS-2026-ACF-ACYF-AP-0003, PREIS. Nothing geographic in it. */
const NO_RESTRICTION =
  'Applications from collaboratives and/or consortiums must identify a primary applicant ' +
  'responsible for administering the award. A primary applicant must be named in the application.  ' +
  'Applications from individuals (including sole proprietorships) and foreign entities are not ' +
  'eligible and will be disqualified from the merit review and funding under this funding ' +
  'opportunity.';

describe('detectGeographicRestriction', () => {
  it('reads the eight states a real announcement limits itself to', () => {
    const restriction = detectGeographicRestriction(DELTA_STATES);

    expect(restriction.kind).toBe('states');
    expect(restriction.kind === 'states' ? [...restriction.states].sort() : []).toEqual([
      'AL',
      'AR',
      'IL',
      'KY',
      'LA',
      'MO',
      'MS',
      'TN',
    ]);
  });

  it('quotes the announcement’s own phrase so a user can check the call', () => {
    const restriction = detectGeographicRestriction(DELTA_STATES);

    expect(restriction.kind === 'states' ? restriction.phrase : '').toContain('Mississippi Delta Region');
  });

  it('finds no restriction in an announcement that states none', () => {
    expect(detectGeographicRestriction(NO_RESTRICTION).kind).toBe('none');
  });

  it('finds no restriction in an empty eligibility text', () => {
    expect(detectGeographicRestriction(null).kind).toBe('none');
  });

  it('says it cannot determine where, rather than guessing, when the restriction names no state', () => {
    // HHS-2026-ACF-ACYF-TS-0013's real wording: restricted by geography, to a set only the
    // agency knows. A guess here would hide a live opportunity behind a confident reason.
    const restriction = detectGeographicRestriction(
      'Eligibility is limited to local organizations and entities, including faith-based ' +
        'organizations, located in states that have not accepted their fiscal year Title V State ' +
        'SRAE allotment.',
    );

    expect(restriction.kind).toBe('indeterminate');
  });

  it('does not read an incidental state mention as a restriction', () => {
    // The agency's own address is not an eligibility rule.
    const restriction = detectGeographicRestriction(
      'Applications are reviewed by the programme office in Rockville, Maryland. Any nonprofit may apply.',
    );

    expect(restriction.kind).toBe('none');
  });

  it('reads the longer state name when two overlap', () => {
    const restriction = detectGeographicRestriction(
      'Eligibility is limited to applicants located in West Virginia.',
    );

    expect(restriction.kind === 'states' ? restriction.states : []).toEqual(['WV']);
  });

  it('reads the District of Columbia and Puerto Rico as the jurisdictions they are', () => {
    const restriction = detectGeographicRestriction(
      'Applicants must be located in the District of Columbia or in Puerto Rico.',
    );

    expect(restriction.kind === 'states' ? [...restriction.states].sort() : []).toEqual(['DC', 'PR']);
  });
});

describe('detectCountryRestriction', () => {
  it('reads a real announcement that excludes foreign entities as US-only', () => {
    expect(detectCountryRestriction(NO_RESTRICTION)).toBe('us_only');
  });

  it('reads the NIH wording that bars non-domestic entities as US-only', () => {
    // PAR-25-310, verbatim.
    expect(
      detectCountryRestriction(
        'Non-domestic (non-U.S.) Entities (Foreign Organizations) are not eligible to apply.',
      ),
    ).toBe('us_only');
  });

  it('reads an announcement open only to foreign organisations as foreign-only', () => {
    expect(detectCountryRestriction('Only non-U.S. organizations may apply under this notice.')).toBe(
      'foreign_only',
    );
  });

  it('states no country restriction when the announcement mentions none', () => {
    expect(detectCountryRestriction('Any eligible applicant may apply.')).toBe('none');
  });
});
