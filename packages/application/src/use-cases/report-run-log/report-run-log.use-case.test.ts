import { describe, expect, it } from 'vitest';
import { ReportRunLog } from './report-run-log.use-case.js';
import { InMemoryOpportunityRepository } from '../../testing/in-memory-opportunity.repository.js';
import { InMemoryModelCallLog } from '../../testing/in-memory-model-call.log.js';
import { fixedClock } from '../../testing/fixed-id-generator.js';

const NOW = '2026-08-08T12:00:00.000Z';

const call = (occurredAt: string, cacheHit: boolean) => ({
  purpose: 'fit_score',
  priority: 'interactive' as const,
  model: 'gemini-2.5-flash',
  cacheHit,
  promptTokens: cacheHit ? 0 : 800,
  responseTokens: cacheHit ? 0 : 120,
  latencyMs: 12,
  queueWaitMs: 0,
  repairs: 0,
  outcome: 'ok' as const,
  occurredAt,
});

describe('ReportRunLog', () => {
  it('reports the sweep counters and the model spend behind them', async () => {
    const repository = new InMemoryOpportunityRepository();
    await repository.recordSweep({
      id: 'sweep_1',
      startedAt: '2026-08-08T06:00:00.000Z',
      finishedAt: '2026-08-08T06:04:00.000Z',
      searchesRun: 3,
      hitsSeen: 42,
      opportunitiesInserted: 12,
      opportunitiesUpdated: 30,
      parseFaults: 1,
    });
    const log = new InMemoryModelCallLog();
    await log.record(call('2026-08-08T06:01:00.000Z', false));
    await log.record(call('2026-08-08T06:02:00.000Z', true));

    const result = await new ReportRunLog(repository, log, fixedClock(NOW)).execute({ windowHours: 24 });

    expect(result.ok ? result.value.sweep?.hitsSeen : null).toBe(42);
    expect(result.ok ? result.value.spend.calls : null).toBe(2);
    // A run log that omits cache hits reports its numbers wrong in the flattering direction.
    expect(result.ok ? result.value.spend.cacheHits : null).toBe(1);
    expect(result.ok ? result.value.spend.promptTokens : null).toBe(800);
  });

  it('leaves calls outside the window out of the spend', async () => {
    const log = new InMemoryModelCallLog();
    await log.record(call('2026-08-06T06:00:00.000Z', false));

    const result = await new ReportRunLog(new InMemoryOpportunityRepository(), log, fixedClock(NOW)).execute({
      windowHours: 24,
    });

    expect(result.ok ? result.value.spend.calls : null).toBe(0);
  });

  it('says plainly that no sweep has run rather than reporting zeroes as a run', async () => {
    const result = await new ReportRunLog(
      new InMemoryOpportunityRepository(),
      new InMemoryModelCallLog(),
      fixedClock(NOW),
    ).execute({ windowHours: 24 });

    expect(result.ok ? result.value.sweep : undefined).toBeNull();
  });
});
