import { consoleLogger } from '@merit/shared';
import { ingestCorpus } from './jobs/ingest-corpus.job.js';
import { loadBmf } from './jobs/load-bmf.job.js';
import { resolveRecipients } from './jobs/resolve-recipients.job.js';
import { sweepFederal } from './jobs/sweep-federal.job.js';

/**
 * The offline pipeline's entrypoint. A composition root: it maps a job name to a use case
 * and owns no logic of its own.
 */
const JOBS: Record<string, (args: readonly string[]) => Promise<void>> = {
  ingest: (args) => ingestCorpus(args.length > 0 ? args : undefined),
  'load-bmf': () => loadBmf(),
  resolve: (args) => resolveRecipients(args),
  'sweep-federal': () => sweepFederal(),
};

const [job, ...args] = process.argv.slice(2);

if (job === undefined || JOBS[job] === undefined) {
  consoleLogger.error('unknown job', { job: job ?? 'none', known: Object.keys(JOBS).join(', ') });
  process.exit(1);
}

await JOBS[job]!(args);
