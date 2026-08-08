import { describe, expect, it } from 'vitest';
import { ApplicantType } from './applicant-type.js';

describe('ApplicantType.admitsCharity', () => {
  it('admits a 501(c)(3) charity when the announcement lists them explicitly', () => {
    // HHS-2026-ACF-OCS-EAH-0027, as the live API returned it.
    const admission = ApplicantType.admitsCharity(['07', '11', '01', '02', '04', '25', '12']);

    expect(admission.outcome).toBe('pass');
  });

  it('admits any applicant when the announcement is unrestricted', () => {
    expect(ApplicantType.admitsCharity(['99']).outcome).toBe('pass');
  });

  it('rejects an announcement open only to state governments, naming who it is for', () => {
    // PAR-25-003, the Animal Food Regulatory Program Standards announcement.
    const admission = ApplicantType.admitsCharity(['00']);

    expect(admission.outcome).toBe('fail');
    expect(admission.outcome === 'fail' ? admission.statedFor : []).toEqual(['State governments']);
  });

  it('rejects an announcement whose only nonprofit type excludes 501(c)(3) holders', () => {
    const admission = ApplicantType.admitsCharity(['13', '21']);

    expect(admission.outcome).toBe('fail');
    expect(admission.outcome === 'fail' ? admission.statedFor : []).toContain(
      'Nonprofits without 501(c)(3) status, other than institutions of higher education',
    );
  });

  it('cannot decide when the announcement defers eligibility to a text field', () => {
    const admission = ApplicantType.admitsCharity(['00', '25']);

    expect(admission.outcome).toBe('cannot_determine');
    expect(admission.outcome === 'cannot_determine' ? admission.why : null).toBe('defers_to_text');
  });

  it('cannot decide when no applicant type is stated at all', () => {
    const admission = ApplicantType.admitsCharity([]);

    expect(admission.outcome).toBe('cannot_determine');
    expect(admission.outcome === 'cannot_determine' ? admission.why : null).toBe('not_stated');
  });

  it('cannot decide on a code Grants.gov has added since, rather than assuming it excludes us', () => {
    const admission = ApplicantType.admitsCharity(['77']);

    expect(admission.outcome).toBe('cannot_determine');
    expect(admission.outcome === 'cannot_determine' ? admission.why : null).toBe('unknown_code');
    expect(admission.outcome === 'cannot_determine' ? admission.unrecognisedCodes : []).toEqual(['77']);
  });

  it('decides on the codes it knows even when an unknown one is present', () => {
    // A new code alongside "501(c)(3) nonprofits" does not make eligibility unknowable: we are
    // named. Only an undecidable set falls through to cannot_determine.
    expect(ApplicantType.admitsCharity(['12', '77']).outcome).toBe('pass');
  });

  it('labels every code the live facet list returns', () => {
    const live = [
      '00',
      '01',
      '02',
      '04',
      '05',
      '06',
      '07',
      '08',
      '11',
      '12',
      '13',
      '20',
      '21',
      '22',
      '23',
      '25',
      '99',
    ];

    expect(live.filter((code) => ApplicantType.label(code) === null)).toEqual([]);
  });
});
