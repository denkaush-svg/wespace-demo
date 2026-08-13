# Design question — how a Concierge call should be specified

Date: 2026-08-13 · Status: OPEN, under review · Decision owner: principal

This document states a problem and lays out options. It deliberately contains **no
recommendation** — it is written to be handed to independent reviewers.

---

## 1. What exists today

The stand is a single-file demo CRM for Dubai commercial brokers. The Concierge is
a chat agent inside it.

**Data access (read).** `src/js/query.js` is a declarative read layer: a whitelist of
named collections (`clients`, `deals`, `objects`, `requests`, `tasks`, `events`,
`companies`, `inbox`, `market`), with `where` / `groupBy` / `aggregate` / `sort` /
`limit`. Every result carries the rows it was computed from and the store revision.
`src/js/agent.js` defines ~13 named *readings* (a reading = a labelled query, e.g.
`deals_active`, `requests_hot`), which is what the evidence chips under an answer
re-read from.

**Data access (write).** `src/js/store.js` exposes `preview(ops)` / `apply(ops)`: a
fixed operation vocabulary (`updateDeal`, `updateClient`, `updateRequest`,
`updateTask`, `updateObject`, `dealStage`, `addTask`, `addEvent`), a per-collection
writable-field whitelist tiered `safe` / `guarded`, all-or-nothing batches, and
optimistic concurrency against a data revision. Guarded changes require a human click.

**The model call.** `server/proxy.js` runs on a VPS and reaches the model through the
`claude` CLI on a subscription (not the metered API). One question = one fresh CLI
process, stateless. The browser posts data only — question, a ~10 KB digest the
stand's own code computed, a short history, and the thread scope. All instructions
live server-side, because the endpoint is public and unauthenticated. `WebSearch` and
`WebFetch` are removed from the session.

**The invariant everything is built around:** *the model narrates; the code owns every
number.* A figure in an answer can be opened and shown as the rows it was computed
from, at a revision.

**The controls that do not work.** The composer renders a mode picker (7 modes: Авто,
Инвест-анализ ROI, Due-diligence off-plan, Квалификация из чата, Co-broking, Оценка
CMA, Матчмейкинг), a depth segmented control (Быстро / Размышление / Глубоко), a
multi-select context menu and an attach menu. None of `cgMode`, `cgDepth`, `cgCtx`
appears anywhere in `live.js`, `agent.js` or `proxy.js`. **Every question produces the
same call.** Verified by search, 2026-08-13.

---

## 2. The problem

Make the controls specify the call. The open question is *what a specification should
consist of*, and how much of it may be fixed in advance.

### 2.1 The objection that prompted this document

A first proposal defined each mode as a record including a fixed number of model
rounds (1, 2 or 3). The objection from the principal:

> Tasks vary widely. Some questions need one call, some need several. If the round
> count is fixed per mode in advance, we are constrained by a guess.

This appears to be correct and the document treats it as an open defect of that
proposal rather than as a settled matter.

### 2.2 Task taxonomy observed in this domain

Broker requests seen in fixtures, scenarios and live runs fall into at least three
shapes, and they are not the same kind of computation:

- **Deterministic pipeline.** The shape is known before the question is read:
  "собери записку по сделке", "посчитай ROI по этому объекту", "сформируй CMA-таблицу
  по району". Fetch a known set of rows → compute → render into a known artifact.
  A model is needed for narration and judgement, not for deciding the steps.
- **Bounded lookup.** "сколько сделок в работе", "что просрочено", "какой статус у
  заявки Анны". One read, one sentence.
- **Open-ended analysis.** "что мешает закрыть эти сделки", "куда вкладывать под
  аренду", "почему этот лид не двигается". The set of reads needed is not knowable in
  advance; it depends on what the first reads show.

### 2.3 The second question: the data layer of the real product

The demo runs on fixtures. The product will not. Expected shape:

- **Structured** — CRM entities in a database (requests, deals, lots, objects,
  clients, companies, tasks, events, commissions).
- **Relationship-heavy** — заявка → сделки → лоты → объект → застройщик → компания →
  контакты; co-broking network; agent ↔ client ↔ deal. Possibly a graph store.
- **Unstructured, vectorised** — WhatsApp threads, voice notes, payment plans,
  brochures, contracts, competitor listings.
- **An object model** over all of it.

The question: how should an agent reach that data? Specifically whether text-to-SQL
belongs in the path, and how structured and unstructured retrieval get joined so that
the answer can still (a) cite where a number came from and (b) drive a write against a
real entity id.

---

## 3. Constraints in force

1. **Public, unauthenticated endpoint.** Question text is attacker-controlled. Prompt
   text must not come from the browser.
2. **Subscription CLI, shared five-hour window** with production systems (a diagnostic
   bot, a radar, a cockpit). Money is not the constraint; the shared rate window is.
3. **Provenance invariant** (§1). A figure without openable rows is a regression.
4. **Writes stay behind a human click**, validated against ids that came from the data.
5. **The stand is a demo shown to developers and investors.** Perceived capability
   matters as much as correctness; a visible hang is a failure even if the answer is
   right.
6. **Graceful degradation exists**: any failure falls back to a deterministic offline
   planner that answers everything, less well.

---

## 4. Options — control model

**A. Mode registry with fixed rounds.** Each mode declares framing, data slice, allowed
output shapes, write rights, and a fixed number of model rounds. Simple, predictable
latency and cost, testable. Objection in §2.1 applies.

**B. Budgeted loop.** Modes declare *capabilities and a budget* (max rounds, max
wall-clock, max reads), not a step count. The model requests data declaratively; code
executes and returns rows; the loop ends when the model says it has enough or the
budget is spent. Round count varies with the question.

**C. Two tiers, routed.** Known-shape tasks (§2.2 first and second bullets) run a
deterministic pipeline where code orchestrates and the model narrates; open-ended tasks
run a budgeted loop. A router decides which, and says which it chose.

**D. Status quo plus cosmetics.** Modes only change the framing sentence; one round
always. Cheapest; the controls stop lying but gain little.

Cross-cutting sub-questions:

- Should depth (Быстро / Размышление / Глубоко) mean *reasoning effort*, *rounds of
  data access*, *permission to reach outside*, or a bundle of all three?
- Should the round budget be per-mode, per-depth, or per-question (estimated by a
  router)?
- Who terminates the loop — the model's own claim, a code-side check ("no new rows
  since last round"), or both?
- What does the user see while a multi-round call runs?

## 5. Options — data access path

**A. Curated query layer only.** The current design, scaled: a bounded, named,
typed query surface the model composes declaratively. Whitelist by construction,
provenance for free, testable. Cannot express what was not modelled.

**B. Text-to-SQL over the operational schema.** The model writes SQL. Maximum
expressiveness; validation, provenance, injection surface and read-only enforcement all
become open problems, and the schema is an OLTP model not designed to be queried by a
stranger.

**C. Text-to-SQL over a curated semantic layer** (views / metrics definitions), with
the raw schema not exposed.

**D. Hybrid retrieval, entity-scoped.** Resolve entities from the question against the
object model first, use their ids as a hard filter, then vector-search *within* that
scope; return chunks that carry entity id, source and date. Structured layer scopes,
vector layer finds language.

**E. Graph traversal API** for relationship questions, either over a graph store or over
explicit edges in the relational model.

Sub-questions:

- Do numbers ever come from unstructured sources, or only from the structured side?
  (A retrieved brochure chunk contains prices.)
- How does a retrieved chunk become a citation the reader can open?
- Does a write ever originate from unstructured retrieval, and if so how is the target
  id established?
- Is a graph store justified by the query patterns of a brokerage, or do explicit edges
  plus a traversal API cover them?

---

## 6. Provenance of what is stated above

Inheritance is not validation. Where a statement comes from:

| Statement | Origin |
|---|---|
| Declarative read layer as the only read path | **inherited** — built 2026-08-05, never independently reviewed as an architecture |
| Transactional write layer, tiered whitelist, human click | **inherited** — same, plus two cross-model review rounds on the code |
| Provenance invariant (§1, §3.3) | **inherited** — the founding constraint of the Concierge work |
| Instructions server-side only | **derived now** from the public-endpoint constraint; also a review finding |
| The seven mode names and three depth names | **inherited** — written as UI copy for the demo, never designed as call specifications |
| Controls reach nothing (§1 last paragraph) | **measured now** — search over live.js / agent.js / proxy.js, 2026-08-13 |
| Task taxonomy (§2.2) | **derived now** from fixtures, scenarios and live-run transcripts |
| Objection to fixed rounds (§2.1) | **raised by the principal**, treated here as open |
| Expected product data shape (§2.3) | **stated by the principal**, not yet designed |

## 7. Review outcome (2026-08-13)

Two independent reviewers, both blind to any recommendation: a Claude critic and
Codex (different lab, decorrelated). **They disagreed on the control model**, which is
the useful part.

- **Codex → 4C** (deterministic pipelines for known shapes, budgeted loop for
  open-ended, routed). Fixed per-mode rounds are "the wrong abstraction"; fixed rounds
  inside a known pipeline are fine.
- **Claude critic → 4D** (framing only), on the grounds that 4B/4C is over-design for a
  demo and that the objection in §2.1 attacks a phantom: the implementation is already
  hard-locked at one round with no tool loop.

Both are right about different questions. The critic is right that today's round count
is 1 by construction, so §2.1 is not describing a live constraint. Codex is right that
the count cannot be attached to a mode once data stops fitting in one prompt.

### 7.1 Claims about the code, verified against the code

| Claim | Verified | Consequence |
|---|---|---|
| Numbers inside `blocks` are never checked against data (`live.js` `normBlocks`) | **true** — shape is validated, values are not | The provenance invariant holds for evidence chips and for the offline planner, **not** for figures inside a live answer's table or bars |
| The chip drops the revision it was read at (`agent.js:62` → `live.js` `evidenceFor`) | **true** | A chip opened later re-runs at the current revision; the answer and its evidence can silently disagree |
| A client disconnect does not kill the CLI process (`proxy.js` `aborted`) | **true** | A closed tab holds one of two concurrency slots for up to 75 s |
| `addTask` does not validate foreign ids such as `clientId` | **true** | A task can be created against a contact that does not exist |
| The digest reads `WS.store.data` directly, bypassing the query layer | **true** | "One read path" is aspirational; the digest is a second one |
| `query.js` does not type or whitelist fields | **true**, and harmless in memory (an unknown field is `undefined`), but it means the layer is a query *evaluator*, not a semantic layer |
| Codex's join-multiplication example for text-to-SQL (a deal with four lots counted four times) | not testable here — no SQL — but the cardinality trap is real in the stated product schema |

### 7.2 The finding that outranks the original question

The stated invariant — *the code owns every number* — is **not enforced**. It is a
prompt convention plus a partial mechanism (chips). A live answer's table is model
text. This is a larger defect than the round-count question and it changes the design:
if every displayed number must be code-owned, then rounds stop being a knob and become
a consequence — a round happens when the model needs data it does not have, which code
can check.

## 8. What reviewers are asked to judge

1. Is the objection in §2.1 fatal to option 4A, or is a fixed round count defensible?
2. Which of 4A–4D fits this domain, these constraints and this purpose — and what is
   the strongest argument *against* the one you pick?
3. Is the practical value of these constraints real, or is this over-design for a
   demo — what would be lost by doing far less?
4. For §5: is text-to-SQL a correct component here, a trap, or correct only in a
   specific position? What is the concrete failure mode you expect?
5. What is missing from this document that would change the answer?
