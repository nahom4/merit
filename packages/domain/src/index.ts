export { Ein } from './shared/ein.js';
export { Cents } from './shared/money.js';
export { NteeCode } from './organization/ntee-code.js';
export { UsState } from './organization/us-state.js';
export { Organization } from './organization/organization.js';
export type { OrganizationId } from './organization/organization.js';
export {
  materialityFloor,
  MATERIALITY_FLOOR_MINIMUM_DOLLARS,
  MATERIALITY_FLOOR_RATE,
} from './prospect/materiality-floor.js';

export { TaxYear } from './grant/tax-year.js';
export { GrantRecord, unescapeXmlText } from './grant/grant-record.js';
export type { SourceForm } from './grant/grant-record.js';

export { blockingKey, normalizeName, soundex, tokensOf } from './resolution/normalized-name.js';
export { jaroWinkler, scoreCandidate, tokenSetSimilarity } from './resolution/link-score.js';
export type { LinkCandidate, LinkScore } from './resolution/link-score.js';
export { decideLink, DEFAULT_THRESHOLDS } from './resolution/link-decision.js';
export type {
  LinkDecision,
  LinkThresholds,
  RejectionReason,
  ScoredCandidate,
} from './resolution/link-decision.js';

export { computeFunderSignals } from './funder/funder-signals.js';
export type { FunderSignals, GranteeGrant } from './funder/funder-signals.js';

export { computeReachability } from './funder/funder-reachability.js';
export type {
  AskBucket,
  AskDistribution,
  FunderReachability,
  GeographicSpread,
  ProgramShare,
  ReachabilityGrant,
  ReachabilityYear,
  StateShare,
  YearGrantee,
} from './funder/funder-reachability.js';

export { calibrateAsk } from './funder/ask-calibration.js';
export type { AskCalibration, AskCalibrationInput, CalibrationBasis } from './funder/ask-calibration.js';

export { AFFINITY_PATH_DISCLAIMER, AFFINITY_PATH_LABEL, buildAffinityPaths } from './funder/affinity-path.js';
export type {
  AffinityPath,
  AffinityPaths,
  ConnectedPeer,
  IntermediaryFunder,
  SharedFunderRow,
} from './funder/affinity-path.js';

export { computeFinancialTrend } from './funder/financial-trend.js';
export type {
  FilerFormType,
  FinancialTrend,
  FunderFinancialYear,
  Trend,
  TrendDirection,
} from './funder/financial-trend.js';

export { composeFunderBrief, UncitedClaim, validateBrief } from './funder/funder-brief.js';
export type {
  BriefClaim,
  BriefTopic,
  Citation,
  FunderBrief,
  FunderBriefInput,
} from './funder/funder-brief.js';

export type { FederalOpportunity, OpportunityStatus } from './opportunity/federal-opportunity.js';
export { ApplicantType } from './opportunity/applicant-type.js';
export type { ApplicantTypeAdmission } from './opportunity/applicant-type.js';
export {
  detectCountryRestriction,
  detectGeographicRestriction,
} from './opportunity/geographic-restriction.js';
export type { CountryRestriction, GeographicRestriction } from './opportunity/geographic-restriction.js';
export { mayReachAModel, screenEligibility } from './opportunity/eligibility-screening.js';
export type {
  CharityStatus,
  EligibilityCheck,
  EligibilityInput,
  EligibilityOutcome,
  EligibilityReasonCode,
  EligibilityRule,
  EligibilityScreening,
} from './opportunity/eligibility-screening.js';
export { FitAssessment, HIGH_FIT_THRESHOLD, isHighFit } from './opportunity/fit-assessment.js';

export { computeProspectScore, COMPONENT_WEIGHTS } from './prospect/prospect-score.js';
export type { CredibilityReason, ProspectInput, ProspectScore } from './prospect/prospect-score.js';
