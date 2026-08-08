export type { OrganizationRepository } from './ports/organization-repository.port.js';
export type { Clock } from './ports/clock.port.js';
export type { IdGenerator } from './ports/id-generator.port.js';
export {
  DocumentUnavailable,
  DuplicateOrganization,
  FinancialsUnavailable,
  FunderNotFound,
  ModelOutputInvalid,
  ModelUnavailable,
  OpportunitySourceUnavailable,
  RepositoryUnavailable,
} from './errors.js';
export { CreateOrganization } from './use-cases/create-organization/create-organization.use-case.js';
export type { CreateOrganizationError } from './use-cases/create-organization/create-organization.use-case.js';
export { GetOrganization } from './use-cases/get-organization/get-organization.use-case.js';
export type {
  GetOrganizationError,
  GetOrganizationInput,
} from './use-cases/get-organization/get-organization.use-case.js';
export { InMemoryOrganizationRepository } from './testing/in-memory-organization.repository.js';
export { InMemoryProspectRepository } from './testing/in-memory-prospect.repository.js';
export type { FakeFunder } from './testing/in-memory-prospect.repository.js';
export { fixedClock, fixedIdGenerator } from './testing/fixed-id-generator.js';
export type { GrantRepository, IngestCheckpoint } from './ports/grant-repository.port.js';
export { IngestBundle } from './use-cases/ingest-bundle/ingest-bundle.use-case.js';
export type {
  FilingSource,
  FilingToIngest,
  IngestBundleResult,
} from './use-cases/ingest-bundle/ingest-bundle.use-case.js';
export { IngestInterrupted } from './use-cases/ingest-bundle/ingest-bundle.use-case.js';
export type { IngestBundleOptions } from './use-cases/ingest-bundle/ingest-bundle.use-case.js';
export type {
  EntityRepository,
  RegistryCandidate,
  RegistryEntityRow,
  UnresolvedGrant,
} from './ports/entity-repository.port.js';
export { ResolveRecipients } from './use-cases/resolve-recipients/resolve-recipients.use-case.js';
export type {
  ResolveRecipientsOptions,
  ResolveRecipientsResult,
} from './use-cases/resolve-recipients/resolve-recipients.use-case.js';
export type {
  CandidateFunder,
  FunderGrantHistory,
  PeerEntity,
  PeerGranteeEvidence,
  PeerQuery,
  ProspectRepository,
} from './ports/prospect-repository.port.js';
export { ScoreProspects } from './use-cases/score-prospects/score-prospects.use-case.js';
export type { Prospect, ProspectListing } from './use-cases/score-prospects/score-prospects.use-case.js';

export type { FunderProfile, FunderRepository } from './ports/funder-repository.port.js';
export type { FunderFinancialsGateway } from './ports/funder-financials.port.js';
export { ReportFunderReachability } from './use-cases/report-funder-reachability/report-funder-reachability.use-case.js';
export type {
  FunderReachabilityReport,
  ReportFunderReachabilityError,
  ReportFunderReachabilityInput,
} from './use-cases/report-funder-reachability/report-funder-reachability.use-case.js';
export type {
  OpportunityGateway,
  OpportunitySearchHit,
  OpportunitySearchQuery,
} from './ports/opportunity-gateway.port.js';
export type {
  BoardRow,
  FitState,
  OpportunityRepository,
  StoredAssessment,
  SweepRun,
} from './ports/opportunity-repository.port.js';
export type { RegistryStatus, RegistryStatusReader } from './ports/registry-status.port.js';
export type { AnnouncementDocumentGateway } from './ports/announcement-document.port.js';
export type { DraftRepository, DraftTargetKind, StoredDraft } from './ports/draft-repository.port.js';
export type {
  ModelCompletion,
  ModelError,
  ModelGateway,
  ModelPriority,
  ModelRequest,
} from './ports/model.port.js';
export type {
  ModelCallLog,
  ModelCallRecord,
  ModelResponseCache,
  ModelSpend,
} from './ports/model-telemetry.port.js';
export { SweepFederalOpportunities } from './use-cases/sweep-federal-opportunities/sweep-federal-opportunities.use-case.js';
export type {
  SweepError,
  SweepInput,
} from './use-cases/sweep-federal-opportunities/sweep-federal-opportunities.use-case.js';
export { ScreenFederalOpportunities } from './use-cases/screen-federal-opportunities/screen-federal-opportunities.use-case.js';
export type {
  FederalBoard,
  ScreenFederalOpportunitiesInput,
  ScreenedOpportunity,
} from './use-cases/screen-federal-opportunities/screen-federal-opportunities.use-case.js';
export {
  fitScorePrompt,
  programAreaMenu,
} from './use-cases/screen-federal-opportunities/fit-score.prompt.js';
export { DraftApplication } from './use-cases/draft-application/draft-application.use-case.js';
export type {
  DraftApplicationInput,
  DraftApplicationOutput,
} from './use-cases/draft-application/draft-application.use-case.js';
export {
  critiquePrompt,
  foundationSectionPrompt,
  revisionPrompt,
  rubricPrompt,
  sectionPrompt,
  summarySectionPrompt,
} from './use-cases/draft-application/draft.prompts.js';
export { DraftFoundationLetter } from './use-cases/draft-application/draft-foundation-letter.use-case.js';
export type {
  DraftFoundationLetterInput,
  DraftFoundationLetterOutput,
} from './use-cases/draft-application/draft-foundation-letter.use-case.js';
export { ReportRunLog } from './use-cases/report-run-log/report-run-log.use-case.js';
export type { ReportRunLogInput, RunLog } from './use-cases/report-run-log/report-run-log.use-case.js';
export { InMemoryOpportunityRepository } from './testing/in-memory-opportunity.repository.js';
export { InMemoryDraftRepository } from './testing/in-memory-draft.repository.js';
export { StubOpportunityGateway } from './testing/stub-opportunity.gateway.js';
export { StubRegistryStatusReader } from './testing/stub-registry-status.reader.js';
export { NeverCalledModelGateway, StubModelGateway } from './testing/stub-model.gateway.js';
export type { RecordedRequest, StubReply } from './testing/stub-model.gateway.js';
export { InMemoryModelCallLog, InMemoryModelResponseCache } from './testing/in-memory-model-call.log.js';
export { InMemoryFunderRepository } from './testing/in-memory-funder.repository.js';
export type { FakeFunderRecord } from './testing/in-memory-funder.repository.js';
export { StubFunderFinancialsGateway } from './testing/stub-funder-financials.gateway.js';
