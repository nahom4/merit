import { ok, type Result } from '@merit/shared';
import type { GmailUnavailable, RepositoryUnavailable } from '../../errors.js';
import type { GmailConnectionRecord } from '../../ports/gmail-connection-repository.port.js';
import type { GmailConnectionRepository } from '../../ports/gmail-connection-repository.port.js';
import type { GmailMailboxGateway } from '../../ports/gmail-mailbox.port.js';
import type { OutreachRecord, OutreachRepository } from '../../ports/outreach-repository.port.js';
import type { CalendarGateway } from '../../ports/calendar-gateway.port.js';
import { gmailThreadHref } from '../save-foundation-outreach/save-foundation-outreach.use-case.js';

export interface GmailPushNotification {
  readonly emailAddress: string;
  readonly historyId: string;
}

export interface SyncGmailOutreachSummary {
  readonly connectionFound: boolean;
  readonly messagesSeen: number;
  /** Listed in history but already deleted by the time Merit read it. */
  readonly messagesGone: number;
  readonly outreachesUpdated: number;
  /** Follow-up reminders written to the calendar by this sync. */
  readonly followUpsScheduled: number;
  readonly connectionRefreshed: boolean;
}

export type SyncGmailOutreachError = RepositoryUnavailable | GmailUnavailable;

const FOLLOW_UP_DAYS = [3, 7] as const;

const outreachHref = (baseUrl: string, organizationId: string): string =>
  `${baseUrl.replace(/\/$/u, '')}/organizations/${organizationId}/outreach`;

const NOTHING_TO_SYNC: SyncGmailOutreachSummary = {
  connectionFound: false,
  messagesSeen: 0,
  messagesGone: 0,
  outreachesUpdated: 0,
  followUpsScheduled: 0,
  connectionRefreshed: false,
};

export class SyncGmailOutreach {
  constructor(
    private readonly connections: GmailConnectionRepository,
    private readonly outreaches: OutreachRepository,
    private readonly gmail: GmailMailboxGateway,
    private readonly clientId: string,
    private readonly clientSecret: string,
    /** Null when no calendar is connected: the sync still runs, without reminders. */
    private readonly calendar: CalendarGateway | null = null,
    private readonly calendarId: string = 'primary',
    /** Where Merit is reachable, so a reminder can send the reader back to the drafted reply. */
    private readonly appBaseUrl: string = 'http://localhost:3100',
  ) {}

  /**
   * Sync without a push, by asking Gmail where the mailbox is now.
   *
   * A Pub/Sub push cannot reach a laptop, and a tunnel built to receive one proves nothing a
   * direct read does not. Gmail reports the mailbox's current history id, which is exactly what
   * a notification would have carried — so both doors open onto the same walk and the same
   * cursor, and an on-demand sync after a push is a no-op, as is the reverse.
   */
  async syncNow(): Promise<Result<SyncGmailOutreachSummary, SyncGmailOutreachError>> {
    const connectionResult = await this.connections.getConnection('primary');
    if (!connectionResult.ok) return connectionResult;
    if (connectionResult.value === null) return ok(NOTHING_TO_SYNC);

    const refreshed = await maybeRefreshConnection(
      connectionResult.value,
      this.gmail,
      this.clientId,
      this.clientSecret,
    );
    if (!refreshed.ok) return refreshed;

    // Persisted before the profile call, so `execute` below reads the live token rather than
    // spending a second refresh on the expired one still in the database.
    if (refreshed.value.refreshed) {
      const saved = await this.connections.saveConnection(refreshed.value.connection);
      if (!saved.ok) return saved;
    }

    const profile = await this.gmail.getProfile(refreshed.value.connection.accessToken);
    if (!profile.ok) return profile;

    return this.execute({
      emailAddress: profile.value.emailAddress,
      historyId: profile.value.historyId,
    });
  }

  async execute(
    input: GmailPushNotification,
  ): Promise<Result<SyncGmailOutreachSummary, SyncGmailOutreachError>> {
    const connectionResult = await this.connections.getConnection('primary');
    if (!connectionResult.ok) return connectionResult;
    if (connectionResult.value === null) return ok(NOTHING_TO_SYNC);

    const connection = connectionResult.value;
    if (connection.emailAddress !== input.emailAddress) return ok(NOTHING_TO_SYNC);

    const refreshed = await maybeRefreshConnection(connection, this.gmail, this.clientId, this.clientSecret);
    if (!refreshed.ok) return refreshed;
    const liveConnection = refreshed.value.connection;

    if (compareHistoryIds(input.historyId, liveConnection.lastSyncedHistoryId) <= 0) {
      return ok({
        connectionFound: true,
        messagesSeen: 0,
        messagesGone: 0,
        outreachesUpdated: 0,
        followUpsScheduled: 0,
        connectionRefreshed: refreshed.value.refreshed,
      });
    }

    const history = await this.gmail.listHistory({
      accessToken: liveConnection.accessToken,
      startHistoryId: liveConnection.lastSyncedHistoryId,
    });
    if (!history.ok) return history;

    let messagesSeen = 0;
    let messagesGone = 0;
    let outreachesUpdated = 0;
    let followUpsScheduled = 0;

    for (const record of history.value.history) {
      for (const changed of record.messages) {
        const detail = await this.gmail.getMessage({
          accessToken: liveConnection.accessToken,
          messageId: changed.id,
        });
        if (!detail.ok) return detail;

        // Deleted between the history record and this read. Stopping here would also leave the
        // cursor unmoved, so every later sync would return to the same dead message.
        if (detail.value === null) {
          messagesGone += 1;
          continue;
        }

        messagesSeen += 1;
        const message = detail.value;
        const from = emailAddressIn(headerValue(message.headers, 'From'));
        const to = emailAddressIn(headerValue(message.headers, 'To'));
        const subject = headerValue(message.headers, 'Subject');

        const ours = from === liveConnection.emailAddress.toLowerCase();
        const sentByUs = message.labelIds.includes('SENT') || ours;

        if (sentByUs) {
          const matched = await matchDraft(this.outreaches, subject, to);
          if (matched.ok && matched.value !== null) {
            // Two reminders, once. The stored timestamp is the guard: a second sighting of the
            // same sent message must not put a second pair on the calendar.
            const scheduled =
              matched.value.followUpsScheduledAt === null
                ? await this.scheduleFollowUps(matched.value, message.threadId)
                : ok(matched.value.followUpsScheduledAt);
            if (!scheduled.ok) return scheduled;
            if (matched.value.followUpsScheduledAt === null && scheduled.value !== null) {
              followUpsScheduled += 2;
            }

            const updated = await this.outreaches.upsertOutreach({
              ...matched.value,
              status: 'sent',
              gmailMessageId: message.id,
              gmailThreadId: message.threadId,
              lastSyncedAt: new Date().toISOString(),
              followUpsScheduledAt: scheduled.value,
            });
            if (!updated.ok) return updated;
            outreachesUpdated += 1;
          }
        }

        // Not `!ours` alone: a message we sent carries our own address in From, and reading a
        // display-name header as a stranger is exactly what marked our own mail as a reply.
        if (!sentByUs) {
          const matched = await matchThread(this.outreaches, message.threadId);
          if (matched.ok && matched.value !== null) {
            const updated = await this.outreaches.upsertOutreach({
              ...matched.value,
              status: followUpNeeded(message.snippet) ? 'follow_up_needed' : 'replied',
              gmailThreadId: message.threadId,
              lastSyncedAt: new Date().toISOString(),
            });
            if (!updated.ok) return updated;
            outreachesUpdated += 1;
          }
        }
      }
    }

    const savedConnection = await this.connections.saveConnection({
      ...liveConnection,
      lastSyncedHistoryId: history.value.historyId,
      lastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (!savedConnection.ok) return savedConnection;

    return ok({
      connectionFound: true,
      messagesSeen,
      messagesGone,
      outreachesUpdated,
      followUpsScheduled,
      connectionRefreshed: refreshed.value.refreshed,
    });
  }

  /**
   * Two calendar reminders for a letter that has just gone out: one at three days, one at seven.
   *
   * Each carries a link straight to the Gmail thread, because a reminder that makes you go and
   * find the conversation is a reminder you postpone. Returns null when no calendar is
   * connected — reminders are a convenience, and losing them must not fail the sync that was
   * recording a real send.
   */
  private async scheduleFollowUps(
    outreach: OutreachRecord,
    threadId: string,
  ): Promise<Result<string | null, RepositoryUnavailable>> {
    if (this.calendar === null) return ok(null);

    const sentAt = new Date();
    for (const days of FOLLOW_UP_DAYS) {
      const day = new Date(sentAt.getTime() + days * 24 * 60 * 60 * 1000);
      const startDate = day.toISOString().slice(0, 10);
      const endDate = new Date(day.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const written = await this.calendar.upsertEvent({
        calendarId: this.calendarId,
        idempotencyKey: `outreach:${outreach.organizationId}:${outreach.targetKind}:${outreach.targetId}:${days}d`,
        summary: `Follow up: ${outreach.targetName}`,
        description:
          `${days} days since the letter of inquiry went out.\n\n` +
          // Merit first: it has the follow-up already written, addressed and ready to send,
          // which is the whole reason this reminder is worth opening.
          `Write the follow-up in Merit: ${outreachHref(this.appBaseUrl, outreach.organizationId)}\n` +
          `Or read the thread in Gmail: ${gmailThreadHref(threadId)}\n\n` +
          'Merit never contacts a funder. This is a reminder for you to.',
        startDate,
        endDate,
        timeZone: 'UTC',
      });
      // A calendar that is down loses the reminder, not the record that the letter was sent.
      if (!written.ok) return ok(null);
    }

    return ok(sentAt.toISOString());
  }
}

const maybeRefreshConnection = async (
  connection: GmailConnectionRecord,
  gmail: GmailMailboxGateway,
  clientId: string,
  clientSecret: string,
): Promise<
  Result<{ readonly connection: GmailConnectionRecord; readonly refreshed: boolean }, SyncGmailOutreachError>
> => {
  const expiresAt = Date.parse(connection.accessTokenExpiresAt);
  const needsRefresh = Number.isNaN(expiresAt) || expiresAt - Date.now() < 2 * 60 * 1000;
  if (!needsRefresh) return ok({ connection, refreshed: false });

  const refreshed = await gmail.refreshAccessToken({
    refreshToken: connection.refreshToken,
    clientId,
    clientSecret,
  });
  if (!refreshed.ok) return refreshed;

  const now = new Date().toISOString();
  return ok({
    refreshed: true,
    connection: {
      ...connection,
      accessToken: refreshed.value.accessToken,
      refreshToken: refreshed.value.refreshToken ?? connection.refreshToken,
      tokenType: refreshed.value.tokenType,
      scope: refreshed.value.scope,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.value.expiresInSeconds * 1000).toISOString(),
      updatedAt: now,
    },
  });
};

const compareHistoryIds = (left: string, right: string): number => {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    if (a === b) return 0;
    return a > b ? 1 : -1;
  } catch {
    return left.localeCompare(right);
  }
};

/**
 * The address out of a From/To header.
 *
 * Gmail hands these back as `Nahom Amare <nahom@example.com>`, and comparing that whole string
 * to a bare address is never equal — which is how a message we sent got read as a reply to it.
 */
const emailAddressIn = (header: string | null): string | null => {
  if (header === null) return null;
  const angled = /<([^>]+)>/u.exec(header);
  const address = (angled?.[1] ?? header).trim().toLowerCase();
  return address === '' ? null : address;
};

const headerValue = (
  headers: readonly { readonly name: string; readonly value: string }[],
  name: string,
): string | null => {
  const lower = name.toLowerCase();
  const found = headers.find((header) => header.name.toLowerCase() === lower);
  return found?.value ?? null;
};

const matchDraft = async (
  outreaches: OutreachRepository,
  subject: string | null,
  recipient: string | null,
): Promise<Result<OutreachRecord | null, RepositoryUnavailable>> => {
  const all = await outreaches.listOutreaches();
  if (!all.ok) return all;
  const rows = all.value.filter((row) => row.status === 'draft');
  if (recipient !== null) {
    const recipientMatch = rows.find((row) => row.contactEmail?.toLowerCase() === recipient);
    if (recipientMatch !== undefined) return ok(recipientMatch);
  }
  if (subject !== null) {
    const subjectMatch = rows.find((row) => row.subject === subject);
    if (subjectMatch !== undefined) return ok(subjectMatch);
  }
  return ok(null);
};

const matchThread = async (
  outreaches: OutreachRepository,
  threadId: string,
): Promise<Result<OutreachRecord | null, RepositoryUnavailable>> => {
  const all = await outreaches.listOutreaches();
  if (!all.ok) return all;
  return ok(all.value.find((row) => row.gmailThreadId === threadId) ?? null);
};

const followUpNeeded = (snippet: string): boolean =>
  /follow up|next step|could you|please send|\?$/i.test(snippet);
