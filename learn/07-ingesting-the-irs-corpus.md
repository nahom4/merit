# 07 — Ingesting the IRS Corpus: Streaming, Resuming, Reconciling

**TL;DR:** Thirteen bundles a year, 70–210MB each, expanding to ~2M grant records, downloaded from a server that drops connections mid-transfer, onto a free-tier instance that cannot hold one bundle in memory. Every design decision in the ingest pipeline follows from those four facts — and from one rule: **losing data quietly is the worst failure mode this system has.**

## The big picture

Four stages, each a testable seam, none of which holds more than one document in memory:

```
   downloadBundle()            streamBundle()          parseFiling()         IngestBundle
   infrastructure/irs          infrastructure/irs      infrastructure/irs    application
   ──────────────────          ──────────────────      ─────────────────     ───────────
   HTTP + Range resume   ──►   zip entry stream   ──►  XML → GrantRecord[] ──► batch, reconcile,
   .partial → rename           one entry at a time     990-PF | Schedule I    checkpoint, upsert
        │                            │                       │                      │
   survives a dropped          bounded memory          throws on unknown      resumable, idempotent
   connection                                          schema                 GrantRepository port
```

The last stage is in `application` and the first three are in `infrastructure` — because "when to checkpoint" is a policy and "how to inflate a zip" is not.

## Stage 1 — downloading, resumably

The comment states the provenance of the whole design:

```ts
// packages/infrastructure/src/irs/bundle-downloader.ts:42-52
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
```

Four techniques worth learning from this one function:

**HTTP Range resumption.** Ask for `bytes=<offset>-` where offset is the size already on disk, and append. Three responses must be handled distinctly ([lines 90-107](../packages/infrastructure/src/irs/bundle-downloader.ts#L90-L107)):

| Status | Meaning | Action |
|---|---|---|
| `206 Partial Content` | Server honoured the range | Append from offset |
| `200 OK` *with* an offset requested | Server **ignored** the range | Restart from zero — appending would corrupt the archive |
| `416 Range Not Satisfiable` | Offset is past EOF | What is on disk *is* the whole file |

The `200`-when-you-asked-for-a-range case is the one people forget, and silently appending there produces a corrupt zip that only fails much later.

**The `.partial` → `rename` dance.** `rename` is atomic on POSIX filesystems, so the final path either does not exist or is complete. There is no window in which a truncated file looks like a finished download.

**Verifying the declared length.** This is the subtlest bug in the file:

```ts
// packages/infrastructure/src/irs/bundle-downloader.ts:116-129 (abridged)
// A socket that dies mid-body does not always surface as an error -- the stream simply
// ends. Without this check a truncated bundle is renamed into place and only fails
// much later, as an unreadable zip, with the partial progress already thrown away.
if (expectedTotal !== null && bytes < expectedTotal) { … retry … }
```

A dead socket that "just ends" is indistinguishable from a complete body unless you compare against `Content-Length` / `Content-Range`. Same shape as the schema-version problem in [note 04](04-result-types-and-when-to-throw.md): **success and failure look identical, so you must make them differ.**

**Why not `stream.pipeline`?** The obvious choice, explicitly rejected:

```ts
// packages/infrastructure/src/irs/bundle-downloader.ts:172-178
/**
 * `stream.pipeline` is the obvious choice and the wrong one here: when the source errors it
 * destroys the sink, discarding the buffered bytes. That turns every dropped connection into
 * a restart from zero, which for a 200MB bundle on a flaky server means never finishing.
 */
```

`pipeline`'s automatic teardown is correct for most code and catastrophic when partial output is the whole point.

Plus: an `AbortController` timeout on every request (there is no default timeout in `fetch`), and exponential backoff **with jitter** — *"a fixed delay synchronises every retry against a server that is already struggling."*

## Stage 2 — streaming the zip

```ts
// packages/infrastructure/src/irs/bundle-stream.ts:17-23
/**
 * Streams the filing documents out of an IRS bundle, one at a time.
 *
 * A bundle is 70-210MB compressed and expands to several hundred megabytes across tens of
 * thousands of documents. Nothing here holds more than one document, so a free-tier instance
 * can process the whole corpus.
 */
export async function* streamBundle(zipPath: string): AsyncGenerator<BundleEntry>
```

Two things to take away.

**Async generators turn an event API into a `for await` loop.** `yauzl` is event-driven and lazy (`readEntry()` pulls the next entry, an `'entry'` event delivers it). [Lines 70-109](../packages/infrastructure/src/irs/bundle-stream.ts#L70-L109) adapt it with a pending queue and a `wake` resolver — a small, reusable pattern for "push-based source, pull-based consumer" with backpressure preserved: the next `readEntry()` only fires after the consumer takes the previous one.

**The Deflate64 trap.** Compression method 9 exists in some IRS bundles, and Node's zlib cannot inflate it:

```ts
// packages/infrastructure/src/irs/bundle-stream.ts:11-12, 31-40
/** ZIP compression method 9. Node's zlib cannot inflate it, and an entry silently skipped
 *  would look exactly like a bundle with no grants in it. */
const DEFLATE64 = 9;
…
  // An earlier validation run skipped every entry in Deflate64 bundles and reported
  // zero grants. Raising is the whole point: a zero must never be indistinguishable
  // from a parse failure.
  throw new UnknownSchemaVersion('bundle entry uses Deflate64, which cannot be inflated here', …);
```

Note it also raises on *any* unrecognised compression method, not just the one known bad case. Allowlist, not denylist.

## Stage 3 — parsing a filing

`parseFiling` throws rather than returning a `Result`, and says why:

```ts
// packages/infrastructure/src/irs/filing-parser.ts:54-60
/**
 * Throws `UnknownSchemaVersion` -- it does not return a Result -- because an unseen structure
 * is not a runtime condition to route around. It is a signal that the corpus changed and the
 * extractor needs a human.
 */
```

It gates on three things, in order: the `returnVersion` attribute matches `NNNNvN.N`; the schema **year** is in `SUPPORTED_SCHEMA_YEARS` (2013–2026, explicitly verified); and the `ReturnTypeCd` is one of `990`, `990PF`, `990EZ`, `990T`. Then it dispatches:

```ts
// packages/infrastructure/src/irs/filing-parser.ts:101-106
const extracted =
  returnType === '990PF' ? extractPartXvGrants(filing, context)
  : returnType === '990' ? extractScheduleIGrants(filing, context)
  : { grants: [], parseFaults: 0, statedTotalCents: null, grantsToIndividualsCents: 0 };
```

990-EZ and 990-T legitimately carry no grant table — that absence is **known** (they are in the allowlist) rather than assumed.

### The two extractors, and what they teach

**990-PF Part XV** ([`990-pf.extractor.ts`](../packages/infrastructure/src/irs/990-pf.extractor.ts)):

- Grants *approved for future payment* are deliberately **not** extracted — *"they are intentions, not transfers, and counting them would inflate every funder's apparent activity."* A domain judgement, recorded at the point of temptation.
- A row naming an individual rather than an organisation is not a graph edge, but its money still counts toward the filing's total ([lines 45-51](../packages/infrastructure/src/irs/990-pf.extractor.ts#L45-L51)). This matters for reconciliation below.
- An unusable amount becomes `NaN` so the *domain* parse rejects it and it is counted as a fault — the infrastructure layer does not get to decide what a valid amount is.

**990 Schedule I** ([`schedule-i.extractor.ts`](../packages/infrastructure/src/irs/schedule-i.extractor.ts)):

- Reads **both** tables: Part II (grants to organisations — the graph edges) and Part III (grants to individuals, aggregate).
- Adds `NonCashAssistanceAmt` to the cash amount — *"omitting it understates in-kind funders such as food banks and equipment grantmakers."*
- Captures `RecipientEIN`. **This single field is what makes evaluation possible** — see [note 08](08-entity-resolution.md).
- Reports `statedTotalCents: null` because Schedule I has no comparable summary field — *"reconciliation for these filings is reported as unavailable rather than as zero."* Unknown and zero are different, again.

## Stage 4 — the ingest use case: checkpointing and reconciliation

[`IngestBundle`](../packages/application/src/use-cases/ingest-bundle/ingest-bundle.use-case.ts) is in the application layer because everything it does is policy. Its port abstracts the source completely:

```ts
// packages/application/src/use-cases/ingest-bundle/ingest-bundle.use-case.ts:20-24
/** The source of filings. A port, so the use case never knows about zip files or HTTP. */
export interface FilingSource {
  bundle: string;
  filings(): AsyncIterable<FilingToIngest>;
}
```

**Dual checkpoint triggers.** Every 2,000 grants *or* every 500 filings, whichever comes first. The second exists for a specific reason:

```ts
// lines 39-44
/**
 * ...and at least this often measured in filings. A bundle of small foundations can run
 * thousands of filings without accumulating a full grant batch, and a process killed in
 * that window would have nothing durable to resume from.
 */
```

A grants-only trigger has a pathological case — a bundle of tiny foundations with two grants each — where you can process 5,000 filings and never checkpoint.

**Resume by skipping to the last recorded object id** ([lines 81-91, 122-128](../packages/application/src/use-cases/ingest-bundle/ingest-bundle.use-case.ts#L81-L91)). Note the honesty in the comment: replaying *would* be correct, because writes are idempotent — the skip is a performance optimisation, not a correctness requirement. That is the right relationship between the two mechanisms: **idempotency is the guarantee, checkpointing is the speedup.**

**Interruption leaves the bundle resumable, and says so** ([lines 163-182](../packages/application/src/use-cases/ingest-bundle/ingest-bundle.use-case.ts#L163-L182)): flush what is durable, log, return `IngestInterrupted`. Crucially the checkpoint is *not* marked `complete`, so *"the run reports what happened rather than leaving the bundle looking finished."*

**Reconciliation — the self-check.** 990-PF filings state a total; the itemised rows should sum to approximately it:

```ts
// lines 50-55, 134-148 (abridged)
/**
 * A filing whose itemised rows differ from its own stated total by more than this is an
 * extraction fault. Measured and recorded per bundle rather than assumed to be zero.
 */
const RECONCILIATION_TOLERANCE = 0.01;
…
const summed = filing.grants.reduce((t, g) => t + (g.amount as number), 0)
             + filing.grantsToIndividualsCents;   // ← individuals count toward the total
if (Math.abs(summed - stated) / stated > RECONCILIATION_TOLERANCE) { progress.reconciliationFaults += 1; … }
```

This is the most valuable idea in the pipeline: **the data checks itself.** Without it, an extractor that silently reads the wrong element name produces a plausible corpus that is 40% short, and nothing anywhere says so. With it, the parse-fault rate and reconciliation-fault rate are numbers recorded per bundle in `ingest_checkpoints`, per schema version.

## Idempotency in the schema

```sql
-- packages/infrastructure/src/persistence/migrations/0002-create-giving-graph.sql:18-21
-- A content hash of the filing, funder, recipient, amount, and purpose. Re-ingesting a
-- bundle rewrites the same rows rather than duplicating them, which is what makes a
-- killed worker safe to restart.
id TEXT PRIMARY KEY,
```

Content-addressed ids plus upsert means retry safety is a property of the *schema*, not of careful code. `docs/architecture.md` puts it well: *"Retries must be safe by construction, not by luck."*

Also note `recipient_normalized` is stored as a column, computed at write time — *"normalising on every query would make the join unusable at corpus scale."* Precompute what every read needs.

## Applied in this project

- [`bundle-downloader.ts`](../packages/infrastructure/src/irs/bundle-downloader.ts) · [`bundle-stream.ts`](../packages/infrastructure/src/irs/bundle-stream.ts) · [`filing-parser.ts`](../packages/infrastructure/src/irs/filing-parser.ts)
- [`990-pf.extractor.ts`](../packages/infrastructure/src/irs/990-pf.extractor.ts) · [`schedule-i.extractor.ts`](../packages/infrastructure/src/irs/schedule-i.extractor.ts)
- [`ingest-bundle.use-case.ts`](../packages/application/src/use-cases/ingest-bundle/ingest-bundle.use-case.ts)
- [`tests/integration/bundle-downloader.int.test.ts`](../tests/integration/bundle-downloader.int.test.ts) · [`bundle-stream.int.test.ts`](../tests/integration/bundle-stream.int.test.ts) · [`ingest-bundle.int.test.ts`](../tests/integration/ingest-bundle.int.test.ts)
- [`0002-create-giving-graph.sql`](../packages/infrastructure/src/persistence/migrations/0002-create-giving-graph.sql) — `grant_records`, `ingest_checkpoints`

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Download whole bundle to memory, then parse | 200MB+ per bundle; free tier has no headroom |
| `stream.pipeline` for the download | Destroys the sink on source error — every drop restarts from zero |
| Skip unknown schema versions and carry on | The failure mode this entire pipeline is designed to prevent |
| Trust the extractor without reconciliation | A silent 40% shortfall looks exactly like a complete corpus |
| Checkpoint after success only | A process killed mid-bundle loses everything since the last success |

**Honest cost:** reconciliation runs on every 990-PF filing (one reduce over its grants), the dual checkpoint means more small writes, and the `.partial` scheme needs a cleanup story for abandoned files. All cheap next to re-downloading 200MB.

## Learn more

- [MDN — HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [Node.js — Stream API](https://nodejs.org/api/stream.html) and [`stream.pipeline`](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback)
- [MDN — `for await...of` and async generators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
- [yauzl](https://github.com/thejoshwolfe/yauzl) — the lazy zip reader, whose README explains why it is event-driven
- [Wikipedia — Deflate64](https://en.wikipedia.org/wiki/Deflate#Deflate64)
- [AWS — Exponential backoff and jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
