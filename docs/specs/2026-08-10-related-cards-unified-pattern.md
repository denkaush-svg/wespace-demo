# Design spec — unified pattern for related entity cards

Date: 2026-08-10 · Status: approved (3 forks resolved) · Author: session + 2 fable critics

## Card taxonomy (client framing, 2026-08-10)
Two families:
- **Process cards** — deal · request · promotion. They have a workflow FLOW. They share ONE
  flow-template (same header zones + tabs), with per-entity variation slots (the status element,
  boards, etc. differ by entity). This spec aligns the **request** to that template (deal is the
  reference); the **promotion** card joins the same family later.
- **Static cards** — client · object. A different, non-flow type. The **object card is NOT touched**
  (already well-built). The **client** already rides `entityPage`; its layout is not restructured —
  it only serves as the spine for the shared communication history.

## Goal
Align the request (a process card) onto the shared `entityPage(spec)` frame the deal already uses,
so the same kind of information sits in the same screen zone across process cards — focus habituates,
important stuff in the header, deeper detail in tabs. Add the piece the manager actually asked for:
a **followable communication trail** across request ↔ deal ↔ object without hunting between cards.

## What the two fable critics changed (scores 5/10 & 6/10 → ~8/10 with these)
1. No linear stepper on a request — requests loop, reject, spawn 2 deals. → **status chip + counters.**
2. Facing-pair RIGHT column must be "the object(s) this card is about." Deal = the bought object;
   request = **Объекты подбора (top-3)**, NOT the preference profile (that was false consistency).
3. Shared history via manual per-message tagging is fragile. → events are **anchored** to one
   entity; the "one client timeline" is a **merged read-view with filter chips**, no tagging.
4. КП reused by live link drifts. → **snapshot** КП into the deal on creation; request keeps the
   live КП. Show a document chain КП→MOU→SPA→DLD with statuses.
5. First screen = last contact + next action, not the preference profile (that's reference → Обзор).

## The shared spine (fixed zones, identical across cards)
`entityPage(spec)` renders: header (`spec.status`) → tab bar (`spec.tabs`) → tab body
(`spec.render(tab)`) → concierge. Header zone order (from `dealHeader`, the reference):

| Zone | Deal (exists) | Request (to build) |
|---|---|---|
| Hero banner | avatar + client + object + amount | avatar + client + "what they want" + budget |
| Status | stage stepper | **status chip + counters** (показано N · выбрал M · отклонил K) |
| «Сейчас:» line | essence phrase | essence phrase (keyed off offered/selected/kp/deal state) |
| Facing LEFT | «Ключевое» | «Ключевые условия» |
| Facing RIGHT | Клиент·связь + Объект сделки | Клиент·связь + **Объекты подбора (top-3)** |
| «Что сейчас» | next step + last events | **last contact** + next step + last events + «вся история» |

## Request card build (`requestSpec(id)` → `entityPage`)
Replace `viewRequestDetail`'s linear scroll with a spec plugged into `entityPage`.

- **Hero** `requestHero(r)`: mirror `dealHero` — avatar + client name + sub
  (`dealActionWord`-style + object line + budget). Reuse `.dhero` family.
- **Status** `reqStatus(r)`: derive one label —
  `Новая → На подборе → Выбирает → Готовим КП → КП отправлено → На сделку → Закрыта`,
  plus `Отклонена` when all offered are rejected and none selected. Counters from
  `offered` states. Rendered as a chip row, not a progress bar.
- **«Сейчас:»** `reqStatusPhrase(r)`: e.g. "подобрали 3 объекта, клиент выбрал 1 — собираем КП".
- **Facing LEFT** `reqKeyCard(r)`: budget · payment · type · goal · areas (today's «Ключевые условия»).
- **Facing RIGHT**: reuse `dealClientCard` shape as `reqClientCard(r)` (call/write/contacts) +
  `reqOffersMini(r)` (top-3 объектов подбора, `dealObjectMini`-style, click → object).
- **«Что сейчас»** `reqNowBlock(r)`: last contact (date+channel) + next step + last 3 comms events
  + «вся история» → История tab.

### Request tabs (aligned with deal for real consistency)
`Обзор / Подбор объектов / Задачи / Документы / История`
- **Обзор**: preference profile (`reqPrefProfile`, moved here from the old bottom) + сделки заявки.
- **Подбор объектов**: `reqOfferedBlock` (full picker with select/reject).
- **Задачи**: tasks for this request's client (broker sets "send КП by Fri" without leaving).
- **Документы**: КП (with date/version/status) + document chain (below).
- **История**: merged client comms view (below).

Note: the OBJECT card (static family) stays on `viewObjectDetail` by design — not migrated,
not touched. Process-card consistency is the target here, not one frame for all five cards.

## Communication history — anchored events + merged client view (Phase 1)
No manual per-message tagging. Each event is anchored to exactly one origin:
- request events → new `requestTimeline[reqId]` (reuse the event model, scope `request`),
- deal events → existing `dealTimeline[dealId]`,
- client events → existing contact feed.

`clientCommsTimeline(clientId, filter)` unions the client's own events + all their requests'
events + all their deals' events, sorted by `ord`, each row carrying an **origin badge**
("заявка" / "сделка · <name>" / "клиент"). Filter chips **[Эта заявка · Сделки · Всё]**:
- On the request История: default highlights this request; chips widen to the deals / all.
- On the deal История: default this deal; same chips.
One conversation, filtered slices — the manager follows request→deal→object in one place.
Cross-links already exist (request↔deals via `dealsBlock`/`dealRequestBlock`, deal→objects via
`dealLotsBlock`) and complete the trail.

## КП snapshot + document chain (Phase 1)
- `reqCreateDeal`: on deal creation, write an immutable `deal.kpSnapshot = { objectIds, at, version }`.
  The request keeps the live `r.kp`. Editing the request КП never mutates a created deal's snapshot.
- Document chain UI (Документы tab, both request and deal): a compact row
  `КП → MOU → SPA → DLD` with per-step status (готово / черновик / ожидается), demo-fixtured.
  Makes the doc trail visible; missing step reads as an action.

## Build order
1. `requestSpec` + `requestHero` + `reqStatus`/counters + `reqStatusPhrase` + facing pair
   (`reqKeyCard`, `reqClientCard`, `reqOffersMini`) + `reqNowBlock`; wire `viewRequestDetail`
   through `entityPage`. Tabs: Обзор / Подбор / Задачи / Документы / История.
2. `requestTimeline` model + `clientCommsTimeline(clientId, filter)` + filter chips; wire into
   request История and deal История (origin badges).
3. КП snapshot in `reqCreateDeal` + document-chain component in both Документы tabs.

Each step: rebuild (`node src/build.js`), live render + contrast probe (light+dark), smoke 267/267,
commit. CSS additions are theme-aware tokens (no theme.css plain selectors — dark/light parity).

## Non-goals (now)
Object card → entityPage migration; production AML/PEP; real Form A/F/MOU/SPA docs;
per-message NLP auto-tagging. Demo data stays plausible-but-invented.
