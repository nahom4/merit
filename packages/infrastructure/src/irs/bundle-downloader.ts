import { createWriteStream } from 'node:fs';
import { mkdir, stat, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

import { DomainError, err, ok, type Logger, type Result } from '@merit/shared';

export class BundleDownloadFailed extends DomainError {
  readonly code = 'bundle_download_failed';
}

export interface BundleDownloadOptions {
  readonly baseUrl: string;
  readonly year: number;
  readonly part: string;
  readonly destinationDirectory: string;
  readonly timeoutMs: number;
  readonly maxAttempts?: number;
  readonly logger: Logger;
  /** Injected for tests. Nothing else in the codebase may reach for `fetch` directly. */
  readonly fetchImpl?: typeof fetch;
}

export interface DownloadedBundle {
  readonly path: string;
  readonly bytes: number;
  readonly attempts: number;
  readonly resumed: boolean;
}

export const bundleUrl = (baseUrl: string, year: number, part: string): string =>
  `${baseUrl.replace(/\/$/, '')}/${year}/${year}_TEOS_XML_${part}.zip`;

const sizeOf = async (path: string): Promise<number> => {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
};

/**
 * Downloads one IRS bundle, resuming rather than restarting.
 *
 * The IRS server drops connections mid-transfer on large bundles -- this is not defensive
 * programming, it happened repeatedly during the live validation run. A restart would throw
 * away up to 200MB of transfer each time, so partial progress is kept on disk and continued
 * with a Range request.
 *
 * The file lands at `<part>.zip.partial` and is renamed only once the transfer is complete,
 * so a killed process can never leave a truncated file that looks finished.
 */
export const downloadBundle = async (
  options: BundleDownloadOptions,
): Promise<Result<DownloadedBundle, BundleDownloadFailed>> => {
  const { baseUrl, year, part, destinationDirectory, timeoutMs, logger } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? 8;

  const url = bundleUrl(baseUrl, year, part);
  const finalPath = join(destinationDirectory, `${year}_TEOS_XML_${part}.zip`);
  const partialPath = `${finalPath}.partial`;
  await mkdir(dirname(finalPath), { recursive: true });

  const alreadyHave = await sizeOf(finalPath);
  if (alreadyHave > 0) {
    logger.info('bundle already downloaded', { part, bytes: alreadyHave });
    return ok({ path: finalPath, bytes: alreadyHave, attempts: 0, resumed: false });
  }

  let attempts = 0;
  let resumed = false;
  let lastError = 'no attempt made';

  while (attempts < maxAttempts) {
    attempts += 1;
    const offset = await sizeOf(partialPath);
    if (offset > 0) resumed = true;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: abort.signal,
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      });

      let expectedTotal: number | null = null;

      if (offset > 0 && response.status === 200) {
        // The server ignored the Range header and is sending the whole file again. Starting
        // over is correct here -- appending would corrupt the archive.
        logger.warn('server ignored range request; restarting transfer', { part, offset });
        expectedTotal = declaredTotal(response, 0);
        await writeFrom(response, partialPath, 0);
      } else if (response.status === 206 || response.status === 200) {
        expectedTotal = declaredTotal(response, response.status === 206 ? offset : 0);
        await writeFrom(response, partialPath, offset);
      } else if (response.status === 416) {
        // Requested range beyond the file: what is on disk is already the whole bundle.
        logger.info('range not satisfiable; treating partial file as complete', { part, offset });
      } else {
        lastError = `HTTP ${response.status}`;
        logger.warn('bundle request failed', { part, status: response.status, attempt: attempts });
        await backoff(attempts);
        continue;
      }

      const bytes = await sizeOf(partialPath);
      if (bytes === 0) {
        lastError = 'transfer produced no bytes';
        await backoff(attempts);
        continue;
      }

      // A socket that dies mid-body does not always surface as an error -- the stream simply
      // ends. Without this check a truncated bundle is renamed into place and only fails
      // much later, as an unreadable zip, with the partial progress already thrown away.
      if (expectedTotal !== null && bytes < expectedTotal) {
        lastError = `transfer ended early: ${bytes} of ${expectedTotal} bytes`;
        logger.warn('transfer ended short of the declared length; will resume', {
          part,
          bytes,
          expectedTotal,
          attempt: attempts,
        });
        await backoff(attempts);
        continue;
      }

      await rename(partialPath, finalPath);
      logger.info('bundle downloaded', { part, bytes, attempts, resumed });
      return ok({ path: finalPath, bytes, attempts, resumed });
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      logger.warn('transfer interrupted; will resume from what is on disk', {
        part,
        attempt: attempts,
        bytesOnDisk: await sizeOf(partialPath),
        reason: lastError,
      });
      await backoff(attempts);
    } finally {
      clearTimeout(timer);
    }
  }

  return err(
    new BundleDownloadFailed('bundle could not be downloaded after repeated attempts', {
      part,
      url,
      attempts,
      lastError,
    }),
  );
};

/**
 * How many bytes the file should hold once this response has been written. `Content-Range`
 * states the whole size; `Content-Length` states only what is on the wire, so a resumed
 * transfer adds the offset back on.
 */
const declaredTotal = (response: Response, offset: number): number | null => {
  const contentRange = response.headers.get('content-range');
  const total = contentRange === null ? null : /\/(\d+)$/.exec(contentRange)?.[1];
  if (total !== undefined && total !== null) return Number(total);

  const length = response.headers.get('content-length');
  return length === null ? null : Number(length) + offset;
};

/**
 * Writes the body to disk chunk by chunk, keeping whatever arrived before a failure.
 *
 * `stream.pipeline` is the obvious choice and the wrong one here: when the source errors it
 * destroys the sink, discarding the buffered bytes. That turns every dropped connection into
 * a restart from zero, which for a 200MB bundle on a flaky server means never finishing.
 */
const writeFrom = async (response: Response, path: string, offset: number): Promise<void> => {
  if (response.body === null) throw new Error('response had no body');
  const sink = createWriteStream(path, offset > 0 ? { flags: 'a' } : { flags: 'w' });
  try {
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    for await (const chunk of source) {
      await new Promise<void>((resolve, reject) => {
        sink.write(chunk as Uint8Array, (error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    await new Promise<void>((resolve) => sink.end(resolve));
  }
};

/** Exponential backoff with jitter. A fixed delay synchronises every retry against a server
 *  that is already struggling. */
const backoff = (attempt: number): Promise<void> => {
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
  const jitter = base * 0.25 * Math.random();
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
};
