# 16 — The LLM orchestrator: running a real agent inside a free tier

**Status: Built** (S3, used by S3–S8). Sources:
[Merit.md §9](../submission_docs/Merit.md),
[ADR 0013](../docs/decisions/0013-every-model-call-goes-through-one-orchestrator.md).

**TL;DR:** Gemini's free tier allows 15 requests per minute and 1,500 per day. A daily sweep of
hundreds of announcements plus a multi-pass critique loop does not fit in that unless model
calls are *managed*. Five mechanisms — cascade, cache, token bucket, priority queue, repair
loop — turn a hard quota into a system that gets slower rather than one that fails. This is the
most reusable piece of engineering in the project.

## The big picture

Every model call goes through one port. Nothing calls a model SDK directly.

```
     caller (a use case)
          │  { purpose, priority, prompt, responseContract, parse }
          ▼
  ┌───────────────────────────────────────────────────────┐
  │ 1. CASCADE      rejected by a deterministic rule?      │  ← the callers', not here
  │                 it never reaches this file at all      │
  ├───────────────────────────────────────────────────────┤
  │ 2. CACHE        sha256(model+purpose+prompt+contract)  │──► stored text, 0 quota
  ├───────────────────────────────────────────────────────┤
  │ 3. QUEUE        interactive inserted ahead of batch    │
  ├───────────────────────────────────────────────────────┤
  │ 4. TOKEN BUCKET 15/min → wait.  1500/day → exhausted   │
  ├───────────────────────────────────────────────────────┤
  │ 5. CALL + PARSE GeminiGateway: one repair with the     │
  │                 exact validation error, then fail      │
  └───────────────────────┬───────────────────────────────┘
                          ▼
              Result<ModelCompletion<T>, ModelUnavailable | ModelOutputInvalid>
                          │
                    model_calls row: purpose, tokens, latency_ms,
                                     cache_hit, queue_wait_ms, repairs
```

Two classes, one interface:
[`GeminiGateway`](../packages/infrastructure/src/model/gemini.gateway.ts) does the HTTP call, the
envelope parse, and the repair loop; [`ModelOrchestrator`](../packages/infrastructure/src/model/orchestrator.ts)
implements the **same** `ModelGateway` port and wraps it — a decorator (note 06). That is why a
use case can ask for "a fit score, schema-validated" and know about none of this.

## The five mechanisms, and the code

**1. Cascade — the cheapest call is the one not made.** Not in this file, on purpose: only the
caller knows which announcements were already rejected by rule. See note 15. The quota
arithmetic only closes because callers do it, which is why it belongs in the same mental model.

**2. Content-hash cache.** `cacheKey` (line 116) hashes the model id, purpose, prompt, and
response contract. Two consequences fall out and both are tested: a model upgrade is a **miss**,
not a stale hit; and because the organisation's profile is part of the prompt, editing a profile
invalidates every score derived from it — which is correct.

The cache stores the **raw response text**, not the parsed value, so a hit takes the same parse
path as a miss. A stored answer that no longer parses is not trusted because it was once valid;
it falls through to a fresh call.

The cache lookup happens *outside* the queue (line 47): a hit spends no quota, so making it wait
behind a nightly job would be latency bought for nothing.

**3. Token bucket — the limit modelled, not discovered.**
[`token-bucket.ts`](../packages/infrastructure/src/model/token-bucket.ts) refills continuously
and caps at one minute's worth, so an idle hour does not buy a burst of 900 calls. Its clock is
an injected port, which is what makes "the sixteenth call in a minute waits" a unit test that
runs in a millisecond rather than a minute.

The two limits mean different things, and the return type says so:

```ts
type TokenGrant =
  | { kind: 'granted' }
  | { kind: 'wait'; waitMs: number }            // the work happens shortly
  | { kind: 'exhausted'; resetsAt: string };    // nothing more happens today
```

Exhaustion is not a long wait. Blocking until midnight would turn a degraded board into a hung
page; instead `spendToken` (line 122) returns `ModelUnavailable` and the caller queues the work.

**4. Priority queue — a waiting person beats a nightly job.** `acquire` (line 150) inserts an
interactive waiter *ahead of the first batch waiter* and behind anyone interactive already
waiting: fair within a priority, deliberately unfair between them. The test holds one call open
and asserts the order the gateway actually sees — `['batch-1', 'interactive', 'batch-2']`.
Queue wait is user-visible latency, which is why `queue_wait_ms` is a logged column.

**5. Repair loop — one retry, with the specific error.** In the gateway, not the orchestrator
(`gemini.gateway.ts:53`). On a schema failure it re-prompts with the exact issue quoted back —
*"fitScore must be an integer between 0 and 100"* plus what the model actually returned — and
parses again. Twice failed is `ModelOutputInvalid`. No coercion, no partial output, no default:
each of those is a silent fallback, and bad data in the database is worse than a failed call.

One small allowance: a fenced ```json block is unwrapped (`stripFences`). That is packaging, not
a different answer.

## Degradation is designed, not accidental

Three requirements, all met:

- **Anything computed is in the database** and readable with no model at all.
- **The UI can say "not scored yet"** — a third state, neither a score nor an error. It is
  `fitState: 'queued'` with a reason sentence, rendered as its own panel.
- **The queue is persisted.** It is the `assessments.fit_state` column, not an array in memory,
  so a restart resumes it.

And the strongest form: with no `GEMINI_API_KEY` at all, the container wires
[`UnavailableModelGateway`](../packages/infrastructure/src/model/unavailable-model.gateway.ts)
and everything else works. **The whole test suite runs without a model credential.**

## Where the pieces live

```
application/ports/model.port.ts            the interface a use case depends on
application/ports/model-telemetry.port.ts  ModelCallLog, ModelResponseCache
infrastructure/model/gemini.gateway.ts     the SDK-free REST call, parse, repair loop
infrastructure/model/orchestrator.ts       bucket, queue, cache, log — around the gateway
infrastructure/model/token-bucket.ts       the rate limit, with an injected clock
persistence/libsql-model-telemetry.ts      model_calls + model_response_cache
```

One subtlety worth the note: **the port carries no Zod.** `packages/application` may not depend
on it, so `ModelRequest` takes a `parse: (raw: unknown) => Result<T, ParseError>` the caller
supplies — in S3, `FitAssessment.parse`, a hand-written domain parse. Its error message is what
the repair loop re-prompts with, which is why that message must name the offending field rather
than say "invalid".

**Prompts are not infrastructure trivia.** A prompt encodes product judgement, so
[`fit-score.prompt.ts`](../packages/application/src/use-cases/screen-federal-opportunities/fit-score.prompt.ts)
sits in the application layer where it can be read and reviewed. Treat a prompt change like a
logic change: it needs a test, and if it moves an eval number it needs an ADR.

## The budget is global, and that is a composition concern

```ts
// apps/web/src/composition/container.ts
const globalForModel = globalThis as unknown as { meritModel?: ModelGateway };
```

Two callers each obeying 15 a minute is 30 a minute. The bucket and the orchestrator are
memoised on `globalThis` for the same reason the database client is — Next.js re-evaluates
modules across dev reloads, and a bucket rebuilt per request limits nothing.

## How this was verified

1. **Token bucket unit tests with an injected clock** — the sixteenth call waits, refill is
   gradual, an idle hour buys no burst, the day resets. No real seconds elapse.
2. **A cache test proving the second identical call makes zero gateway calls**, and one proving
   a changed model id is a miss.
3. **Repair-loop integration test against a real HTTP server**: malformed → one re-prompt
   containing the validation error → success; malformed twice → an error *value*, and
   `SELECT COUNT(*) FROM model_response_cache` is zero.
4. **A priority test** that holds a batch call open and asserts the order the gateway saw.
5. **A degradation test**: the daily bucket spent → `ModelUnavailable`, no gateway call, and the
   caller stores `queued` rather than failing.
6. **`model_calls` rows for every call, cache hits included** with `cache_hit = 1` and zero
   tokens — asserted against the real table. If cache hits were unlogged the run log's numbers
   would be wrong in the flattering direction.
7. **A contract test against the live Gemini API**, gated on the credential being present, plus
   an ungated test pinning the fixture envelope to the envelope the gateway parses.

The single question that tests the whole design: *"show me the test where the model gateway
throws if it is called, and the assertion that it wasn't."* That is
`NeverCalledModelGateway` — see note 15.

## Trade-offs

| Option | Why not |
|---|---|
| Retry on 429 | Learns the limit by being punished; retries eat the same budget |
| No cache, just re-ask | 1,500/day makes repeat work unaffordable, and runs non-reproducible |
| Cache the parsed value | A hit would skip the parse; storing raw text keeps one code path |
| Coerce invalid model output | A silent fallback. The row would be indistinguishable from a real answer |
| Per-use-case rate limiting | Two callers each obeying 15/min is 30/min. Budgets must be global |
| Block until the daily bucket refills | Turns a degraded board into a hung page |

One real cost: the orchestrator serialises calls. At 15 requests a minute that is the right
ceiling; off the free tier, the mutex becomes a semaphore.

## Learn more

- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Token bucket algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- Note [04 — `Result` and when to throw](04-result-types-and-when-to-throw.md), which decides
  what the orchestrator returns versus throws.
