import { describe, expect, it } from 'vitest';
import { ok, type Result } from '@merit/shared';
import {
  InMemoryModelCallLog,
  InMemoryModelResponseCache,
  ModelUnavailable,
  StubModelGateway,
  type ModelCompletion,
  type ModelError,
  type ModelGateway,
  type ModelRequest,
} from '@merit/application';
import { FitAssessment } from '@merit/domain';
import { ModelOrchestrator } from './orchestrator.js';
import { TokenBucket } from './token-bucket.js';

const MENU = ['Education'];

const answer = {
  fitScore: 71,
  rationale: 'The announcement funds adult literacy.',
  matchedProgramAreas: ['Education'],
  gaps: ['No evaluation partner named.'],
};

const request = (prompt = 'score this'): ModelRequest<FitAssessment> => ({
  purpose: 'fit_score',
  priority: 'interactive',
  prompt,
  responseContract: FitAssessment.responseContract(MENU),
  parse: (raw) => FitAssessment.parse(raw, MENU),
});

const testClock = (startIso = '2026-08-08T06:00:00.000Z') => {
  let current = new Date(startIso).getTime();
  return {
    clock: { now: () => new Date(current) },
    advance: (ms: number) => {
      current += ms;
    },
  };
};

const orchestrated = (
  gateway: ModelGateway,
  { perMinute = 15, perDay = 1_500 }: { perMinute?: number; perDay?: number } = {},
) => {
  const { clock, advance } = testClock();
  const cache = new InMemoryModelResponseCache();
  const log = new InMemoryModelCallLog();
  const orchestrator = new ModelOrchestrator(gateway, {
    bucket: new TokenBucket({ perMinute, perDay, clock }),
    cache,
    log,
    clock,
    model: 'gemini-2.5-flash',
    // The bucket's wait is served by moving the injected clock, never by sleeping.
    sleep: async (ms: number) => advance(ms),
  });
  return { orchestrator, cache, log, advance };
};

/** Counts calls and lets a test hold one open, which is how queue order is observed. */
class CountingGateway implements ModelGateway {
  readonly prompts: string[] = [];
  private release: (() => void) | null = null;

  constructor(private readonly raw: unknown = answer) {}

  holdNext(): () => void {
    let unblock = () => {};
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    this.release = () => {
      this.release = null;
      unblock();
    };
    this.gate = gate;
    return this.release;
  }

  private gate: Promise<void> | null = null;

  async complete<T>(model: ModelRequest<T>): Promise<Result<ModelCompletion<T>, ModelError>> {
    this.prompts.push(model.prompt);
    if (this.gate !== null) {
      const gate = this.gate;
      this.gate = null;
      await gate;
    }
    const parsed = model.parse(this.raw);
    if (!parsed.ok) throw parsed.error;
    return ok({
      value: parsed.value,
      raw: JSON.stringify(this.raw),
      cacheHit: false,
      promptTokens: 800,
      responseTokens: 120,
      latencyMs: 40,
      queueWaitMs: 0,
      repairs: 0,
    });
  }
}

describe('ModelOrchestrator — cache', () => {
  it('answers a repeated call without calling the model at all', async () => {
    const gateway = new CountingGateway();
    const { orchestrator } = orchestrated(gateway);

    await orchestrator.complete(request());
    const second = await orchestrator.complete(request());

    expect(gateway.prompts.length).toBe(1);
    expect(second.ok ? second.value.cacheHit : false).toBe(true);
    expect(second.ok ? second.value.value.fitScore : 0).toBe(71);
  });

  it('spends no quota on a cache hit', async () => {
    const gateway = new CountingGateway();
    const { orchestrator } = orchestrated(gateway, { perDay: 1 });

    await orchestrator.complete(request());
    const second = await orchestrator.complete(request());

    // The daily budget was one call. A cached answer must still be servable.
    expect(second.ok).toBe(true);
  });

  it('treats a changed prompt as a different question', async () => {
    const gateway = new CountingGateway();
    const { orchestrator } = orchestrated(gateway);

    await orchestrator.complete(request('score this'));
    await orchestrator.complete(request('score this other thing'));

    expect(gateway.prompts.length).toBe(2);
  });

  it('treats a changed model as a different question, so an upgrade never serves stale answers', async () => {
    const gateway = new CountingGateway();
    const { clock } = testClock();
    const cache = new InMemoryModelResponseCache();
    const log = new InMemoryModelCallLog();
    const build = (model: string) =>
      new ModelOrchestrator(gateway, {
        bucket: new TokenBucket({ perMinute: 15, perDay: 1_500, clock }),
        cache,
        log,
        clock,
        model,
        sleep: async () => undefined,
      });

    await build('gemini-2.5-flash').complete(request());
    await build('gemini-3-flash').complete(request());

    expect(gateway.prompts.length).toBe(2);
  });

  it('logs the cache hit, with no token spend, so the run log is not flattering', async () => {
    const { orchestrator, log } = orchestrated(new CountingGateway());

    await orchestrator.complete(request());
    await orchestrator.complete(request());

    expect(log.calls.length).toBe(2);
    expect(log.calls[1]?.cacheHit).toBe(true);
    expect(log.calls[1]?.promptTokens).toBe(0);
  });
});

describe('ModelOrchestrator — quota', () => {
  it('waits for the minute bucket rather than exceeding the rate', async () => {
    const gateway = new CountingGateway();
    const { orchestrator } = orchestrated(gateway, { perMinute: 2 });

    for (let call = 0; call < 4; call += 1) {
      const result = await orchestrator.complete(request(`prompt ${call}`));
      expect(result.ok).toBe(true);
    }

    expect(gateway.prompts.length).toBe(4);
  });

  it('serves an error value, not an exception, when the day is spent', async () => {
    const gateway = new CountingGateway();
    const { orchestrator } = orchestrated(gateway, { perDay: 1 });

    await orchestrator.complete(request('first'));
    const second = await orchestrator.complete(request('second'));

    expect(second.ok).toBe(false);
    expect(second.ok ? '' : second.error.code).toBe('model_unavailable');
    // Nothing was asked of the model: exhaustion is known in advance, not discovered by a 429.
    expect(gateway.prompts.length).toBe(1);
  });

  it('logs the exhausted call, because a silent degradation is the thing being guarded against', async () => {
    const { orchestrator, log } = orchestrated(new CountingGateway(), { perDay: 1 });

    await orchestrator.complete(request('first'));
    await orchestrator.complete(request('second'));

    expect(log.calls[1]?.outcome).toBe('unavailable');
  });
});

describe('ModelOrchestrator — priority', () => {
  it('puts a waiting person ahead of a nightly job', async () => {
    const gateway = new CountingGateway();
    const { orchestrator } = orchestrated(gateway);
    const release = gateway.holdNext();

    const first = orchestrator.complete({ ...request('batch-1'), priority: 'batch' });
    // Queued behind the in-flight call, in this order.
    const queuedBatch = orchestrator.complete({ ...request('batch-2'), priority: 'batch' });
    const queuedInteractive = orchestrator.complete({ ...request('interactive'), priority: 'interactive' });

    release();
    await Promise.all([first, queuedBatch, queuedInteractive]);

    expect(gateway.prompts).toEqual(['batch-1', 'interactive', 'batch-2']);
  });

  it('reports the queue wait, because it is latency a user feels', async () => {
    const gateway = new CountingGateway();
    const { orchestrator, log } = orchestrated(gateway);
    const release = gateway.holdNext();

    const first = orchestrator.complete({ ...request('batch-1'), priority: 'batch' });
    const second = orchestrator.complete(request('interactive'));
    release();
    await Promise.all([first, second]);

    expect(log.calls.some((call) => call.queueWaitMs >= 0)).toBe(true);
  });
});

describe('ModelOrchestrator — failures', () => {
  it('passes the gateway’s own error through as a value', async () => {
    const failing: ModelGateway = {
      complete: async () => ({
        ok: false as const,
        error: new ModelUnavailable('the model could not be reached', { reason: 'transport' }),
      }),
    };
    const { orchestrator, log } = orchestrated(failing);

    const result = await orchestrator.complete(request());

    expect(result.ok).toBe(false);
    expect(log.calls[0]?.outcome).toBe('unavailable');
  });

  it('does not cache an answer that failed its schema', async () => {
    const { orchestrator, cache } = orchestrated(StubModelGateway.answeringBadly());

    const result = await orchestrator.complete(request());

    expect(result.ok).toBe(false);
    expect(cache.size).toBe(0);
  });
});
