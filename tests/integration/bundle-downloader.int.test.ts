import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isErr, isOk, silentLogger } from '@merit/shared';
import { bundleUrl, downloadBundle } from '@merit/infrastructure';

/**
 * A real HTTP server on a real socket. No fetch mock: the behaviour under test is what
 * happens when a connection dies mid-transfer, which a mock cannot reproduce honestly.
 */
const PAYLOAD = Buffer.from(
  Array.from({ length: 200_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(''),
);

interface Harness {
  readonly baseUrl: string;
  readonly requests: { range: string | undefined }[];
  close(): Promise<void>;
}

const startServer = (handler: Parameters<typeof createServer>[1], requests: Harness['requests']) =>
  new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const server = createServer((request, response) => {
      requests.push({ range: request.headers.range });
      handler?.(request, response);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });

let directory: string;
let servers: Server[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'merit-download-'));
});

afterEach(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
  servers = [];
  rmSync(directory, { recursive: true, force: true });
});

const harness = async (handler: Parameters<typeof createServer>[1]): Promise<Harness> => {
  const requests: Harness['requests'] = [];
  const { server, baseUrl } = await startServer(handler, requests);
  servers.push(server);
  return { baseUrl, requests, close: async () => undefined };
};

const download = (baseUrl: string, overrides: Partial<Parameters<typeof downloadBundle>[0]> = {}) =>
  downloadBundle({
    baseUrl,
    year: 2025,
    part: '01A',
    destinationDirectory: directory,
    timeoutMs: 10_000,
    maxAttempts: 5,
    logger: silentLogger,
    ...overrides,
  });

describe('bundleUrl', () => {
  it('builds the published IRS bundle path', () => {
    expect(bundleUrl('https://apps.irs.gov/pub/epostcard/990/xml', 2025, '01A')).toBe(
      'https://apps.irs.gov/pub/epostcard/990/xml/2025/2025_TEOS_XML_01A.zip',
    );
  });

  it('tolerates a base URL with a trailing slash', () => {
    expect(bundleUrl('https://example.test/xml/', 2025, '05B')).toBe(
      'https://example.test/xml/2025/2025_TEOS_XML_05B.zip',
    );
  });
});

describe('downloadBundle', () => {
  it('downloads a bundle to disk', async () => {
    const server = await harness((_request, response) => {
      response.writeHead(200, { 'content-length': String(PAYLOAD.length) });
      response.end(PAYLOAD);
    });

    const result = await download(server.baseUrl);
    expect(isOk(result) && result.value.bytes).toBe(PAYLOAD.length);
    expect(isOk(result) && readFileSync(result.value.path).equals(PAYLOAD)).toBe(true);
  });

  it('survives a connection dropped mid-transfer and resumes from what it already has', async () => {
    let served = 0;
    const server = await harness((request, response) => {
      served += 1;
      const range = /bytes=(\d+)-/.exec(request.headers.range ?? '');
      const offset = range === null ? 0 : Number(range[1]);

      if (served === 1) {
        // The IRS server does this. Half the body, then the socket dies.
        response.writeHead(200, { 'content-length': String(PAYLOAD.length) });
        // Flush before killing the socket: destroying immediately discards the bytes
        // before they leave the server, which is not what a dropped connection looks like.
        response.write(PAYLOAD.subarray(0, 90_000), () => setTimeout(() => response.destroy(), 50));
        return;
      }
      response.writeHead(
        offset > 0 ? 206 : 200,
        offset > 0
          ? { 'content-range': `bytes ${offset}-${PAYLOAD.length - 1}/${PAYLOAD.length}` }
          : { 'content-length': String(PAYLOAD.length) },
      );
      response.end(PAYLOAD.subarray(offset));
    });

    const result = await download(server.baseUrl);

    expect(isOk(result) && result.value.resumed).toBe(true);
    expect(isOk(result) && readFileSync(result.value.path).equals(PAYLOAD)).toBe(true);
  });

  it('asks the server to continue rather than restarting the transfer', async () => {
    let served = 0;
    const server = await harness((request, response) => {
      served += 1;
      const range = /bytes=(\d+)-/.exec(request.headers.range ?? '');
      const offset = range === null ? 0 : Number(range[1]);
      if (served === 1) {
        response.writeHead(200, { 'content-length': String(PAYLOAD.length) });
        // Flush before killing the socket: destroying immediately discards the bytes
        // before they leave the server, which is not what a dropped connection looks like.
        response.write(PAYLOAD.subarray(0, 90_000), () => setTimeout(() => response.destroy(), 50));
        return;
      }
      response.writeHead(206, {
        'content-range': `bytes ${offset}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
      });
      response.end(PAYLOAD.subarray(offset));
    });

    await download(server.baseUrl);

    expect(server.requests[0]?.range).toBeUndefined();
    expect(server.requests[1]?.range).toBe('bytes=90000-');
  });

  it('restarts cleanly when the server ignores the range header', async () => {
    let served = 0;
    const server = await harness((_request, response) => {
      served += 1;
      if (served === 1) {
        response.writeHead(200);
        // Flush before killing the socket: destroying immediately discards the bytes
        // before they leave the server, which is not what a dropped connection looks like.
        response.write(PAYLOAD.subarray(0, 90_000), () => setTimeout(() => response.destroy(), 50));
        return;
      }
      // Range ignored: a full 200 with the whole body. Appending would corrupt the archive.
      response.writeHead(200);
      response.end(PAYLOAD);
    });

    const result = await download(server.baseUrl);
    expect(isOk(result) && readFileSync(result.value.path).equals(PAYLOAD)).toBe(true);
  });

  it('retries a server error and succeeds when the server recovers', async () => {
    let served = 0;
    const server = await harness((_request, response) => {
      served += 1;
      if (served < 3) {
        response.writeHead(503);
        response.end();
        return;
      }
      response.writeHead(200);
      response.end(PAYLOAD);
    });

    const result = await download(server.baseUrl);
    expect(isOk(result) && result.value.attempts).toBe(3);
  });

  it('reports failure as a value after exhausting its attempts', async () => {
    const server = await harness((_request, response) => {
      response.writeHead(500);
      response.end();
    });

    const result = await download(server.baseUrl, { maxAttempts: 2 });
    expect(isErr(result) && result.error.code).toBe('bundle_download_failed');
    expect(isErr(result) && result.error.context['attempts']).toBe(2);
  });

  it('leaves no file that looks complete when the download never finished', async () => {
    const server = await harness((_request, response) => {
      response.writeHead(500);
      response.end();
    });

    await download(server.baseUrl, { maxAttempts: 2 });
    expect(existsSync(join(directory, '2025_TEOS_XML_01A.zip'))).toBe(false);
  });

  it('does not re-download a bundle already on disk', async () => {
    writeFileSync(join(directory, '2025_TEOS_XML_01A.zip'), PAYLOAD);
    const server = await harness((_request, response) => {
      response.writeHead(200);
      response.end(PAYLOAD);
    });

    const result = await download(server.baseUrl);
    expect(isOk(result) && result.value.attempts).toBe(0);
    expect(server.requests).toHaveLength(0);
  });
});
