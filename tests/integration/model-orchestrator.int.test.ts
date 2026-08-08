import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { FitAssessment } from '@merit/domain';
import type { ModelRequest } from '@merit/application';
import {
  GeminiGateway,
  LibsqlModelCallLog,
  LibsqlModelResponseCache,
  ModelOrchestrator,
  systemClock,
  TokenBucket,
} from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';
import { geminiEnvelope, startGeminiFixtureServer } from '../support/gemini-fixture-server.js';

/**
 * The model path against real infrastructure: a real HTTP server on a socket, a real libSQL
 * cache and call log. What is being proved is that the repair loop re-prompts with the exact
 * validation error, that an invalid answer never reaches the database, and that the cache and
 * the run log's numbers survive a process boundary.
 */
/** A port per harness. A closed server leaves keep-alive sockets in fetch's pool, and reusing
 *  the port hands the next test a dead connection rather than a fresh server. */
let nextPort = 3212;
const MENU = ['Education'];

const GOOD = JSON.stringify({
  fitScore: 71,
  rationale: 'The announcement funds adult literacy programming.',
  matchedProgramAreas: ['Education'],
  gaps: ['No evaluation partner is named in the profile.'],
});

const request = (prompt = 'score this announcement'): ModelRequest<FitAssessment> => ({
  purpose: 'fit_score',
  priority: 'interactive',
  prompt,
  responseContract: FitAssessment.responseContract(MENU),
  parse: (raw) => FitAssessment.parse(raw, MENU),
});

let open: { database: FreshDatabase; server: Server } | null = null;

const harness = async (replies: readonly (string | { status: number; body: string })[]) => {
  const database = await freshDatabase();
  const port = nextPort++;
  const { server, prompts } = await startGeminiFixtureServer(port, { replies });
  open = { database, server };

  const orchestrator = new ModelOrchestrator(
    new GeminiGateway({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      timeoutMs: 5_000,
      clock: systemClock,
    }),
    {
      bucket: new TokenBucket({ perMinute: 15, perDay: 1_500, clock: systemClock }),
      cache: new LibsqlModelResponseCache(database.db, systemClock),
      log: new LibsqlModelCallLog(database.db),
      clock: systemClock,
      model: 'gemini-2.5-flash',
    },
  );

  return { database, orchestrator, prompts };
};

afterEach(async () => {
  if (open === null) return;
  await new Promise<void>((closed) => open!.server.close(() => closed()));
  await open.database.destroy();
  open = null;
});

describe('the model path, end to end', () => {
  it('parses a valid answer and stores nothing else', async () => {
    const { orchestrator, prompts } = await harness([geminiEnvelope(GOOD)]);

    const result = await orchestrator.complete(request());

    expect(result.ok ? result.value.value.fitScore : 0).toBe(71);
    expect(prompts.length).toBe(1);
  });

  it('repairs once, re-prompting with the exact validation error', async () => {
    const { orchestrator, prompts } = await harness([
      geminiEnvelope(
        JSON.stringify({ fitScore: 'high', rationale: 'Strong.', matchedProgramAreas: [], gaps: [] }),
      ),
      geminiEnvelope(GOOD),
    ]);

    const result = await orchestrator.complete(request());

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.repairs : 0).toBe(1);
    // The re-prompt quotes the failure rather than saying "try again".
    expect(prompts[1]).toContain('fitScore must be an integer between 0 and 100');
    expect(prompts[1]).toContain('high');
  });

  it('fails as a value after two bad answers, and stores none of them', async () => {
    const bad = geminiEnvelope(JSON.stringify({ fitScore: 'high' }));
    const { orchestrator, database, prompts } = await harness([bad, bad]);

    const result = await orchestrator.complete(request());

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.code).toBe('model_output_invalid');
    expect(prompts.length).toBe(2);

    const cached = await database.db.execute('SELECT COUNT(*) AS n FROM model_response_cache');
    expect(Number(cached.rows[0]?.['n'])).toBe(0);
  });

  it('unwraps a fenced JSON answer, which is packaging rather than a different answer', async () => {
    const { orchestrator } = await harness([geminiEnvelope('```json\n' + GOOD + '\n```')]);

    const result = await orchestrator.complete(request());

    expect(result.ok ? result.value.value.fitScore : 0).toBe(71);
  });

  it('answers the second identical call from the database, calling the model once', async () => {
    const { orchestrator, prompts, database } = await harness([geminiEnvelope(GOOD)]);

    await orchestrator.complete(request());
    const second = await orchestrator.complete(request());

    expect(prompts.length).toBe(1);
    expect(second.ok ? second.value.cacheHit : false).toBe(true);

    const cached = await database.db.execute('SELECT COUNT(*) AS n FROM model_response_cache');
    expect(Number(cached.rows[0]?.['n'])).toBe(1);
  });

  it('writes a model_calls row for every call, cache hits included', async () => {
    const { orchestrator, database } = await harness([geminiEnvelope(GOOD)]);

    await orchestrator.complete(request());
    await orchestrator.complete(request());

    const calls = await database.db.execute(
      'SELECT cache_hit, prompt_tokens, response_tokens, outcome FROM model_calls ORDER BY id',
    );

    expect(calls.rows.length).toBe(2);
    expect(Number(calls.rows[0]?.['cache_hit'])).toBe(0);
    expect(Number(calls.rows[0]?.['prompt_tokens'])).toBe(800);
    // A cache hit costs nothing and says so, or the run log flatters itself.
    expect(Number(calls.rows[1]?.['cache_hit'])).toBe(1);
    expect(Number(calls.rows[1]?.['prompt_tokens'])).toBe(0);
  });

  it('reports the day’s spend from the rows it wrote', async () => {
    const { orchestrator, database } = await harness([geminiEnvelope(GOOD)]);
    await orchestrator.complete(request());
    await orchestrator.complete(request());

    const spend = await new LibsqlModelCallLog(database.db).spendSince('2000-01-01T00:00:00.000Z');

    expect(spend.ok ? spend.value.calls : 0).toBe(2);
    expect(spend.ok ? spend.value.cacheHits : 0).toBe(1);
    expect(spend.ok ? spend.value.promptTokens : 0).toBe(800);
  });

  it('returns an error value when the provider refuses, and logs it as unavailable', async () => {
    const { orchestrator, database } = await harness([
      { status: 429, body: JSON.stringify({ error: { code: 429, message: 'Resource exhausted' } }) },
    ]);

    const result = await orchestrator.complete(request());

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.code).toBe('model_unavailable');

    const calls = await database.db.execute('SELECT outcome FROM model_calls');
    expect(String(calls.rows[0]?.['outcome'])).toBe('unavailable');
  });
});
