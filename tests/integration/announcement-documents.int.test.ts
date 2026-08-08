import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewSectionOf, Rubric } from '@merit/domain';
import { GrantsGovAttachmentGateway } from '@merit/infrastructure';

/**
 * Real HTTP over a real socket, real PDF bytes, and the real `pdftotext` binary. Nothing here
 * is stubbed, which is the point: the thing being proved is that a genuine 60-page federal
 * announcement survives download and layout extraction with its scoring table still legible.
 *
 * The fixture is HHS-2026-ACF-OCS-EAH-0027, attachment 354136, recorded from the live service
 * on 8 August 2026 — 303,791 bytes of `application/pdf`. Its rubric is a seven-row table whose
 * points sum to exactly the 115 the document states, which makes it the one document that can
 * prove the arithmetic confidence check works on something nobody wrote for the test.
 */
const PDF = readFileSync(
  resolve('tests/fixtures/grants-gov/attachments/354136-hhs-2026-acf-ocs-eah-0027.pdf'),
);

let server: Server;
let baseUrl: string;

/** Serves the real bytes, and a few deliberate failures, on a real port. */
beforeAll(async () => {
  server = createServer((request, response) => {
    const id = (request.url ?? '').split('/').pop() ?? '';

    if (id === '354136') {
      response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': PDF.byteLength });
      return response.end(PDF);
    }
    if (id === 'not-a-pdf') {
      response.writeHead(200, { 'content-type': 'application/pdf' });
      return response.end('This is plain text wearing a PDF content type.');
    }
    if (id === 'enormous') {
      response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': '999999999' });
      return response.end(PDF);
    }
    return void response.writeHead(404).end('not found');
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}/att/download`;
});

afterAll(async () => {
  await new Promise<void>((closed) => server.close(() => closed()));
});

const gateway = (overrides: Partial<{ maxBytes: number }> = {}) =>
  new GrantsGovAttachmentGateway({ baseUrl, timeoutMs: 20_000, ...overrides });

describe('GrantsGovAttachmentGateway', () => {
  it('downloads a real announcement and extracts its text', async () => {
    const result = await gateway().fetchText('354136');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(50_000);
    expect(result.value).toContain('Notice of Funding Opportunity');
  });

  it('preserves the layout, so the scoring table keeps its columns', async () => {
    // The whole reason for `-layout`. In reading order this table collapses into
    // "Purpose and need 10 Response 50" with no way to tell which number belongs to which row.
    const result = await gateway().fetchText('354136');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatch(/1\. Purpose and need\s{2,}10 points/u);
    expect(result.value).toMatch(/2\. Response\s{2,}50 points/u);
  });

  it('reports a file with no text layer rather than returning an empty document', async () => {
    // A scanned announcement is common, `pdftotext` exits 0 on it, and what comes back is
    // whitespace. Calling that a successful read would send an empty document to the extractor
    // and get back a confident rubric about nothing.
    const result = await gateway().fetchText('not-a-pdf');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('document_unavailable');
  });

  it('refuses a file over the size ceiling rather than buffering it', async () => {
    const result = await gateway({ maxBytes: 1_000 }).fetchText('enormous');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('over the');
  });

  it('reports a missing attachment as unavailable, not as an empty document', async () => {
    const result = await gateway().fetchText('does-not-exist');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.context['status']).toBe(404);
  });
});

describe('the extracted text, fed to the real windowing and parse', () => {
  it('windows onto the criteria table with the stated total intact', async () => {
    const extracted = await gateway().fetchText('354136');
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const window = reviewSectionOf(extracted.value, 12_000);

    expect(window.headingFound).toBe(true);
    // The total is what `Rubric.parse` checks the extracted criteria against. A window that
    // wins the criteria and loses the total caps every extraction's confidence at 0.4.
    expect(window.text).toContain('Total number of');
    for (const criterion of ['Purpose and need', 'Response', 'Impact', 'Resources and capabilities']) {
      expect(window.text).toContain(criterion);
    }
  });

  it('accepts the announcement’s real criteria at full confidence, because they add up', async () => {
    // Transcribed from the fixture's own table: 10 + 50 + 15 + 15 + 10 + 10 + 5 = 115, which is
    // the total it states. This is the arithmetic check passing on a document nobody wrote for
    // the test — the case the unit tests can only simulate.
    const parsed = Rubric.parse({
      confidence: 0.9,
      totalPointsStated: 115,
      criteria: [
        { id: '1', name: 'Purpose and need', points: 10, subCriteria: [] },
        { id: '2', name: 'Response', points: 50, subCriteria: [] },
        { id: '3', name: 'Impact', points: 15, subCriteria: [] },
        { id: '4', name: 'Resources and capabilities', points: 15, subCriteria: [] },
        { id: '5', name: 'Line-item budget and budget narrative', points: 10, subCriteria: [] },
        { id: '6', name: 'ACF Priority Alignment', points: 10, subCriteria: [] },
        { id: '7', name: 'Bonus Points', points: 5, subCriteria: [] },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.totalPoints).toBe(115);
    expect(parsed.value.confidence).toBe(0.9);
  });
});
