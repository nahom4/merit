import { describe, expect, it } from 'vitest';
import { FitAssessment } from '@merit/domain';
import { GeminiGateway, systemClock } from '@merit/infrastructure';
import { geminiEnvelope } from '../support/gemini-fixture-server.js';

/**
 * Gemini is a third-party client, so it gets a contract test like every other one.
 *
 * The live half is gated on a credential being present (docs/testing.md): Merit is designed to
 * run without a model key at all, and requiring one to run the suite would contradict that.
 * `runIf` is a gate, not a quarantine -- with a key set, these run and a drift in the API fails
 * the build exactly as it should.
 *
 * The ungated test below runs always. It keeps the envelope the integration and E2E fixture
 * server speaks pinned to the envelope the gateway parses, so a change to one without the other
 * cannot pass unnoticed even on a machine with no credential.
 */
const API_KEY = process.env['GEMINI_API_KEY'];
const BASE = process.env['GEMINI_BASE_URL'] ?? 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';

const MENU = ['Education', 'Health'];

const request = () => ({
  purpose: 'fit_score',
  priority: 'interactive' as const,
  prompt:
    'An adult literacy nonprofit in Wilmington, North Carolina, with $656,000 of annual revenue, ' +
    'is considering a federal announcement funding adult basic education and workforce literacy ' +
    'programming. Judge the fit.',
  responseContract: FitAssessment.responseContract(MENU),
  parse: (raw: unknown) => FitAssessment.parse(raw, MENU),
});

describe('the Gemini envelope the fixtures speak', () => {
  it('is the envelope the gateway parses', async () => {
    // A local server speaking the fixture envelope, read by the real gateway. If either side
    // of that pair changes, this fails on any machine, credential or not.
    const { createServer } = await import('node:http');
    const payload = JSON.stringify({
      fitScore: 64,
      rationale: 'Adult literacy is the announcement’s stated purpose.',
      matchedProgramAreas: ['Education'],
      gaps: ['No workforce partner is named.'],
    });

    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(geminiEnvelope(payload));
    });
    await new Promise<void>((ready) => server.listen(3218, '127.0.0.1', ready));

    try {
      const result = await new GeminiGateway({
        baseUrl: 'http://127.0.0.1:3218',
        apiKey: 'test-key',
        model: MODEL,
        timeoutMs: 10_000,
        clock: systemClock,
      }).complete(request());

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.value.fitScore : 0).toBe(64);
      expect(result.ok ? result.value.promptTokens : 0).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((closed) => server.close(() => closed()));
    }
  });
});

describe.runIf(API_KEY !== undefined)('Gemini, live', () => {
  it('still returns JSON that satisfies the fit-score contract', async () => {
    const result = await new GeminiGateway({
      baseUrl: BASE,
      apiKey: API_KEY!,
      model: MODEL,
      timeoutMs: 60_000,
      clock: systemClock,
    }).complete(request());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Number.isInteger(result.value.value.fitScore)).toBe(true);
    // The menu is enforced at the parse boundary, so a pass here means the live model chose
    // from the set rather than inventing a program area.
    expect(result.value.value.matchedProgramAreas.every((area) => MENU.includes(area))).toBe(true);
  });

  it('still reports token usage, which the run log’s spend figure is built from', async () => {
    const result = await new GeminiGateway({
      baseUrl: BASE,
      apiKey: API_KEY!,
      model: MODEL,
      timeoutMs: 60_000,
      clock: systemClock,
    }).complete(request());

    expect(result.ok ? result.value.promptTokens : 0).toBeGreaterThan(0);
    expect(result.ok ? result.value.responseTokens : 0).toBeGreaterThan(0);
  });
});
