import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { err, ok } from '@merit/shared';
import { CalendarUnavailable } from '@merit/application';
import {
  SyncGmailOutreach,
  type CalendarEventInput,
  type CalendarGateway,
  type GmailMailboxGateway,
} from '@merit/application';
import { LibsqlGmailConnectionRepository, LibsqlOutreachRepository } from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';

/**
 * The Gmail push path, end to end against a real database.
 *
 * Everything Merit owns is real here: both migrations, both repositories, and the use case that
 * decides what a mailbox change means for an outreach record. Only Google is stood in for — a
 * push notification cannot be provoked from a test, and the shape of what it returns is held
 * true by `tests/contract`, not by this file.
 */

let database: FreshDatabase;

const OUR_ADDRESS = 'ed@capefearreading.org';
const FUNDER_ADDRESS = 'grants@smithfoundation.org';

/** The mailbox, scripted by message id. Real HTTP is not what this test is checking. */
const gatewayReturning = (
  messages: Record<
    string,
    { labelIds: string[]; from: string; to: string; subject: string; threadId: string; snippet?: string }
  >,
  history: { historyId: string; changed: { id: string; threadId: string }[] },
): GmailMailboxGateway => ({
  exchangeAuthorizationCode: async () => unexpected('exchangeAuthorizationCode'),
  refreshAccessToken: async () => unexpected('refreshAccessToken'),
  getProfile: async () => ok({ emailAddress: OUR_ADDRESS, historyId: history.historyId }),
  watchMailbox: async () => unexpected('watchMailbox'),
  listHistory: async () =>
    ok({
      historyId: history.historyId,
      history: [{ id: history.historyId, messages: history.changed }],
    }),
  getMessage: async ({ messageId }) => {
    const message = messages[messageId];
    if (message === undefined) throw new Error(`no scripted message ${messageId}`);
    return ok({
      id: messageId,
      threadId: message.threadId,
      labelIds: message.labelIds,
      snippet: message.snippet ?? '',
      internalDate: '1770000000000',
      headers: [
        { name: 'From', value: message.from },
        { name: 'To', value: message.to },
        { name: 'Subject', value: message.subject },
      ],
    });
  },
});

const unexpected = (name: string): never => {
  throw new Error(`${name} should not be called on the push path`);
};

const connections = () => new LibsqlGmailConnectionRepository(database.db);
const outreaches = () => new LibsqlOutreachRepository(database.db);

const seedConnection = async (lastSyncedHistoryId: string) => {
  const now = new Date().toISOString();
  const saved = await connections().saveConnection({
    accountId: 'primary',
    emailAddress: OUR_ADDRESS,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    scope: 'https://www.googleapis.com/auth/gmail.modify',
    // Comfortably in the future, so the refresh branch stays out of this test.
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    watchExpiration: '1770000000000',
    watchTopicName: 'projects/merit/topics/gmail',
    lastSyncedHistoryId,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  expect(saved.ok).toBe(true);
};

const seedDraft = async () => {
  const saved = await outreaches().upsertOutreach({
    organizationId: 'org_1',
    targetId: '561234567',
    targetKind: 'foundation',
    targetName: 'Smith Foundation',
    contactEmail: FUNDER_ADDRESS,
    subject: 'Funding inquiry: Smith Foundation',
    body: 'Dear Smith Foundation,',
    status: 'draft',
    gmailMessageId: null,
    gmailThreadId: null,
    lastSyncedAt: null,
    followUpsScheduledAt: null,
  });
  expect(saved.ok).toBe(true);
};

const loadOutreach = async () => {
  const loaded = await outreaches().findOutreach('org_1', '561234567', 'foundation');
  if (!loaded.ok || loaded.value === null) throw new Error('the outreach row went missing');
  return loaded.value;
};

const syncWith = (gateway: GmailMailboxGateway, calendar: CalendarGateway | null = null) =>
  new SyncGmailOutreach(
    connections(),
    outreaches(),
    gateway,
    'client-id',
    'client-secret',
    calendar,
    'primary',
    'https://merit.example.org',
  );

/** Records what was written rather than writing it: Google Calendar is not under test here. */
const recordingCalendar = (): CalendarGateway & { readonly written: CalendarEventInput[] } => {
  const written: CalendarEventInput[] = [];
  return {
    written,
    async upsertEvent(input) {
      written.push(input);
      return ok({ id: input.idempotencyKey, htmlLink: null });
    },
  };
};

beforeAll(async () => {
  database = await freshDatabase();
});

afterAll(async () => {
  await database.destroy();
});

beforeEach(async () => {
  await database.db.execute('DELETE FROM outreach_threads');
  await database.db.execute('DELETE FROM gmail_connections');
});

describe('SyncGmailOutreach against a real database', () => {
  it('marks a saved draft sent when the message leaves the mailbox', async () => {
    await seedConnection('100');
    await seedDraft();

    const result = await syncWith(
      gatewayReturning(
        {
          'msg-1': {
            labelIds: ['SENT'],
            from: `Cape Fear ED <${OUR_ADDRESS}>`,
            to: FUNDER_ADDRESS,
            subject: 'Funding inquiry: Smith Foundation',
            threadId: 'thread-1',
          },
        },
        { historyId: '101', changed: [{ id: 'msg-1', threadId: 'thread-1' }] },
      ),
    ).execute({ emailAddress: OUR_ADDRESS, historyId: '101' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outreachesUpdated).toBe(1);

    const outreach = await loadOutreach();
    expect(outreach.status).toBe('sent');
    expect(outreach.gmailMessageId).toBe('msg-1');
    expect(outreach.gmailThreadId).toBe('thread-1');
    expect(outreach.lastSyncedAt).not.toBeNull();

    // The cursor advances, so the next notification does not re-walk this history.
    const connection = await connections().getConnection('primary');
    if (!connection.ok || connection.value === null) throw new Error('the connection went missing');
    expect(connection.value.lastSyncedHistoryId).toBe('101');
  });

  it('marks a sent outreach replied when the funder answers on the same thread', async () => {
    await seedConnection('101');
    await seedDraft();
    const draft = await loadOutreach();
    await outreaches().upsertOutreach({
      ...draft,
      status: 'sent',
      gmailMessageId: 'msg-1',
      gmailThreadId: 'thread-1',
    });

    const result = await syncWith(
      gatewayReturning(
        {
          'msg-2': {
            labelIds: ['INBOX'],
            from: `Smith Foundation Grants <${FUNDER_ADDRESS}>`,
            to: OUR_ADDRESS,
            subject: 'Re: Funding inquiry: Smith Foundation',
            threadId: 'thread-1',
            snippet: 'Thanks for writing — we will read it this month.',
          },
        },
        { historyId: '102', changed: [{ id: 'msg-2', threadId: 'thread-1' }] },
      ),
    ).execute({ emailAddress: OUR_ADDRESS, historyId: '102' });

    expect(result.ok).toBe(true);
    expect((await loadOutreach()).status).toBe('replied');
  });

  it('says follow-up is needed when the reply asks for something', async () => {
    await seedConnection('101');
    await seedDraft();
    const draft = await loadOutreach();
    await outreaches().upsertOutreach({
      ...draft,
      status: 'sent',
      gmailMessageId: 'msg-1',
      gmailThreadId: 'thread-1',
    });

    const result = await syncWith(
      gatewayReturning(
        {
          'msg-2': {
            labelIds: ['INBOX'],
            from: `Smith Foundation Grants <${FUNDER_ADDRESS}>`,
            to: OUR_ADDRESS,
            subject: 'Re: Funding inquiry: Smith Foundation',
            threadId: 'thread-1',
            snippet: 'Could you send your most recent audited financials?',
          },
        },
        { historyId: '102', changed: [{ id: 'msg-2', threadId: 'thread-1' }] },
      ),
    ).execute({ emailAddress: OUR_ADDRESS, historyId: '102' });

    expect(result.ok).toBe(true);
    expect((await loadOutreach()).status).toBe('follow_up_needed');
  });

  it('is idempotent: a duplicate delivery of the same notification changes nothing', async () => {
    await seedConnection('100');
    await seedDraft();

    const gateway = gatewayReturning(
      {
        'msg-1': {
          labelIds: ['SENT'],
          from: `Cape Fear ED <${OUR_ADDRESS}>`,
          to: FUNDER_ADDRESS,
          subject: 'Funding inquiry: Smith Foundation',
          threadId: 'thread-1',
        },
      },
      { historyId: '101', changed: [{ id: 'msg-1', threadId: 'thread-1' }] },
    );

    await syncWith(gateway).execute({ emailAddress: OUR_ADDRESS, historyId: '101' });
    const second = await syncWith(gateway).execute({ emailAddress: OUR_ADDRESS, historyId: '101' });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // The cursor is already at 101, so the second delivery does not walk history again.
    expect(second.value.messagesSeen).toBe(0);
    expect(second.value.outreachesUpdated).toBe(0);
    expect((await loadOutreach()).status).toBe('sent');
  });

  it('puts two follow-up reminders on the calendar when a letter goes out, once', async () => {
    await seedConnection('100');
    await seedDraft();
    const calendar = recordingCalendar();

    const gateway = gatewayReturning(
      {
        'msg-1': {
          labelIds: ['SENT'],
          from: `Cape Fear ED <${OUR_ADDRESS}>`,
          to: FUNDER_ADDRESS,
          subject: 'Funding inquiry: Smith Foundation',
          threadId: 'thread-1',
        },
      },
      { historyId: '101', changed: [{ id: 'msg-1', threadId: 'thread-1' }] },
    );

    const result = await syncWith(gateway, calendar).execute({
      emailAddress: OUR_ADDRESS,
      historyId: '101',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.followUpsScheduled).toBe(2);
    expect(calendar.written).toHaveLength(2);
    expect(calendar.written[0]?.summary).toBe('Follow up: Smith Foundation');
    // Every reminder carries the way back into the conversation it is about.
    expect(calendar.written[0]?.description).toContain('thread-1');
    // The reminder leads back into Merit, where the follow-up is already drafted.
    expect(calendar.written[0]?.description).toContain(
      'https://merit.example.org/organizations/org_1/outreach',
    );
    expect(calendar.written[1]?.description).toContain('7 days since');
    expect((await loadOutreach()).followUpsScheduledAt).not.toBeNull();

    // A second sighting of the same send must not double-book the calendar. The cursor stops
    // the re-walk; the stored timestamp stops it even if the cursor is reset.
    await database.db.execute("UPDATE gmail_connections SET last_synced_history_id = '100'");
    const again = await syncWith(gateway, calendar).execute({
      emailAddress: OUR_ADDRESS,
      historyId: '101',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.followUpsScheduled).toBe(0);
    expect(calendar.written).toHaveLength(2);
  });

  it('records the send even when the calendar is unreachable', async () => {
    await seedConnection('100');
    await seedDraft();
    const brokenCalendar: CalendarGateway = {
      async upsertEvent() {
        return err(new CalendarUnavailable('calendar is down', { operation: 'upsertEvent' }));
      },
    };

    const result = await syncWith(
      gatewayReturning(
        {
          'msg-1': {
            labelIds: ['SENT'],
            from: `Cape Fear ED <${OUR_ADDRESS}>`,
            to: FUNDER_ADDRESS,
            subject: 'Funding inquiry: Smith Foundation',
            threadId: 'thread-1',
          },
        },
        { historyId: '101', changed: [{ id: 'msg-1', threadId: 'thread-1' }] },
      ),
      brokenCalendar,
    ).execute({ emailAddress: OUR_ADDRESS, historyId: '101' });

    expect(result.ok).toBe(true);
    // Losing a reminder must not lose the fact that the letter was sent.
    expect((await loadOutreach()).status).toBe('sent');
    expect((await loadOutreach()).followUpsScheduledAt).toBeNull();
  });

  it('does nothing for a notification about a mailbox Merit is not connected to', async () => {
    await seedConnection('100');
    await seedDraft();

    const result = await syncWith(gatewayReturning({}, { historyId: '101', changed: [] })).execute({
      emailAddress: 'someone-else@example.org',
      historyId: '101',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.connectionFound).toBe(false);
    expect((await loadOutreach()).status).toBe('draft');
  });
});
