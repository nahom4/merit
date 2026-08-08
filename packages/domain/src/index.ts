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

export { computeProspectScore, COMPONENT_WEIGHTS } from './prospect/prospect-score.js';
export type { CredibilityReason, ProspectInput, ProspectScore } from './prospect/prospect-score.js';
