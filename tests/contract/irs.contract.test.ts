import { describe, expect, it } from 'vitest';

/**
 * The schemas Merit parses are not ours, and they drift.
 *
 * These call the live IRS endpoints and assert that the fields the extractors depend on still
 * exist with the shapes expected. They run nightly and on demand, never on the PR path: an
 * IRS outage must not block a merge (docs/testing.md).
 *
 * A failure here is real news — the source changed, and the nightly workflow opens an issue.
 */
const BUNDLE_BASE = 'https://apps.irs.gov/pub/epostcard/990/xml';
const BMF_BASE = 'https://www.irs.gov/pub/irs-soi';
const YEAR = 2025;

const TIMEOUT = 60_000;

const head = async (url: string): Promise<Response> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT);
  try {
    return await fetch(url, { method: 'HEAD', signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
};

describe('IRS bulk 990 bundles', () => {
  it('still publishes the bundle at the path the downloader builds', async () => {
    const response = await head(`${BUNDLE_BASE}/${YEAR}/${YEAR}_TEOS_XML_01A.zip`);
    expect(response.status).toBe(200);
  });

  it('serves the bundle as a zip archive', async () => {
    const response = await head(`${BUNDLE_BASE}/${YEAR}/${YEAR}_TEOS_XML_01A.zip`);
    expect(response.headers.get('content-type')).toContain('zip');
  });

  it('declares a content length, which the downloader checks a transfer against', async () => {
    const response = await head(`${BUNDLE_BASE}/${YEAR}/${YEAR}_TEOS_XML_01A.zip`);
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(10_000_000);
  });

  it('supports range requests, which is what makes a dropped transfer resumable', async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT);
    try {
      const response = await fetch(`${BUNDLE_BASE}/${YEAR}/${YEAR}_TEOS_XML_01A.zip`, {
        headers: { Range: 'bytes=0-1023' },
        signal: abort.signal,
      });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toMatch(/^bytes 0-1023\/\d+$/);
      await response.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
  });

  it('needs no key, no registration, and no credit card', async () => {
    // The free-tier constraint is a hard one. If this ever needs a header, the design changes.
    const response = await head(`${BUNDLE_BASE}/${YEAR}/${YEAR}_TEOS_XML_01A.zip`);
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});

describe('IRS Exempt Organizations Business Master File', () => {
  it('still publishes all four regional files', async () => {
    for (const region of ['eo1', 'eo2', 'eo3', 'eo4']) {
      const response = await head(`${BMF_BASE}/${region}.csv`);
      expect(response.status, `${region}.csv`).toBe(200);
    }
  });

  it('still carries every column the registry loader reads', async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT);
    try {
      // The header is the first few hundred bytes; there is no need to pull 49MB for it.
      const response = await fetch(`${BMF_BASE}/eo4.csv`, {
        headers: { Range: 'bytes=0-2047' },
        signal: abort.signal,
      });
      const header = (await response.text()).split('\n')[0] ?? '';
      const columns = header.trim().toUpperCase().split(',');

      for (const required of ['EIN', 'NAME', 'CITY', 'STATE', 'ZIP', 'REVENUE_AMT', 'NTEE_CD']) {
        expect(columns, `BMF header lost ${required}`).toContain(required);
      }
    } finally {
      clearTimeout(timer);
    }
  });
});
