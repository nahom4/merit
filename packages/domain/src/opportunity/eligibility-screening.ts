import { UsState } from '../organization/us-state.js';
import { ApplicantType } from './applicant-type.js';
import { detectCountryRestriction, detectGeographicRestriction } from './geographic-restriction.js';
import type { FederalOpportunity } from './federal-opportunity.js';

/**
 * Hard eligibility: can this organisation apply at all?
 *
 * This is the first stage of the cascade, and it runs before any model call. It is arithmetic
 * over structured fields and a conservative read of the announcement's own eligibility prose --
 * no judgement, no model, no network. That separation is what keeps the fit score defensible:
 * "may we apply" is a rule, "is it worth applying" is a judgement, and collapsing them into one
 * model call produces a number nobody can defend.
 */

export type EligibilityRule = 'applicant_type' | 'charity_status' | 'geography' | 'country';

export type EligibilityOutcome = 'pass' | 'fail' | 'cannot_determine';

/**
 * Why a check decided what it did -- a typed union rather than a free string, so the UI can
 * group rejections and a test can assert one without matching prose.
 */
export type EligibilityReasonCode =
  | 'applicant_types_admit_charities'
  | 'applicant_types_unrestricted'
  | 'applicant_types_exclude_charities'
  | 'applicant_types_not_stated'
  | 'applicant_types_defer_to_text'
  | 'applicant_types_unrecognised'
  | 'charity_status_confirmed'
  | 'charity_status_not_held'
  | 'charity_status_unknown'
  | 'no_geographic_restriction'
  | 'inside_stated_states'
  | 'outside_stated_states'
  | 'geographic_restriction_unreadable'
  | 'open_to_us_applicants'
  | 'no_country_restriction'
  | 'foreign_applicants_only';

export interface EligibilityCheck {
  readonly rule: EligibilityRule;
  readonly outcome: EligibilityOutcome;
  readonly code: EligibilityReasonCode;
  /** Stored and shown. Every rejection has to be readable by the person it excludes. */
  readonly reason: string;
}

export interface EligibilityScreening {
  readonly outcome: 'eligible' | 'ineligible' | 'indeterminate';
  readonly checks: readonly EligibilityCheck[];
  readonly rejections: readonly EligibilityCheck[];
  readonly unresolved: readonly EligibilityCheck[];
}

/**
 * Whether the organisation's 501(c)(3) status could be confirmed against the IRS registry.
 * `unknown` is a real answer: the registry is a snapshot, and an EIN absent from it is not an
 * EIN known to be ineligible.
 */
export type CharityStatus = 'confirmed' | 'not_held' | 'unknown';

export interface EligibilityInput {
  readonly opportunity: FederalOpportunity;
  readonly organizationName: string;
  /** Two-letter jurisdiction code, as the profile holds it. */
  readonly organizationState: string;
  readonly charityStatus: CharityStatus;
}

/** "a, b and c" -- a list a person reads, not a JSON array. */
const list = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const applicantTypeCheck = (opportunity: FederalOpportunity): EligibilityCheck => {
  const admission = ApplicantType.admitsCharity(opportunity.applicantTypeCodes);

  if (admission.outcome === 'pass') {
    return admission.viaCode === ApplicantType.CHARITY
      ? {
          rule: 'applicant_type',
          outcome: 'pass',
          code: 'applicant_types_admit_charities',
          reason: 'This announcement names nonprofits with 501(c)(3) status as eligible applicants.',
        }
      : {
          rule: 'applicant_type',
          outcome: 'pass',
          code: 'applicant_types_unrestricted',
          reason: 'This announcement is unrestricted: it is open to any type of entity.',
        };
  }

  if (admission.outcome === 'fail') {
    return {
      rule: 'applicant_type',
      outcome: 'fail',
      code: 'applicant_types_exclude_charities',
      reason:
        `This announcement is open to ${list(admission.statedFor)}. It does not name nonprofits ` +
        'with 501(c)(3) status.',
    };
  }

  if (admission.why === 'not_stated') {
    return {
      rule: 'applicant_type',
      outcome: 'cannot_determine',
      code: 'applicant_types_not_stated',
      reason: 'This announcement states no applicant types, so who may apply cannot be read from it.',
    };
  }

  if (admission.why === 'unknown_code') {
    return {
      rule: 'applicant_type',
      outcome: 'cannot_determine',
      code: 'applicant_types_unrecognised',
      reason:
        `This announcement uses applicant type ${list(admission.unrecognisedCodes)}, which Merit ` +
        'does not recognise. It is treated as undecided rather than as an exclusion.',
    };
  }

  return {
    rule: 'applicant_type',
    outcome: 'cannot_determine',
    code: 'applicant_types_defer_to_text',
    reason:
      'This announcement lists "Others" as an applicant type and clarifies eligibility in its own ' +
      'text, so it cannot be decided from the structured fields alone.',
  };
};

const charityStatusCheck = (status: CharityStatus, organizationName: string): EligibilityCheck => {
  if (status === 'confirmed') {
    return {
      rule: 'charity_status',
      outcome: 'pass',
      code: 'charity_status_confirmed',
      reason: `The IRS registry records ${organizationName} as a 501(c)(3) organisation.`,
    };
  }
  if (status === 'not_held') {
    return {
      rule: 'charity_status',
      outcome: 'fail',
      code: 'charity_status_not_held',
      reason:
        `The IRS registry does not record ${organizationName} under 501(c)(3), and this ` +
        'announcement requires a status this organisation does not hold.',
    };
  }
  return {
    rule: 'charity_status',
    outcome: 'cannot_determine',
    code: 'charity_status_unknown',
    reason:
      `No IRS registry record was found for ${organizationName}'s EIN, so its 501(c)(3) status ` +
      'could not be confirmed. That is an absence of evidence, not evidence of ineligibility.',
  };
};

const geographyCheck = (
  opportunity: FederalOpportunity,
  organizationState: string,
  organizationName: string,
): EligibilityCheck => {
  const restriction = detectGeographicRestriction(opportunity.eligibilityText);

  if (restriction.kind === 'none') {
    return {
      rule: 'geography',
      outcome: 'pass',
      code: 'no_geographic_restriction',
      reason: 'This announcement states no geographic restriction on applicants.',
    };
  }

  if (restriction.kind === 'indeterminate') {
    return {
      rule: 'geography',
      outcome: 'cannot_determine',
      code: 'geographic_restriction_unreadable',
      reason:
        'This announcement restricts eligibility by geography without naming a jurisdiction: ' +
        `"${restriction.phrase}". Check the announcement before you write.`,
    };
  }

  const named = restriction.states.map((code) => UsState.label(code)).sort();
  const home = UsState.label(organizationState);

  if (restriction.states.includes(organizationState.toUpperCase())) {
    return {
      rule: 'geography',
      outcome: 'pass',
      code: 'inside_stated_states',
      reason: `This announcement is limited to ${list(named)}, and ${organizationName} is in ${home}.`,
    };
  }

  return {
    rule: 'geography',
    outcome: 'fail',
    code: 'outside_stated_states',
    reason: `This announcement limits eligibility to ${list(named)}. ${organizationName} is in ${home}.`,
  };
};

const countryCheck = (opportunity: FederalOpportunity): EligibilityCheck => {
  const restriction = detectCountryRestriction(opportunity.eligibilityText);

  if (restriction === 'foreign_only') {
    return {
      rule: 'country',
      outcome: 'fail',
      code: 'foreign_applicants_only',
      reason: 'This announcement is open only to non-US organisations.',
    };
  }
  if (restriction === 'us_only') {
    return {
      rule: 'country',
      outcome: 'pass',
      code: 'open_to_us_applicants',
      reason: 'This announcement is open to US applicants, which this organisation is.',
    };
  }
  return {
    rule: 'country',
    outcome: 'pass',
    code: 'no_country_restriction',
    reason: 'This announcement states no country restriction on applicants.',
  };
};

export const screenEligibility = (input: EligibilityInput): EligibilityScreening => {
  const checks: readonly EligibilityCheck[] = [
    applicantTypeCheck(input.opportunity),
    charityStatusCheck(input.charityStatus, input.organizationName),
    geographyCheck(input.opportunity, input.organizationState, input.organizationName),
    countryCheck(input.opportunity),
  ];

  const rejections = checks.filter((check) => check.outcome === 'fail');
  const unresolved = checks.filter((check) => check.outcome === 'cannot_determine');

  return {
    outcome: rejections.length > 0 ? 'ineligible' : unresolved.length > 0 ? 'indeterminate' : 'eligible',
    checks,
    rejections,
    unresolved,
  };
};

/**
 * The cascade's one rule, in one place: a model is never asked about an opportunity the
 * organisation cannot apply for.
 *
 * An undecidable check is not a rejection. Treating "we could not confirm" as "no" would hide
 * live opportunities behind confident-looking reasons; the unresolved check is stated on the
 * screen instead, and the score is offered for what it is worth.
 */
export const mayReachAModel = (screening: EligibilityScreening): boolean =>
  screening.outcome !== 'ineligible';
