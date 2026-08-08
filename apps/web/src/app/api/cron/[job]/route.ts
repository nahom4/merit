import { loadConfig } from '@merit/infrastructure';
import { SCHEDULED_JOBS } from '../../../../composition/scheduled';

/**
 * The scheduler's entrypoint. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Hobby crons fire once a day with per-hour precision, which suits work that is idempotent and
 * whose value is measured in days -- a federal sweep, a deadline horizon, a weekly briefing.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = async (request: Request, { params }: { params: { job: string } }): Promise<Response> => {
  const { CRON_SECRET } = loadConfig();
  if (CRON_SECRET === undefined) {
    return Response.json({ error: 'no CRON_SECRET is configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const job = SCHEDULED_JOBS[params.job];
  if (job === undefined) {
    return Response.json({ error: 'unknown job', known: Object.keys(SCHEDULED_JOBS) }, { status: 404 });
  }

  const outcome = await job();
  return outcome.ok
    ? Response.json({ job: params.job, ...outcome.detail })
    : Response.json({ job: params.job, error: outcome.reason }, { status: 500 });
};
