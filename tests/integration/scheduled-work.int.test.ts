import { describe, expect, it } from 'vitest';
import { freshDatabase } from '../support/fresh-database.js';
import { LibsqlMilestoneRepository, LibsqlNotificationRepository } from '@merit/infrastructure';

describe('scheduled work persistence', () => {
  it('stores notifications and milestones once per natural key', async () => {
    const database = await freshDatabase();
    try {
      const notifications = new LibsqlNotificationRepository(database.db);
      const milestones = new LibsqlMilestoneRepository(database.db);

      expect(
        await notifications.reserveNotification({
          dedupeKey: 'high-fit:org_1:opp_1',
          kind: 'high_fit_alert',
          organizationId: 'org_1',
          opportunityId: 'opp_1',
          subject: 'High-fit opportunity',
          body: 'body',
        }),
      ).toMatchObject({ ok: true, value: true });
      expect(
        await notifications.reserveNotification({
          dedupeKey: 'high-fit:org_1:opp_1',
          kind: 'high_fit_alert',
          organizationId: 'org_1',
          opportunityId: 'opp_1',
          subject: 'High-fit opportunity',
          body: 'body',
        }),
      ).toMatchObject({ ok: true, value: false });

      expect(
        await milestones.upsertMilestones([
          {
            dedupeKey: 'milestone:org_1:opp_1:draft_complete:2026-08-08',
            organizationId: 'org_1',
            opportunityId: 'opp_1',
            kind: 'draft_complete',
            label: 'Draft complete',
            dueDate: '2026-08-08',
            calendarEventId: 'event_1',
            approvedAt: '2026-08-08T12:00:00.000Z',
          },
        ]),
      ).toMatchObject({ ok: true, value: 1 });
      const due = await milestones.listDueMilestones('org_1', '2026-08-31');
      expect(due.ok ? due.value[0]?.calendarEventId : null).toBe('event_1');
    } finally {
      await database.destroy();
    }
  });
});
