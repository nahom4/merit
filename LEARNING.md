# 📚 Learning Mode — Instructions for AI Agents

> **Read this before you start.** The person you're working with is here to *learn*, not just to ship.
> Treat every task as a teaching opportunity. Your job is two-fold: complete the work **and** leave
> behind a clear trail of *why* and *how* so the human grows from it.

---

## The Core Rule

Whenever you do something non-obvious — a design decision, a new library, a tricky bug fix, a pattern,
a piece of domain knowledge — **write a short learning note** and save it as a markdown file in the
[`learn/`](learn/) folder.

Don't bury the lesson in a code comment or a long chat message that scrolls away. Capture it as a
durable, linkable doc.

---

## What Counts as "Worth a Note"

Write a note when you used or explained any of:

- **A new tool, library, or framework** — what it does, why it was chosen over alternatives.
- **A non-trivial pattern or technique** — async flows, state management, caching, auth, migrations, etc.
- **A bug and its root cause** — what broke, *why* it broke, how it was fixed, how to avoid it next time.
- **A design / architecture decision** — the trade-offs and the reasoning, not just the outcome.
- **A domain concept** — business rules, jargon, or context that isn't obvious from the code.
- **A "gotcha"** — platform quirks, environment setup pitfalls, footguns.

If you find yourself thinking *"this is a bit subtle"* — that's the signal. Write the note.

---

## Start With the Whole Frame

**Top-down, always.** Before any component-specific detail, establish the big picture:

- If the thing has **multiple parts**, first lay out *what the parts are* and *how they interact* —
  a short map of the whole system. A simple list, a flow, or an ASCII diagram is ideal.
- Once the frame is in place, drill into the specifics. Detail lands much more easily when the
  reader already knows where it fits.
- For a single isolated concept, still open by situating it: where does it sit, what problem space
  does it belong to, what talks to it.

This ordering — **whole → parts → details** — is the single most important thing about how these
notes should read.

## How to Write a Good Note

Be as long as the lesson needs — **no longer, no shorter.** Don't sacrifice understanding for
brevity: if detail makes it click, include the detail. The thing to cut is **wandering** —
tangents, asides, and "fun facts" that aren't needed to understand the main lesson. Every sentence
should earn its place by serving the core point. A focused 8-minute read beats a vague 2-minute one.

Every note should:

1. **Explain the concept in plain language** — assume a capable developer who simply hasn't met
   this specific thing yet.
2. **Show a minimal example** — the smallest snippet (often pulled from the actual change) that
   makes it click.
3. **Link to official documentation** — always include authoritative source links so the human can
   go deeper. Prefer official docs over random blog posts.
4. **Connect it back to this project** — point to the file/PR where it was applied
   (e.g. `see src/api/auth.ts:42`).
5. **Note the trade-offs** — what you *didn't* do and why.

---

## File Convention

- Location: `learn/`
- Naming: `NN-kebab-case-topic.md` (e.g. `01-async-await-basics.md`, `02-why-we-chose-zod.md`).
  Sequential numbers keep them ordered by when you learned them.
- One concept per file. Small and focused beats one giant doc.
- Keep [`learn/README.md`](learn/README.md) as an **index** — one line per note with a title and a
  one-sentence hook, newest at the top.

---

## Note Template

Copy this for each new note:

```markdown
# <Concept / Decision Title>

**TL;DR:** <one or two sentences — the whole lesson in a nutshell>

## The big picture
<for anything with multiple parts: name the parts and how they fit/interact before any detail.
a small diagram or flow is great here. for a single concept, situate it in its surroundings.>

## What it is
<plain-language explanation>

## Why it mattered here
<the specific problem in this project that made this relevant>

## Example
```<lang>
// the smallest snippet that demonstrates it
```

## Applied in this project
- `path/to/file.ext:line` — <what was done>

## Trade-offs / alternatives
<what else was considered and why this won>

## Learn more
- [Official docs — <title>](https://...)
- [Deeper dive — <title>](https://...)
```

---

## Index Entry Format

After writing a note, add a line to [`learn/README.md`](learn/README.md):

```markdown
- [01 — Why we chose Zod](01-why-we-chose-zod.md) — runtime schema validation that doubles as TS types.
```

---

## Tone & Behavior Expectations

- **Frame before detail.** Lead with the high-level map; only then go deep. This is how the reader
  learns best.
- **Explain as you go.** When you make a meaningful choice during a task, say *why* in your response —
  briefly — then capture the durable version in a note.
- **Cut wandering, not detail.** Include whatever depth aids understanding; remove only what's
  tangent to the lesson.
- **Don't over-document.** Trivial or self-evident code doesn't need a note. Reserve notes for things
  that genuinely teach.
- **Prefer official, current sources.** Link the real docs. Flag if something is version-specific.
- **Be honest about uncertainty.** If a recommendation is a judgment call or you're unsure, say so —
  that's a learning moment too.

---

*The measure of success: after this task, the human could explain the new concept to someone else.*