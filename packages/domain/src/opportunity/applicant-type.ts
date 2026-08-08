/**
 * Grants.gov applicant eligibility codes, and what they mean for a small 501(c)(3) charity.
 *
 * The codes and their wording are the ones the live `search2` eligibility facet returns
 * (verified 8 August 2026; the contract test in `tests/contract/grants-gov.contract.test.ts`
 * keeps this table honest). The labels here are shortened for a screen -- the announcement's
 * own words run to a sentence -- but the codes are the source's.
 */
const CODES: Readonly<Record<string, string>> = {
  '00': 'State governments',
  '01': 'County governments',
  '02': 'City or township governments',
  '04': 'Special district governments',
  '05': 'Independent school districts',
  '06': 'Public and State controlled institutions of higher education',
  '07': 'Native American tribal governments (Federally recognized)',
  '08': 'Public housing authorities/Indian housing authorities',
  '11': 'Native American tribal organizations (other than Federally recognized tribal governments)',
  '12': 'Nonprofits with 501(c)(3) status, other than institutions of higher education',
  '13': 'Nonprofits without 501(c)(3) status, other than institutions of higher education',
  '20': 'Private institutions of higher education',
  '21': 'Individuals',
  '22': 'For profit organizations other than small businesses',
  '23': 'Small businesses',
  '25': 'Others — the announcement clarifies eligibility in its own text',
  '99': 'Unrestricted — open to any type of entity',
};

/** The organisation Merit works for is a 501(c)(3) charity. These two codes name it. */
const CHARITY = '12';
const UNRESTRICTED = '99';
/** "Others (see text field entitled Additional Information on Eligibility)". A structured
 *  answer is not available for these: the announcement says so itself. */
const DEFERS_TO_TEXT = '25';

export type ApplicantTypeAdmission =
  | { readonly outcome: 'pass'; readonly viaCode: string }
  | { readonly outcome: 'fail'; readonly statedFor: readonly string[] }
  | {
      readonly outcome: 'cannot_determine';
      readonly why: 'not_stated' | 'defers_to_text' | 'unknown_code';
      readonly unrecognisedCodes: readonly string[];
    };

/**
 * Whether a 501(c)(3) charity is among the applicant types an announcement names.
 *
 * A code we have never seen produces `cannot_determine` rather than a rejection. Grants.gov
 * adds codes without telling anyone, and treating an unknown one as exclusion would hide a
 * live opportunity behind a confident-looking reason -- the failure mode this project refuses.
 * An unknown code alongside a code that already admits us changes nothing, so it is only
 * load-bearing when the rest of the set is undecidable.
 */
const admitsCharity = (codes: readonly string[]): ApplicantTypeAdmission => {
  if (codes.length === 0) return { outcome: 'cannot_determine', why: 'not_stated', unrecognisedCodes: [] };

  if (codes.includes(CHARITY)) return { outcome: 'pass', viaCode: CHARITY };
  if (codes.includes(UNRESTRICTED)) return { outcome: 'pass', viaCode: UNRESTRICTED };

  const unrecognised = codes.filter((code) => !Object.hasOwn(CODES, code));
  if (unrecognised.length > 0) {
    return { outcome: 'cannot_determine', why: 'unknown_code', unrecognisedCodes: unrecognised };
  }
  if (codes.includes(DEFERS_TO_TEXT)) {
    return { outcome: 'cannot_determine', why: 'defers_to_text', unrecognisedCodes: [] };
  }

  return {
    outcome: 'fail',
    // In the announcement's own order, so a user comparing the two sees the same list.
    statedFor: codes.map((code) => CODES[code] ?? code),
  };
};

export const ApplicantType = {
  admitsCharity,
  label: (code: string): string | null => CODES[code] ?? null,
  CHARITY,
} as const;
