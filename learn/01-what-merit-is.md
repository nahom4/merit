# 01 — What Merit Is: The Problem, The Insight, The Vocabulary

**TL;DR:** Foundation money is real, large, and almost entirely unannounced — but every US foundation files a tax return itemising every grant it made. Merit turns that public corpus into a graph of who funds whom, and uses it to tell a small nonprofit which foundations would realistically fund *them*. Everything in the codebase is downstream of that one idea.

## The big picture

Merit is one pipeline with two halves, split by whether a human is waiting.

```
        ┌──────────────── OFFLINE (apps/worker) ────────────────┐
IRS 990 bundles ──► parse filings ──► grant records ──┐
IRS BMF registry ─► load entities ───────────────┐    │
                                                 ▼    ▼
                                        resolve recipients
                                     (free text ──► real org)
                                                 │
                                                 ▼
                                         [ the giving graph ]
        └───────────────────────────────────────┬───────────────┘
                                                │
        ┌──────────────── ONLINE (apps/web) ────▼───────────────┐
                   peers ──► candidate funders ──► signals
                                                 │
                                                 ▼
                              four score components + evidence rows
                                                 │
                                                 ▼
                                        prospect list screen
        └───────────────────────────────────────────────────────┘
```

Read that top to bottom and you have the whole product. Every other note in this folder zooms into one box.

## The problem

A small nonprofit — under ~$5M revenue, zero to one fundraising staff — needs foundation money. Finding out *which* foundations might give it money is close to impossible for them:

- There is no directory of open foundation opportunities, because foundation money is mostly **not announced**. No RFP, no posted deadline, no listing.
- So they guess. They apply to whatever they heard about, from whoever mentioned it. Most of those applications were never winnable.
- The expensive part is not the fundraiser's salary. It is **everyone else's time**, spent on the wrong opportunities, because nobody could answer: *is this funder even reachable for us?*

What they pay today instead: $50–150/hour for freelance grant writers, $2,000–6,000/month on retainer, ~$98,000/year for an in-house writer, or $179–899/month for research software like Candid or Instrumentl.

## The insight

Federal grants are posted and openly competed — and they overwhelmingly go to large institutions. For a $600k community organisation most of that money was never really available.

Foundation money is different: it sustains small organisations, and it is invisible. **But every grant-making organisation in the United States files a tax return that itemises every grant it made** — recipient, address, purpose, amount. The IRS publishes these in bulk as structured XML, for free, no API key, no credit card.

Two forms carry the itemised tables:

| Form | Table | Who files it |
|---|---|---|
| **990-PF** | Part XV, "Grants and Contributions Paid During the Year" | Private foundations |
| **990** | Schedule I, Part II (grants to organisations) | Grant-making public charities — community foundations, federated funders |

Parsing only 990-PF is the obvious path and the wrong one: in one sample bundle, Schedule I added **875 grant-making organisations and 7,777 grant records** — and those are the *most approachable* funders a small nonprofit has. See [`schedule-i.extractor.ts:33-44`](../packages/infrastructure/src/irs/schedule-i.extractor.ts#L33-L44).

## Why it mattered here — the thesis was tested, not assumed

Three real nonprofits were run against a partial corpus of 148,872 grant records (~17% of one year):

| Test organisation | Revenue | Credible funders | Of which regional |
|---|---|---|---|
| Cape Fear Literacy Council, Wilmington NC | $656k | 16 | 10 |
| Lake County Free Clinic, Painesville OH | ~$1.2M | 74 | 37 |
| Boys & Girls Club of Cabarrus County, NC | $4.5M | 57 | 24 |

The pre-registered bar was **15 credible funders for the smallest organisation**. It cleared that on 17% of one year's data. The names that came out — Cannon Foundation, Cape Fear Memorial Foundation, Timken Foundation of Canton — are regional family and community foundations with median grants of $25k–100k that post nothing, anywhere.

This is why `validation/RESULTS.txt` gets cited in source comments as an authority: the constants in this codebase were *fitted against a real run*, not chosen by feel. See [`materiality-floor.ts:4-8`](../packages/domain/src/prospect/materiality-floor.ts#L4-L8).

## The vocabulary — use these words, never synonyms

Renaming a domain concept here is an ADR, not a refactor. From [docs/conventions.md](../docs/conventions.md):

| Use | Never | What it means |
|---|---|---|
| `funder` | grantor, donor, foundation | An organisation that makes grants, identified by EIN |
| `grantee` | recipient organisation | An organisation that received one |
| `recipientString` | — | The raw, unresolved free text printed on a filing |
| `entity` | — | A resolved, registry-anchored organisation (has an EIN, NTEE code, revenue) |
| `prospect` | lead, target | A candidate funder scored for a specific nonprofit |
| `pursuit` | application, submission | A grant being worked on |
| `openness`, `affinity`, `geographyFit`, `sizeFit` | "the score" | The four components — **always these four names** |
| `competitiveBaseRate` | win rate, win probability | Public data has no denominator; it is a base rate and the UI says so |
| `signals` | metrics, stats | Arithmetic over the graph, never model output |

Three more terms you will meet constantly:

- **EIN** — Employer Identification Number, the nine-digit IRS identifier. The join key of the entire system.
- **NTEE code** — National Taxonomy of Exempt Entities. A letter + two digits (`B60` = education/adult literacy). The first letter is the *major group*, which is what peer matching uses.
- **BMF** — Business Master File. The IRS registry of every registered US nonprofit, ~1.8M rows. The canonical target set that free-text recipient names get linked against.

## The product rules that are also engineering rules

These come from the design and are **not negotiable in implementation**. They explain code you will otherwise find strange:

1. **Never show a single opaque score.** Openness, affinity, geography, and size fit are always four separate values with the grantee rows one click away. A development director has to defend a prospect list to a board — "the model said so" is not a defence. Enforced in [`prospect-score.ts:23-36`](../packages/domain/src/prospect/prospect-score.ts#L23-L36) and rendered in [`prospect-list/view-model.ts:49-74`](../apps/web/src/features/prospect-list/view-model.ts#L49-L74).
2. **Every claim cites its source.** A funder brief statement traces to a filing.
3. **Never call it a win probability.** There is no denominator.
4. **State coverage, never imply completeness.** "12 comparable organisations found", never silence — [`prospect-list/view-model.ts:113-119`](../apps/web/src/features/prospect-list/view-model.ts#L113-L119).
5. **The agent never submits an application and never contacts a funder.**

## What Merit deliberately does not do

Program officer relationships, board politics, and the judgement of what an organisation should *become* are not automatable. Budget construction is assist-only. Post-award reporting is out of scope.

## Applied in this project

- [`Merit.md`](../submission_docs/Merit.md) — the product spec, source of truth for *what* gets built
- [`CLAUDE.md`](../CLAUDE.md) — the four working rules, source of truth for *how*
- [`docs/conventions.md`](../docs/conventions.md) — the vocabulary table above
- [`validation/RESULTS.txt`](../validation/RESULTS.txt) — the original thesis validation the constants are fitted against

## Trade-offs / alternatives

**Why not just use Grants.gov / federal opportunity feeds?** Because that is the money that was never available to a $600k organisation. A tool built on opportunity feeds cannot see the money small nonprofits actually live on. Federal sweep exists in Merit (slice S3) but it is leverage on the foundation graph, not the core.

**Why not buy Candid/Instrumentl data?** Cost, and it inverts the thesis. The raw filings are free and complete; the value is in resolving and scoring them, which is exactly the part that is hard.

## Learn more

- [IRS — Form 990 Series Downloads (the bulk corpus)](https://www.irs.gov/charities-non-profits/form-990-series-downloads)
- [IRS — Exempt Organizations Business Master File Extract](https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf)
- [NCCS — National Taxonomy of Exempt Entities (NTEE) codes](https://nccs.urban.org/project/national-taxonomy-exempt-entities-ntee-codes)
- [ProPublica Nonprofit Explorer](https://projects.propublica.org/nonprofits/) — a useful way to eyeball a single filing by hand
