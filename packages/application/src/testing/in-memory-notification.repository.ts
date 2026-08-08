import { err, ok, type Result } from '@merit/shared';
import type {
  NotificationKind,
  NotificationRecord,
  NotificationRepository,
} from '../ports/notification-repository.port.js';
import { RepositoryUnavailable } from '../errors.js';

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly notifications = new Map<string, NotificationRecord>();
  private failsOnce = false;

  failNext(): void {
    this.failsOnce = true;
  }

  async reserveNotification(
    record: Omit<NotificationRecord, 'sentAt'>,
  ): Promise<Result<boolean, RepositoryUnavailable>> {
    if (this.failsOnce) {
      this.failsOnce = false;
      return err(
        new RepositoryUnavailable('notification write failed', { operation: 'reserveNotification' }),
      );
    }
    const exists = this.notifications.has(record.dedupeKey);
    if (exists) return ok(false);
    this.notifications.set(record.dedupeKey, {
      ...record,
      sentAt: new Date('2026-08-08T00:00:00.000Z').toISOString(),
    });
    return ok(true);
  }

  async listNotifications(
    organizationId: string,
    kind: NotificationKind,
  ): Promise<Result<readonly NotificationRecord[], RepositoryUnavailable>> {
    if (this.failsOnce) {
      this.failsOnce = false;
      return err(new RepositoryUnavailable('notification read failed', { operation: 'listNotifications' }));
    }
    return ok(
      [...this.notifications.values()].filter(
        (record) => record.organizationId === organizationId && record.kind === kind,
      ),
    );
  }
}
