import { createReadStream } from 'node:fs';
import yauzl from 'yauzl';
import { UnknownSchemaVersion } from '@merit/shared';

export interface BundleEntry {
  /** The IRS object id, which is the entry filename without its `_public.xml` suffix. */
  readonly irsObjectId: string;
  readonly xml: string;
}

/** ZIP compression method 9. Node's zlib cannot inflate it, and an entry silently skipped
 *  would look exactly like a bundle with no grants in it. */
const DEFLATE64 = 9;
const STORED = 0;
const DEFLATE = 8;

/**
 * Streams the filing documents out of an IRS bundle, one at a time.
 *
 * A bundle is 70-210MB compressed and expands to several hundred megabytes across tens of
 * thousands of documents. Nothing here holds more than one document, so a free-tier instance
 * can process the whole corpus.
 */
export async function* streamBundle(zipPath: string): AsyncGenerator<BundleEntry> {
  const zip = await open(zipPath);
  try {
    for await (const entry of entries(zip)) {
      if (entry.fileName.endsWith('/')) continue;
      if (!entry.fileName.endsWith('.xml')) continue;

      if (entry.compressionMethod === DEFLATE64) {
        // An earlier validation run skipped every entry in Deflate64 bundles and reported
        // zero grants. Raising is the whole point: a zero must never be indistinguishable
        // from a parse failure.
        throw new UnknownSchemaVersion('bundle entry uses Deflate64, which cannot be inflated here', {
          zipPath,
          entry: entry.fileName,
          compressionMethod: entry.compressionMethod,
        });
      }
      if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATE) {
        throw new UnknownSchemaVersion('bundle entry uses an unsupported compression method', {
          zipPath,
          entry: entry.fileName,
          compressionMethod: entry.compressionMethod,
        });
      }

      yield {
        irsObjectId: basename(entry.fileName)
          .replace(/_public\.xml$/i, '')
          .replace(/\.xml$/i, ''),
        xml: await readEntry(zip, entry),
      };
    }
  } finally {
    zip.close();
  }
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const open = (zipPath: string): Promise<yauzl.ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipFile) => {
      if (error !== null || zipFile === undefined) reject(error ?? new Error('zip did not open'));
      else resolve(zipFile);
    });
  });

/** yauzl is event-driven and lazy; this turns it into something `for await` can drive. */
async function* entries(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  const pending: yauzl.Entry[] = [];
  let done = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;

  const notify = () => {
    wake?.();
    wake = null;
  };

  zip.on('entry', (entry: yauzl.Entry) => {
    pending.push(entry);
    notify();
  });
  zip.on('end', () => {
    done = true;
    notify();
  });
  zip.on('error', (error: Error) => {
    failure = error;
    done = true;
    notify();
  });

  zip.readEntry();
  while (true) {
    if (failure !== null) throw failure;
    const next = pending.shift();
    if (next !== undefined) {
      yield next;
      zip.readEntry();
      continue;
    }
    if (done) return;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

const readEntry = (zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> =>
  new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) {
        reject(error ?? new Error(`could not read ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  });

export { createReadStream };
