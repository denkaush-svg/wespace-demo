# Step 9 — Правка (opus, per roles.json step 9: produces "исправлено, вот где" / "возражение, потому что" per finding)

## Before-run line (agent's own baseline, verbatim)
```
$ node src/test/smoke.js
checks: 1954  passed: 1954  FAILED: 0
```

## Findings table — all 11 from `.takt/evidence/07-codex-raw.md`, each with exactly one outcome

| # | Finding | Outcome | Location | Proof |
|---|---|---|---|---|
| 1 | Request lost on quick thread-switch | Закрыта | `src/js/engine.js:844-848` — guard now checks `turn.status === 'cancelled'` instead of `!same()` | `[проверено прогоном: `node src/test/live-ux.js`]` — "a question asked just before switching threads still reaches the network" |
| 2 | Follow-up chip bypasses busy-guard; wrong request cancelled | Закрыта | `src/js/engine.js:1393-1394,1403` `askGuarded()`; `src/js/engine.js:819-824` cancels the replaced turn | `[проверено прогоном: `node src/test/smoke.js`]` — `probe:turnChip` (4), `probe:turnReplace` (3) |
| 3 | Model failure hides as ordinary local answer | **Отложена** | root cause `src/js/agent.js:845` — out of border per `00-intent.md` §3 | Recorded at `.takt/evidence/09-deferred.md:5-33` with reason, rejected workaround, and requirement for next takt |
| 4 | Accepted mode/depth disappear at `web` stage | Закрыта | `src/js/engine.js:903` `STAGE_SAID` table keyed on `turn.stage` | `[проверено прогоном: `node src/test/smoke.js`]` — `probe:turnWeb` (4) |
| 5 | General reset doesn't cancel active request | Закрыта | `src/js/engine.js:686,699` — `abortAllTurns()` is now the first line of `reset()` | `[проверено прогоном: `node src/test/smoke.js`]` — `probe:turnReset` (4) |
| 6 | `done.ms` dropped in transport | Закрыта | `src/js/live.js:1004,1009` — `ms` carried into `ran`/`reply` | `[проверено прогоном: `node src/test/smoke.js`]` — done.ms transport block (2) |
| 7 | `model_started` sent before spawn confirmed | Закрыта | `server/proxy.js:1051` — stage now announced by the `spawn` event, not the return of `spawn()` | `[проверено прогоном: `node server/test/proxy-test.js`]` — "a CLI that could not be launched is never reported as a running model" |
| 8 | Manual abort still runs offline planner internally | **Отклонена** | same root as #3, `agent.js:857,867`, out of border | Visible-symptom half already verified false (see below); the wasted-CPU half is not observable from inside this border |
| 9 | No client-side watchdog | Закрыта | `src/js/engine.js:801,960` — `watchdogMs = 135000` (above server's 120000) + `Promise.race`; `engine.js:584,591` failed-card with retry | `[проверено прогоном: `node src/test/live-ux.js`]` — block D (4 checks) |
| 10 | Progress text violates stage contract | Закрыта partial / rest rejected on contract grounds | `src/js/engine.js:903` — `accepted`/`model_started` no longer share one line, `web`/`streaming` named distinctly | `[проверено прогоном: `node src/test/smoke.js`]` — "«принят» и «модель работает» не одна строка". Sub-claims about 8s/30s threshold states and pre-delta "Формулирую ответ" rejected: `00-intent.md` §2 specifies a continuous `Date.now()-startedAt` counter and 7 named stages, not threshold states; "Формулирую ответ" only becomes active inside `onText`, i.e. on the real first `delta` |
| 11 | `data-cgask` also bypasses guard | Закрыта | `src/js/main.js:285` — first-screen suggestion now routed through the same `send()` as the Send button | `[проверено прогоном: `node src/test/smoke.js`]` — `probe:turnCgask` (3) |

## Revert-would-redden self-check (per finding, mutation-tested by the agent — copies made in `/c/temp/takt-step9-mut/`, restored, deleted)

- **#1**: reverting the guard to `!same()` → `node src/test/live-ux.js` → 4 FAILED, first: "a question asked just before switching threads still reaches the network [calls=0]" — exact signature of Codex's own probe.
- **#2 (chip)**: reverting `askGuarded` to `freeReply` in the chip handler → `node src/test/smoke.js` → 2 FAILED: "a follow-up chip in a busy thread must not start a second request [requests=2]" + the free-thread counterpart.
- **#2 (floor, replaced-turn abort)**: removing the cancel-on-replace block → 1 FAILED: "a turn that replaces a running one closes the request it replaces [first aborted=false]".
- **#4/#10 (stage text)**: reverting to one shared string for two stages → 3 FAILED across mode/depth-survives-web and the "«принят»≠«модель работает»" check.
- **#5 (reset)**: removing `abortAllTurns()` from `reset()` → 1 FAILED: "a general reset aborts the request that was still running [aborted=false]".
- **#6 (done.ms)**: removing `reply.ms = ran.ms` → 1 FAILED: "how long the call took travels with the reply, not dropped in transport [ms=undefined err=null]".
- **#7 (model_started)**: reverting to announce on `spawn()`'s return → proxy-test 1 FAILED: "a CLI that could not be launched is never reported as a running model".
- **#9 (watchdog)**: pushing the watchdog trigger out by a day (i.e. simulating "no watchdog") → live-ux 3 FAILED: stream-never-ends / request-actually-aborted / retry-card-shown.
- **#11 (cgask)**: reverting to direct `routePrompt(d.cgask)` → smoke 2 FAILED: same signature as #2.
- **#8 (rejected)**: nothing reverts — no fix exists for this finding in this border. The observable half (cancelled turn renders nothing) is already covered by `probe:turnReplace`/`probe:turnReset`; the CPU-waste half is not observable from within `00-granica.txt`'s file list at all.

## Changed files
```
src/js/engine.js
src/js/main.js
src/js/live.js
server/proxy.js
src/test/smoke.js
server/test/proxy-test.js
src/test/live-ux.js
.takt/evidence/09-deferred.md   (new)
```
`src/js/agent.js` — untouched (confirmed: `git diff --stat` shows no entry for it). No existing assertion in `src/test/smoke.js` was removed or weakened — only new blocks added (1954 → 1974 checks).

## After-run line (agent's own, verbatim)
```
$ node src/test/smoke.js
checks: 1974  passed: 1974  FAILED: 0

$ node server/test/proxy-test.js
all proxy checks passed

$ node src/test/live-ux.js
checks: 16  passed: 16  FAILED: 0
```

## What was seen nearby and deliberately not touched
- `src/js/agent.js:845,857,867` — silent offline fallback, root of #3/#8, out of border.
- `endTurn()` now keeps a `failed` turn in `turns[threadId]` (needed so «Повторить» has something to retry) — one entry per thread, no leak, but worth remembering.
- The `beat` ticker (2200ms) re-renders the whole card on every tick — untouched, out of finding scope.
- `processCard()` prints the full step list at once rather than progressively revealing it — kept as-is per #10's resolution; a future "progressive reveal" request would be a presentation task, not a turn-state task.
- `CFG.stallMs` is read from `WESPACE_PROXY_STALL_MS` server-side; the client watchdog (135000ms) is a hardcoded constant, not derived from the server's actual configured limit. If the server limit is ever raised above 135s via env var, the client watchdog would fire before the server's own timeout. Not fixed — a new contract between `proxy.js` and `engine.js`, outside the 11 findings.

---

## Orchestrator's independent verification (this pass, after the fix agent's report)

- `git status --porcelain` / `git diff --stat` in the worktree: matches the agent's own file list exactly — 7 tracked files modified (`server/proxy.js`, `server/test/proxy-test.js`, `src/js/engine.js`, `src/js/live.js`, `src/js/main.js`, `src/test/live-ux.js`, `src/test/smoke.js`), 1 new untracked file (`.takt/evidence/09-deferred.md`), no stray `.backup`/copy files, no staged git-write residue.
- Re-ran all three suites myself, sequentially, independent of the agent's own run: `node src/test/smoke.js` → `checks: 1974 passed: 1974 FAILED: 0`; `node server/test/proxy-test.js` → `all proxy checks passed` (spot-checked the new block: "a CLI that could not be launched is never reported as a running model" present and green); `node src/test/live-ux.js` → `checks: 16 passed: 16 FAILED: 0`. All three match the agent's reported after-run numbers exactly.
- Read `src/js/engine.js:780-880` directly myself: confirmed `endTurn()` now keeps `cancelled`/`failed` turns and drops only completed ones (784-789); confirmed the quick-switch guard at 844/848 now reads `turn.status === 'cancelled'`, not `!same()` — thread-switching alone no longer kills a turn, only an explicit cancel/replacement does. This is the fix for finding #1, and it is real, not cosmetic.
- Read `src/js/engine.js:803-826` directly: confirmed the "floor under the door" for finding #2 — `freeReply()` now cancels the previous turn on the same thread (`prev.status='cancelled'; prev.abortController.abort()`) before creating the new one, closing the exact bug Codex found (wrong turn getting cancelled, phantom concurrency slot).
- Read `.takt/evidence/09-deferred.md` in full: the deferral for finding #3/#8 is a real deferral, not a hidden drop — it names the exact root cause (`agent.js:845/857/867`), the border rule that excludes it (`00-intent.md` §3), an engine.js-side workaround that was considered and rejected with a stated reason (false-positive offline banner on legitimate offline demo runs), and a concrete requirement for the next takt (`askAsync` returning `{reply, source}`). This satisfies the step-9 role's "Отложена" bar — a real location, not "I'll keep it in mind."
- Confirmed `src/js/agent.js` carries zero diff against base (`git diff <base>..HEAD -- src/js/agent.js` — no output), matching the border exclusion in `00-intent.md` §3.

## Decision this step drives
9 of 11 findings closed with mutation-tested proof; 1 (#8) legitimately rejected as unobservable/unfixable inside this border; 1 (#3) legitimately deferred with a recorded requirement for a future takt whose border includes `agent.js`. No finding was silently dropped. Ready for step 10 (Перепроверка, blind to this report, reads code and diff directly).
