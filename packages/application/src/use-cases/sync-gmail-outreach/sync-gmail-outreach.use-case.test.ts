import { describe, expect, it } from 'vitest';
import { err, ok } from '@merit/shared';
import { GmailUnavailable } from '../../errors.js';
import { InMemoryGmailConnectionRepository } from '../../testing/in-memory-gmail-connection.repository.js';
import { InMemoryOutreachRepository } from '../../testing/in-memory-outreach.repository.js';
import type { GmailMailboxGateway, GmailMessageDetail } from '../../ports/gmail-mailbox.port.js';
import { SyncGmailOutreach } from './sync-gmail-outreach.use-case.js';

const connection = {
  accountId: 'primary',
  emailAddress: 'sender@example.com',
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  scope: 'https://www.googleapis.com/auth/gmail.modify',
  accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
  watchExpiration: '2026-08-09T00:00:00.000Z',
  watchTopicName: 'projects/test/topics/gmail',
  lastSyncedHistoryId: '100',
  lastSyncedAt: '2026-08-08T00:00:00.000Z',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
} as const;

const gmail = (): GmailMailboxGateway => ({
  async exchangeAuthorizationCode() {
    return err(new GmailUnavailable('not used'));
  },
  async refreshAccessToken() {
    return err(new GmailUnavailable('not used'));
  },
  async getProfile() {
    return ok({ emailAddress: 'sender@example.com', historyId: '101' });
  },
  async watchMailbox() {
    return err(new GmailUnavailable('not used'));
  },
  async listHistory() {
    return ok({
      historyId: '101',
      history: [
        { id: '1', messages: [{ id: 'sent_1', threadId: 'thread_1' }] },
        { id: '2', messages: [{ id: 'reply_1', threadId: 'thread_1' }] },
      ],
    });
  },
  async getMessage(input) {
    const sent: GmailMessageDetail = {
      id: 'sent_1',
      threadId: 'thread_1',
      labelIds: ['SENT'],
      snippet: 'Hi Smith Foundation',
      internalDate: '1',
      headers: [
        { name: 'From', value: 'Sender Name <sender@example.com>' },
        { name: 'To', value: 'jane@smithfoundation.org' },
        { name: 'Subject', value: 'Funding inquiry: Smith Foundation' },
      ],
    };
    const reply: GmailMessageDetail = {
      id: 'reply_1',
      threadId: 'thread_1',
      labelIds: ['INBOX'],
      snippet: 'Could you send a one-pager?',
      internalDate: '2',
      headers: [
        { name: 'From', value: 'Jane Doe <jane@smithfoundation.org>' },
        { name: 'To', value: 'sender@example.com' },
        { name: 'Subject', value: 'Re: Funding inquiry: Smith Foundation' },
      ],
    };
    return input.messageId === 'sent_1' ? ok(sent) : ok(reply);
  },
});

describe('SyncGmailOutreach', () => {
  it('attaches sent mail to a draft and marks a reply as follow-up needed', async () => {
    const connections = new InMemoryGmailConnectionRepository();
    const outreaches = new InMemoryOutreachRepository();
    await connections.saveConnection(connection);
    await outreaches.upsertOutreach({
      organizationId: 'org_1',
      targetId: '561234567',
      targetKind: 'foundation',
      targetName: 'Smith Foundation',
      contactEmail: 'jane@smithfoundation.org',
      subject: 'Funding inquiry: Smith Foundation',
      body: 'Dear Smith Foundation',
      status: 'draft',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: null,
      followUpsScheduledAt: null,
    });

    const useCase = new SyncGmailOutreach(connections, outreaches, gmail(), 'client', 'secret');
    const result = await useCase.execute({ emailAddress: 'sender@example.com', historyId: '101' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.connectionFound).toBe(true);
    expect(result.value.outreachesUpdated).toBe(2);

    const loaded = await outreaches.findOutreach('org_1', '561234567', 'foundation');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.status).toBe('follow_up_needed');
    expect(loaded.value.gmailThreadId).toBe('thread_1');
  });

  it('syncs on demand by asking Gmail where the mailbox is now', async () => {
    // No Pub/Sub push in local development, so the same walk is started from the history id
    // the mailbox reports rather than from one a notification carried.
    const connections = new InMemoryGmailConnectionRepository();
    const outreaches = new InMemoryOutreachRepository();
    await connections.saveConnection(connection);
    await outreaches.upsertOutreach({
      organizationId: 'org_1',
      targetId: '561234567',
      targetKind: 'foundation',
      targetName: 'Smith Foundation',
      contactEmail: 'jane@smithfoundation.org',
      subject: 'Funding inquiry: Smith Foundation',
      body: 'Dear Smith Foundation',
      status: 'draft',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: null,
      followUpsScheduledAt: null,
    });

    const useCase = new SyncGmailOutreach(connections, outreaches, gmail(), 'client', 'secret');
    const result = await useCase.syncNow();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.connectionFound).toBe(true);
    expect(result.value.outreachesUpdated).toBe(2);

    const loaded = await outreaches.findOutreach('org_1', '561234567', 'foundation');
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.status).toBe('follow_up_needed');
  });

  it('walks past a message that no longer exists rather than stalling on it forever', async () => {
    // Gmail lists a change, then answers 404 for the message: it was deleted between the two
    // calls. Failing here would also leave the cursor unmoved, so every later sync would come
    // back to the same dead message and fail again.
    const connections = new InMemoryGmailConnectionRepository();
    const outreaches = new InMemoryOutreachRepository();
    await connections.saveConnection(connection);

    const mailbox = gmail();
    const withDeletedMessage: GmailMailboxGateway = {
      ...mailbox,
      async getMessage(input) {
        return input.messageId === 'sent_1' ? ok(null) : mailbox.getMessage(input);
      },
    };

    const useCase = new SyncGmailOutreach(connections, outreaches, withDeletedMessage, 'client', 'secret');
    const result = await useCase.execute({ emailAddress: 'sender@example.com', historyId: '101' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messagesSeen).toBe(1);
    expect(result.value.messagesGone).toBe(1);

    // And the cursor moved, so the dead message is not revisited.
    const saved = await connections.getConnection('primary');
    if (!saved.ok || saved.value === null) return;
    expect(saved.value.lastSyncedHistoryId).toBe('101');
  });

  it('does not read our own sent mail as a reply to itself', async () => {
    // Gmail returns From as `Name <address>`. Comparing that to a bare address made every sent
    // message look like it came from a stranger, so `sent` was immediately overwritten.
    const connections = new InMemoryGmailConnectionRepository();
    const outreaches = new InMemoryOutreachRepository();
    await connections.saveConnection(connection);
    await outreaches.upsertOutreach({
      organizationId: 'org_1',
      targetId: '561234567',
      targetKind: 'foundation',
      targetName: 'Smith Foundation',
      contactEmail: 'jane@smithfoundation.org',
      subject: 'Funding inquiry: Smith Foundation',
      body: 'Dear Smith Foundation',
      status: 'draft',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: null,
      followUpsScheduledAt: null,
    });

    const mailbox = gmail();
    const sentOnly: GmailMailboxGateway = {
      ...mailbox,
      async listHistory() {
        return ok({
          historyId: '101',
          history: [{ id: '1', messages: [{ id: 'sent_1', threadId: 'thread_1' }] }],
        });
      },
    };

    const useCase = new SyncGmailOutreach(connections, outreaches, sentOnly, 'client', 'secret');
    const result = await useCase.execute({ emailAddress: 'sender@example.com', historyId: '101' });

    expect(result.ok).toBe(true);
    const loaded = await outreaches.findOutreach('org_1', '561234567', 'foundation');
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.status).toBe('sent');
  });

  it('reports no connection rather than failing when no mailbox is connected', async () => {
    const useCase = new SyncGmailOutreach(
      new InMemoryGmailConnectionRepository(),
      new InMemoryOutreachRepository(),
      gmail(),
      'client',
      'secret',
    );

    const result = await useCase.syncNow();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.connectionFound).toBe(false);
  });
});
