# 20 — S7: ask the graph — typed tools instead of text-to-SQL

**Status: Designed.** Sources: [Merit.md §5](../submission_docs/Merit.md), [roadmap S7](../docs/roadmap.md).

**TL;DR:** S7 lets a user ask the corpus questions in plain language. The obvious implementation —
hand the model the schema and let it write SQL — is rejected. Instead the model gets a small set of
**typed, parameterised query tools**; it chooses one and fills its parameters, the results render
as inspectable rows with the generating query shown, and a question outside the toolset is
**refused rather than improvised**. Three lines in the roadmap, and each one is a decision worth
understanding.

## The big picture

```
  "which funders gave to literacy nonprofits in NC last year?"
              │
              ▼
   model chooses a tool + fills parameters      ← the only thing the model does
              │
              ▼
   ┌────────────────────────────────────────────────┐
   │ fundersByProgramAndState({                      │
   │   nteeMajorGroup: 'B',   ← enum, validated      │
   │   state: 'NC',           ← branded UsState      │
   │   taxYear: 2024,         ← bounded to corpus    │
   │   limit: 50 })           ← capped               │
   └───────────────────┬────────────────────────────┘
                       ▼
        one hand-written parameterised SQL statement
                       ▼
        rows + the query that produced them, both rendered
                       │
                       └── no tool fits? → "I can't answer that with the tools I have"
```

The model never sees raw SQL and never sees raw tables. It sees a menu.

## Why not text-to-SQL

The tempting version gives the model the schema and executes what it writes. Four problems, in
increasing order of how much they matter here:

1. **Injection and blast radius.** Generated SQL against a live database is arbitrary code
   execution driven by user text. Parameterised tools reduce the attack surface to the parameter
   values, which are typed and validated.
2. **Cost and latency.** Every question becomes a generation call, and a wrong query becomes a
   retry loop. A tool call is smaller and cacheable by content hash (note 16).
3. **Silent wrongness.** A query that runs and returns plausible rows is the worst outcome, because
   nothing signals failure. Merit's corpus has traps a schema alone does not communicate — grants
   join to *entities* through `entity_links` **only where `decision = 'linked'`**, and forgetting
   that filter returns a number that looks right and is not. A hand-written tool encodes the join
   once, correctly, in the same place the S1 repository already encodes it.
4. **Unreviewable answers.** The product rules say every recommendation is inspectable. A one-off
   generated query cannot be reviewed by the person asking, whereas a named tool with visible
   parameters can.

Point 3 is the one specific to this project. The giving graph's correctness lives in the join
conditions, and note 09 already documents the peer query's *"an entity nobody has ever funded tells
us nothing about who might fund us"* filter. Every such subtlety is a chance for generated SQL to
be confidently wrong.

## What a tool looks like

A tool is: a name, a Zod-validated parameter schema, one parameterised SQL statement, and a typed
row shape. Design rules that follow from the rest of the codebase:

- **Parameters are the branded types the domain already has** — `UsState`, `Ein`, NTEE major group
  as an enum, cents as integers (note 05). The model is choosing from sets, not writing strings,
  so a malformed parameter fails at parse time, before touching the database.
- **Every tool caps its result count**, and the cap is reported — the same "coverage, stated not
  implied" rule every use case follows.
- **Every tool returns rows the user can read**, not aggregates alone. "47 funders" with no list is
  not inspectable.
- **The generating query is part of the response.** Roadmap: *"Results rendered as inspectable rows
  with the generating query shown."* Show the query text with its bound parameters.

Where the code goes: the tools are an **application** concern (they orchestrate repositories and
define what may be asked), with the SQL in `infrastructure/persistence`. The tool *descriptions*
the model reads are prompt material — note 16's point that prompts encode product judgement applies
here more than anywhere, because the description is what determines whether the right tool is
chosen.

## Refusal is a feature, not a gap

> Refuses to answer beyond the tools rather than improvising

This is the same instinct as "silence is a feature" in S6 and "no silent fallbacks" in CLAUDE.md. A
system that answers everything trains a user to trust answers it should not have given. A refusal —
ideally naming what it *can* answer — keeps the trust calibrated.

Implementation-wise this means the "no tool applies" branch is a first-class, tested path, not an
error state. Expect an agent to under-build it; ask for the test.

## How to verify an agent's S7 work

1. **Grep the slice for string-concatenated SQL.** There should be none. Parameters only.
2. **A test per tool** against a real libSQL database with a known seeded graph, asserting exact
   rows — including that unlinked entity rows are excluded where they should be.
3. **An out-of-scope question test**: something the toolset cannot answer returns a refusal, and
   the assertion is on the refusal, not on the absence of a crash.
4. **A parameter-validation test**: a model returning `state: "Carolina"` or `taxYear: 1799` fails
   the schema and repairs (note 16), rather than reaching SQL.
5. **A UI assertion that the query and its parameters are rendered**, per the roadmap.
6. **A cap test**: a question matching 10,000 rows returns the cap and says so.

The question that exposes the whole design: *"what happens if the model asks for something the
tools do not cover?"* If the answer involves generating SQL, S7 has been built the rejected way.

## Trade-offs / alternatives

| Option | Why not |
|---|---|
| Text-to-SQL over the live schema | Injection surface, silent wrongness on subtle joins, unreviewable answers |
| Text-to-SQL against a read-only view | Better, but still generates joins whose correctness nobody checks |
| A fixed set of dashboards, no natural language | Safe and useless for the long tail of real questions, which is the feature's point |
| Many fine-grained tools | Each tool costs prompt tokens and adds selection ambiguity. A small, well-named set beats a large one |

The honest limitation of the chosen design: coverage is exactly the toolset, so the feature grows
one tool at a time. That is a real cost, accepted deliberately in exchange for every answer being
correct-by-construction and inspectable.

## Learn more

- [Merit.md §5 — "Ask the graph"](../submission_docs/Merit.md)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling) — the tool-selection mechanism
- [libSQL / SQLite parameterised statements](https://www.sqlite.org/lang_expr.html#varparam)
- [OWASP — SQL injection](https://owasp.org/www-community/attacks/SQL_Injection) — the class of problem parameterisation closes
- Note [05 — branded types](05-branded-types-and-parse-dont-validate.md), which is what makes tool parameters safe rather than merely typed
