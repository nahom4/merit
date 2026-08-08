import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrganization, listOutreaches, gmailConnections } from '../../../../composition/container.js';
import { SyncNowButton } from '../../../../features/outreach-tracking/components/sync-now-button.js';
import { buildOutreachRowView } from '../../../../features/outreach-tracking/view-model.js';

export const dynamic = 'force-dynamic';

export default async function OutreachPage({ params }: { params: { id: string } }) {
  const organization = await getOrganization().execute({ organizationId: params.id });
  if (!organization.ok) {
    if (organization.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const outreaches = await listOutreaches().execute({ organizationId: params.id });
  if (!outreaches.ok) return <Unavailable />;

  const connection = await gmailConnections().getConnection('primary');
  if (!connection.ok) return <Unavailable />;

  return (
    <section className="grid gap-8">
      <div className="shell-card p-6 sm:p-8">
        <Link href={`/organizations/${params.id}`} className="text-sm font-medium text-accent">
          ← Back to {organization.value.name}
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="soft-label">Outreach list</span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">Pursued funders and grants</h1>
            <p className="mt-2 max-w-prose text-sm leading-7 text-muted">
              Every pursuit in one place: foundation letters with what Gmail has synced back, and federal
              applications from the day work starts to the day you submit.
            </p>
          </div>
          <div className="grid justify-items-end gap-2 text-right">
            <span className="soft-label">
              {connection.value === null
                ? 'Gmail not connected'
                : `Gmail connected · ${connection.value.emailAddress}`}
            </span>
            <a
              href="/api/gmail/oauth/start"
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accentStrong"
            >
              {connection.value === null ? 'Connect Gmail' : 'Reconnect Gmail'}
            </a>
            {connection.value === null ? null : <SyncNowButton />}
            {connection.value === null || connection.value.watchTopicName !== null ? null : (
              <p className="max-w-xs text-xs leading-6 text-muted">
                No Pub/Sub topic is configured, so Gmail cannot push changes here. Statuses update when you
                press Sync now.
              </p>
            )}
          </div>
        </div>
      </div>

      {outreaches.value.length === 0 ? (
        <p className="panel p-5 text-sm leading-7 text-muted">
          No outreach has been saved yet. Open a funder letter, save a recipient, and send from Gmail.
        </p>
      ) : (
        <div className="grid gap-4">
          {outreaches.value
            .map((outreach) =>
              buildOutreachRowView({
                outreach,
                organizationName: organization.value.name,
                now: new Date(),
              }),
            )
            .map((row) => (
              <article key={row.key} className="panel p-5" data-testid="outreach-row">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="soft-label">{row.statusLabel}</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight">{row.targetName}</h2>
                    <p className="mt-2 text-sm text-muted">{row.contactLabel}</p>
                  </div>
                  <div className="text-right text-xs text-muted">
                    <div>Saved {row.savedAt}</div>
                    {row.lastSyncedAt === null ? null : <div>Synced {row.lastSyncedAt}</div>}
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 text-muted">{row.subject}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {row.nextAction === null ? null : (
                    <a
                      href={row.nextAction.href}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accentStrong"
                      data-testid="next-action"
                    >
                      {row.nextAction.label}
                    </a>
                  )}
                  {row.threadHref === null ? null : (
                    <a
                      href={row.threadHref}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
                      data-testid="thread-link"
                    >
                      Open the conversation
                    </a>
                  )}
                  <Link
                    href={
                      row.isFederal
                        ? `/organizations/${params.id}/opportunities/${row.targetId}/draft`
                        : `/organizations/${params.id}/funders/${row.targetId}/letter`
                    }
                    className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
                  >
                    Open draft
                  </Link>
                </div>
              </article>
            ))}
        </div>
      )}
    </section>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so outreach could not be loaded. Nothing was lost.
  </p>
);
