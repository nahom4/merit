export type { OrganizationRepository } from './ports/organization-repository.port.js';
export type { Clock } from './ports/clock.port.js';
export type { IdGenerator } from './ports/id-generator.port.js';
export type { CalendarGateway, CalendarEventInput, CalendarEvent } from './ports/calendar-gateway.port.js';
export type { GmailGateway, GmailMessageInput, GmailMessage } from './ports/gmail-gateway.port.js';
export type { MilestoneRepository, ScheduledMilestoneRecord } from './ports/milestone-repository.port.js';
export type {
  NotificationKind,
  NotificationRecord,
  NotificationRepository,
} from './ports/notification-repository.port.js';
export type {
  GmailConnectionRecord,
  GmailConnectionRepository,
} from './ports/gmail-connection-repository.port.js';
export type {
  GmailHistory,
  GmailHistoryMessage,
  GmailHistoryRecord,
  GmailMailboxGateway,
  GmailMessageDetail,
  GmailMessageHeader,
  GmailProfile,
  GmailTokenSet,
  GmailWatch,
} from './ports/gmail-mailbox.port.js';
export type {
  OutreachRecord,
  OutreachRepository,
  OutreachStatus,
  OutreachTargetKind,
} from './ports/outreach-repository.port.js';
export {
  DocumentUnavailable,
  DuplicateOrganization,
  CalendarUnavailable,
  FinancialsUnavailable,
  FunderNotFound,
  GmailUnavailable,
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
export { InMemoryNotificationRepository } from './testing/in-memory-notification.repository.js';
export { InMemoryOutreachRepository } from './testing/in-memory-outreach.repository.js';
export { InMemoryMilestoneRepository } from './testing/in-memory-milestone.repository.js';
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
export type {
  CachedListingPayload,
  CachedProspectListing,
  ProspectListingCache,
} from './ports/prospect-listing-cache.port.js';
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
export { InMemoryGmailConnectionRepository } from './testing/in-memory-gmail-connection.repository.js';
export { StubOpportunityGateway } from './testing/stub-opportunity.gateway.js';
export { StubRegistryStatusReader } from './testing/stub-registry-status.reader.js';
export { NeverCalledModelGateway, StubModelGateway } from './testing/stub-model.gateway.js';
export type { RecordedRequest, StubReply } from './testing/stub-model.gateway.js';
export { InMemoryModelCallLog, InMemoryModelResponseCache } from './testing/in-memory-model-call.log.js';
export { InMemoryFunderRepository } from './testing/in-memory-funder.repository.js';
export type { FakeFunderRecord } from './testing/in-memory-funder.repository.js';
export { StubFunderFinancialsGateway } from './testing/stub-funder-financials.gateway.js';
export { StubGmailGateway } from './testing/stub-gmail.gateway.js';
export { StubCalendarGateway } from './testing/stub-calendar.gateway.js';
export { SendHighFitAlerts } from './use-cases/send-high-fit-alerts/send-high-fit-alerts.use-case.js';
export type {
  HighFitAlertSummary,
  SendHighFitAlertsInput,
} from './use-cases/send-high-fit-alerts/send-high-fit-alerts.use-case.js';
export { PublishMilestones } from './use-cases/publish-milestones/publish-milestones.use-case.js';
export type {
  PublishedMilestones,
  PublishMilestonesInput,
} from './use-cases/publish-milestones/publish-milestones.use-case.js';
export { SendDeadlineWarnings } from './use-cases/send-deadline-warnings/send-deadline-warnings.use-case.js';
export type {
  DeadlineWarningSummary,
  SendDeadlineWarningsInput,
} from './use-cases/send-deadline-warnings/send-deadline-warnings.use-case.js';
export { SendWeeklyBriefing } from './use-cases/send-weekly-briefing/send-weekly-briefing.use-case.js';
export type {
  SendWeeklyBriefingInput,
  WeeklyBriefingSummary,
} from './use-cases/send-weekly-briefing/send-weekly-briefing.use-case.js';
export { GetFoundationOutreach } from './use-cases/get-foundation-outreach/get-foundation-outreach.use-case.js';
export type { GetFoundationOutreachInput } from './use-cases/get-foundation-outreach/get-foundation-outreach.use-case.js';
export { ListOutreaches } from './use-cases/list-outreaches/list-outreaches.use-case.js';
export type { ListOutreachesInput } from './use-cases/list-outreaches/list-outreaches.use-case.js';
export {
  SaveFoundationOutreach,
  gmailComposeHref,
  gmailThreadHref,
  nextMessageDraft,
} from './use-cases/save-foundation-outreach/save-foundation-outreach.use-case.js';
export type {
  SaveFoundationOutreachInput,
  SaveFoundationOutreachOutput,
} from './use-cases/save-foundation-outreach/save-foundation-outreach.use-case.js';
export { SyncGmailOutreach } from './use-cases/sync-gmail-outreach/sync-gmail-outreach.use-case.js';
export { TrackApplication } from './use-cases/track-application/track-application.use-case.js';
export type {
  TrackApplicationInput,
  TrackApplicationOutput,
} from './use-cases/track-application/track-application.use-case.js';
export type {
  GmailPushNotification,
  SyncGmailOutreachError,
  SyncGmailOutreachSummary,
} from './use-cases/sync-gmail-outreach/sync-gmail-outreach.use-case.js';
