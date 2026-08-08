import { join } from 'node:path';
import { UnknownSchemaVersion } from '@merit/shared';
import { IngestBundle, type FilingSource } from '@merit/application';
import { downloadBundle, parseFiling, streamBundle } from '@merit/infrastructure';
import { wire } from '../composition.js';

/**
 * Above this share of unreadable filings in one bundle, the run stops. Below it, each one is
 * logged by object id and counted.
 */
const SCHEMA_FAULT_CEILING = 0.001;

/** The 2025 corpus is published as thirteen bundles. 05 is split into two parts. */
export const CORPUS_PARTS = [
  '01A',
  '02A',
  '03A',
  '04A',
  '05A',
  '05B',
  '06A',
  '07A',
  '08A',
  '09A',
  '10A',
  '11A',
  '12A',
] as const;

/**
 * Downloads and ingests the whole corpus, one bundle at a time.
 *
 * Bundles are processed sequentially and their zips are kept on disk: a re-run resumes from
 * the checkpoints rather than re-downloading 3GB. Each bundle is a separate checkpoint, so
 * a kill at any point costs at most one bundle's worth of unflushed progress.
 */
export const ingestCorpus = async (parts: readonly string[] = CORPUS_PARTS): Promise<void> => {
  const { config, logger, grants } = await wire();
  const ingest = new IngestBundle(grants, logger);
  const directory = join(config.MERIT_DATA_DIR, 'bundles');

  for (const part of parts) {
    const bundleName = `${config.IRS_CORPUS_YEAR}-${part}`;

    const downloaded = await downloadBundle({
      baseUrl: config.IRS_BUNDLE_BASE_URL,
      year: config.IRS_CORPUS_YEAR,
      part,
      destinationDirectory: directory,
      timeoutMs: config.HTTP_TIMEOUT_MS,
      logger,
    });
    if (!downloaded.ok) {
      logger.error('skipping bundle that could not be downloaded', downloaded.error.toJSON().context);
      continue;
    }

    let schemaFaults = 0;
    let filingsRead = 0;

    const source: FilingSource = {
      bundle: bundleName,
      async *filings() {
        for await (const entry of streamBundle(downloaded.value.path)) {
          filingsRead += 1;
          let filing;
          try {
            filing = parseFiling(entry.xml, entry.irsObjectId);
          } catch (cause) {
            if (!(cause instanceof UnknownSchemaVersion)) throw cause;
            // One filing we cannot read must not cost the other 200MB of the bundle. This is
            // not a silent fallback: the filing is named at error level, counted, and the
            // job fails below if the rate suggests the schema itself moved under us.
            schemaFaults += 1;
            logger.error('filing could not be read; recorded and skipped', cause.toJSON().context);
            continue;
          }
          yield {
            irsObjectId: filing.irsObjectId,
            grants: filing.grants,
            parseFaults: filing.parseFaults,
            statedTotalCents: filing.statedTotalCents,
            grantsToIndividualsCents: filing.grantsToIndividualsCents,
          };
        }
      },
    };

    const result = await ingest.execute(source);
    if (!result.ok) {
      // Interruption is expected on this corpus. The checkpoint is durable, so the next run
      // continues from here rather than starting the bundle again.
      logger.error('bundle ingest did not complete', result.error.toJSON().context);
      continue;
    }
    logger.info('bundle complete', {
      bundle: bundleName,
      filings: result.value.filingsSeen,
      grants: result.value.grantsWritten,
      parseFaults: result.value.parseFaults,
      reconciliationFaults: result.value.reconciliationFaults,
      schemaFaults,
    });

    // A handful of odd filings is the corpus being the corpus. A percent of them is the IRS
    // having changed the schema, and carrying on would quietly lose a whole bundle's worth
    // of grants.
    if (filingsRead > 0 && schemaFaults / filingsRead > SCHEMA_FAULT_CEILING) {
      throw new Error(
        `${schemaFaults} of ${filingsRead} filings in ${bundleName} could not be read. ` +
          'That is not noise -- the schema has probably changed. Extractors need updating.',
      );
    }
  }
};
