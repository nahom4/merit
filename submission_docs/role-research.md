# Role Selection Research — AI Automation Assignment

Working doc. Purpose: pick the role before writing the SRS. Everything below about APIs was **live-tested from this machine**, not taken from documentation.

---

## 1. The constraint that actually decides this

The assignment's hard filters:

| Constraint | Implication |
|---|---|
| No HR / recruiting | Rules out the obvious pick |
| ≥2 free third-party APIs, no credit card | Rules out most "real business" APIs (Twilio, SendGrid-for-new-accounts, Google Maps, LinkedIn, Clearbit) |
| Proactive actions (Cloud Scheduler) | Role must have a **time dimension** — deadlines, recurring cycles |
| "Would I pay for this / hire it over a human?" | Role must be expensive to staff and painful to do manually |
| Balanced FE/BE, ~2 days | No research-heavy or model-training ideas |
| Their own examples were EA + social media manager | Picking either is an automatic "derivative" mark |

And the constraint *you* added, which is the real one:

> the whole thing died because it relied on scraping

So the winning shape is: **an official, keyless, structured public API supplies the world-state; the user supplies their own structured profile; the LLM does judgment, not extraction.** Scraping goes to zero.

---

## 2. Free API landscape — live test results

I ran these against the real endpoints just now:

| API | Auth | Status | What it gives |
|---|---|---|---|
| **Grants.gov `search2`** | **None** | ✅ 971 hits for "youth mental health" | Federal funding opportunities: title, agency, open/close dates, status, **CFDA number** |
| **Grants.gov `fetchOpportunity`** | **None** | ✅ Full synopsis returned | Full description, eligibility, award ceiling/floor, expected # of awards, agency contact |
| **USASpending.gov v2** | **None** | ✅ Real award records returned | Historical awards **filterable by CFDA number** — who won, how much, when |
| **ProPublica Nonprofit Explorer v2** | **None** | ✅ RWJF: 10 filings returned | 990-PF **financial summaries** — see caveat in §4 |
| **Federal Register API** | **None** | ✅ Returns `comments_close_on` | Proposed rules + hard comment deadlines by agency |
| SAM.gov Opportunities | Free key | ⚠️ Needs SAM.gov + Login.gov account | Federal contract (not grant) solicitations |
| Google Calendar / Gmail | OAuth, no billing | ✅ Free tier fine | Write actions — the "takes real action" requirement |

The SAM.gov caveat matters: Login.gov identity verification is a known friction point outside the US. **Every API in the recommended stack below needs zero registration.** That's a deliberate de-risking choice for a 2-day build.

---

## 3. Roles considered

### ❌ Rejected

- **Executive assistant / social media manager** — literally the two worked examples in the brief. Guaranteed to read as template-following.
- **AR / collections specialist** — great "would I pay" story, but the only integrations available are Gmail + Calendar. No distinctive external data. Reads as a CRUD app with an email drafter.
- **Customer success / ticket triage** — the brief explicitly names generic-chatbot support as Pitfall 1.
- **Contract administrator** — strong idea, but it's 100% user-uploaded PDFs. No third-party data API, so it fails the "integrate a couple of relevant APIs" requirement in spirit.
- **Clinical trial coordinator** — ClinicalTrials.gov API is excellent, but the domain needs too much explaining in a demo video to land the value.

### 🥉 Finalist C — Regulatory Compliance Analyst

Federal Register API → new proposed rules matched against a company compliance profile → Gemini impact memo → comment deadline to Calendar.

- **For:** genuinely novel, nobody picks this. `comments_close_on` is a real, hard, money-relevant deadline.
- **Against:** the value is hard to *show* in a 5-minute video. "Here's a memo about an FAA airspace rule" doesn't land emotionally. Also the matching quality is hard to demo convincingly without a real regulated company.

### 🥈 Finalist B — Capture / Proposal Manager (gov contracting)

SAM.gov opportunities + USASpending competitive history → bid/no-bid scoring → capability statement drafting.

- **For:** highest-paying role of the three (~$120k+); GovWin/Deltek charge thousands per seat, so willingness-to-pay is proven.
- **Against:** SAM.gov API key requires Login.gov. If that verification blocks you, the project's core data source dies the night before submission. Unacceptable risk on this timeline.

### 🥇 **Finalist A — Grants Manager / Development Officer at a small nonprofit** ← recommended

---

## 4. Recommendation: Grants Manager / Development Officer

### Why this role wins on their own criteria

**"Would I be willing to pay for this?"** — This market's price is public and high:
- Grant writers: **$50–150/hr**, commonly **$2,000–6,000/month** on retainer, ~**$98k/yr** fully loaded in-house.
- Instrumentl, the category leader, charges **$179–$899/month** and its core feature is exactly funder-matching + AI narrative drafting.

You are not speculating about willingness to pay. You are pointing at an existing price list and undercutting it with free public data.

**"Would I hire your AI agent over a human?"** — The honest answer for the *discovery and qualification* half of this job is yes, and you can say so precisely: a human development officer spends hours a week reading opportunity announcements that turn out not to fit. That specific sub-task is pure judgment applied to public text on a schedule. That's exactly what an LLM on a cron does better, cheaper, and without forgetting.

**Creativity / not-a-template** — Nobody in this applicant pool will pick nonprofit development. It's a real role with a real budget line, in an industry (social sector) that never shows up in AI demos.

**⚠️ Selection-bias disclosure** — I was drawn to the *shape* of this idea (feed → LLM score → deliver on a schedule) partly because it's the architecture already built in `ai-workflow-automator`, which made a 2-day timeline credible. That's a real thumb on the scale and it carries a risk: **if the demo leads with "look, it found 40 grants," this is a job-board alert with extra steps.** Discovery must not be the product. The product is the bid/no-bid *decision* and the actions that follow it. Design accordingly.

(If escaping the shape entirely matters more than build speed, **Contract Administrator** and **Chief of Staff / board secretary** are structurally different — documents in, obligation graph out, no feed at all. Both are weaker on the two-API requirement. Legitimate tradeoff.)

**It fixes your last project** — Same architecture shape you already built (sources → LLM ranking → threshold → delivery → schedule), but the source adapter is a stable government JSON API instead of a scraper, and the user's "criteria" becomes a rich structured org profile instead of a sentence. This is your prior work with its one fatal flaw removed. You've built this pipeline before, which is why 2 days is realistic.

### The differentiator that makes it not a search wrapper

This is the part that I'd build the whole demo around.

Grants.gov returns `cfdaList: ["93.242"]` on every opportunity. USASpending accepts `program_numbers: ["93.242"]` as a filter. **Those are the same identifier.** I verified both sides return real data.

That join means for any opportunity the agent surfaces, it can also answer — from free public data, instantly:

- Who has actually won money under this program before?
- What's the median award size, versus the ceiling the announcement advertises?
- How many awards get made per cycle → what are my real odds?
- Are the winners all $200M research universities, or are organizations my size winning?

That last question is the one that kills most small-nonprofit grant applications, and it's the reason "should we even apply?" is worth more than "here are 40 grants." A human grants consultant charges for that analysis. **Your agent does bid/no-bid with evidence, not just discovery.** No competitor at the free tier does this, and it's impossible without the CFDA join.

#### Caveat: what the 990 API does *not* give (verified)

An earlier draft of this doc claimed ProPublica's API yields a funder's *giving history*. That is wrong, and the correction matters for scoping.

The API returns 990-PF **financial summary** fields, not itemized Schedule I grantee lists. Verified for RWJF (EIN 22-6029397):

```
tax_yr 2023 · contrpdpbks $551,244,399 · distribamt $645,951,613
fairmrktvalamt $13.7B · grntindivcd 'Y' · operatingcd 'N'   (× 10 years)
```

So it supports **capacity and eligibility screening** — how much a foundation gives, its size, whether it funds individuals, its trend — but *not* "who did they fund." Grantee-level detail exists only inside the linked PDF. Parsing those PDFs would reintroduce exactly the extraction fragility this whole design avoids, so it stays out of v1.

(The IRS publishes 990 e-file XML in bulk with real Schedule I detail — free, but a bulk-ingest project. Post-v1 at the earliest.)

#### Honest coverage statement

| Layer | Coverage |
|---|---|
| Federal opportunities | **Complete, authoritative** — Grants.gov is the mandatory federal clearinghouse, not one site among many |
| Federal award history | **Complete, authoritative** |
| Foundation capacity / eligibility | Good |
| Foundation open calls | **Absent — real gap** |
| State / local grants | **Absent — real gap** |

Why the gap isn't fatal: the target user is a small nonprofit, and federal grants are where a wrong decision costs the most (largest awards, most complex applications, highest cost of pursuing bad fit). The gap sits where the value is lowest. It also exists for *everyone* at this price point — foundations largely don't publish structured RFPs, which is why Candid and Instrumentl charge what they charge and still rely on 990s plus manual curation.

**Say this out loud in the demo rather than hoping nobody asks:** federal is complete today, foundations are screened on capacity, adding state portals is a new adapter and not a rearchitecture. Then make sure the source layer is genuinely adapter-shaped so that claim is true.

### Role breakdown (Step 1 deliverable, sketched)

| Sub-function | Impact | Automate? |
|---|---|---|
| Opportunity discovery | High | ✅ Fully — scheduled sweep |
| **Fit scoring / bid–no-bid with award-history evidence** | **Highest** | ✅ **The core differentiator** |
| Deadline & milestone management | High | ✅ Fully — Calendar, backward-planned from close date |
| Narrative drafting (need statement, org capacity) | High | ✅ Draft — human edits |
| Eligibility screening (501c3 status, geography, applicant type) | Med-High | ✅ Fully — deterministic rules |
| Funder research (990s, giving history) | Medium | ✅ Fully |
| Budget construction | Medium | ⚠️ Assist only |
| Board/ED reporting | Medium | ✅ Weekly digest |
| Relationship-building with program officers | High | ❌ Stays human — say this out loud in the video |

Naming the last row explicitly is worth points on "problem-solving": it shows you understand the role rather than claiming to replace all of it.

### Proactive actions (Cloud Scheduler — fits in 3 jobs)

1. **Daily sweep** — new/updated opportunities → score → alert only on high-fit matches.
2. **Deadline watch** — backward-plans milestones (LOI, draft, board review, submit) and nudges when a stage slips.
3. **Weekly pipeline digest** — email to the ED: what's live, what's at risk, what needs a decision.

### Stack

- **Frontend:** Next.js + Tailwind — org profile setup, opportunity pipeline board, fit-score explanation view with the award-history chart, draft editor.
- **Backend:** Cloud Run + Cloud Scheduler (Always Free), Gemini 2.5 Flash for scoring and drafting.
- **APIs:** Grants.gov (2 endpoints), USASpending, ProPublica 990, Google Calendar, Gmail. All free, four of them keyless.

---

## 5. What I'd do next

1. Confirm the role.
2. Write the SRS → send to kidus@brain3.ai for approval **before** building (the brief requires this, and it's a free early signal).
3. Build.

**Fallback if they reject the role:** Finalist C (compliance analyst) reuses ~80% of the architecture — swap the Grants.gov adapter for the Federal Register adapter, keep scoring/calendar/digest identical.

---

### Sources

- [Grants.gov API Guide](https://grants.gov/api/api-guide) · [Search2](https://grants.gov/api/common/search2)
- [Federal Register API docs](https://www.federalregister.gov/developers/documentation/api/v1)
- [SAM.gov Opportunities API](https://open.gsa.gov/api/get-opportunities-public-api/)
- [Grant writing fees — Instrumentl](https://www.instrumentl.com/blog/grant-writing-fees) · [Funding for Good](https://fundingforgood.org/how-to-determine-grant-writing-fees/)
- [Instrumentl pricing analysis](https://www.fundrobin.com/articles/how-to-guide/ai-tools-for-nonprofits/instrumentl-pricing-roi-small-nonprofits-2026/)
