import type { Result } from '@merit/shared';
import type { RepositoryUnavailable } from '../errors.js';

export type NotificationKind = 'high_fit_alert' | 'at_risk_warning' | 'weekly_briefing';

export interface NotificationRecord {
  readonly dedupeKey: string;
  readonly kind: NotificationKind;
  readonly organizationId: string;
  readonly opportunityId: string | null;
  readonly subject: string;
  readonly body: string;
  readonly sentAt: string;
}

export interface NotificationRepository {
  reserveNotification(
    record: Omit<NotificationRecord, 'sentAt'>,
  ): Promise<Result<boolean, RepositoryUnavailable>>;
  listNotifications(
    organizationId: string,
    kind: NotificationKind,
  ): Promise<Result<readonly NotificationRecord[], RepositoryUnavailable>>;
}
