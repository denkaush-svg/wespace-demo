# Step 10 — Перепроверка (sonnet, blind to step 9's report per roles.json gate)

Role gate: «перепроверяющий не тот, кто правил, и не читает его отчёт». Step 9 was executed by opus; this step by sonnet, explicitly forbidden from opening `09-fix.md`, `09-deferred.md`, `.takt/current.jsonl`, or any commit message body. Every verdict below traces to code the role read itself or a command it ran itself.

Base for diff: `88c4a8e` (see "Defect found in the run's own record" below — the role caught that the SHA it was handed did not resolve, and substituted the correct one from `00-granica.txt`/`00-intent.md`).

## Verdicts — all 11 findings from `.takt/evidence/07-codex-raw.md`

| # | Finding | Verdict | Mutation-tested? |
|---|---|---|---|
| 1 | Quick thread-switch kills the turn | закрыта | yes — revert → live-ux 4 red, incl. `calls=0` (original probe signature) |
| 2 | Follow-up chip bypasses busy-guard | закрыта | yes — revert → smoke 2 red (`requests=2`, `requests=3`) |
| 3 | Model failure → silent unlabeled offline fallback | **не закрыта** | n/a — no fix exists in this border |
| 4 | mode/depth vanish at `web` stage | закрыта | yes — revert → smoke 1 red |
| 5 | `reset()` doesn't abort in-flight turns | закрыта | yes — revert → smoke 1 red (`aborted=false`) |
| 6 | `done.ms` dropped in transport | закрыта | yes — revert → smoke 1 red (`ms=undefined`) |
| 7 | `model_started` before spawn confirmed | закрыта | yes — revert → proxy-test 1 red, reproducing the original ENOENT probe exactly |
| 8 | Manual-abort fallback could leak onto the display | **закрыта, но ничем не защищена** | yes — revert → **nothing turned red** |
| 9 | No client-side watchdog | закрыта | yes, twice — value-below-server → 1 red; race removed → unhandled rejection crash |
| 10 | Progress text violates stage contract | закрыта | yes — revert → smoke 1 red |
| 11 | `data-cgask` bypasses guard | закрыта | yes — revert → smoke 2 red |

Detail per finding is in the role's own returned report; the two that carry consequence are expanded below.

## The two findings that are not cleanly closed

### #3 — «не закрыта» (agrees with step 9's own deferral, reached independently)
`git diff 88c4a8e..HEAD -- src/js/agent.js` → empty, confirmed twice by the role. The role then went looking for a *compensating* label on the display side, since `00-intent.md` §2 names one as an acceptance criterion («оффлайн-план с пометкой «нейросеть не ответила»»):

`[проверено прогоном: `grep -n "не ответил\|offline\|fallback\|banner" src/js/engine.js src/js/live.js src/js/agent.js`]` — no labeling logic anywhere on the display path. `src/js/live.js:17`'s unchanged doc comment still states the original design out loud: "to the offline planner **without saying so**."

Verdict stands as genuinely open. The file that would have to change is outside the border, so this is a boundary consequence, not an oversight — but the acceptance criterion in §2 is not met, and step 12 has to decide that explicitly rather than inherit it silently.

### #8 — «закрыта, но ничем не защищена» (a real gap step 9 did not report)
The guard is `src/js/engine.js:1025` — `if (turn.status === 'cancelled') return;` — sitting after the `Promise.race([watchdog, askAsync(...)])` and *before* the code that would write `agentCard(reply, workMid)` to the DOM. The role traced the whole path itself: `data-eng="cancelTurn"` → `main.js:319` → `engine.js` `handle()` → `cancelTurn` (`:562-568`), which sets `turn.status='cancelled'` synchronously and repaints the cancelled card.

**Mutation result, and this is the point:** removing line 1025 turned NOTHING red — `node src/test/smoke.js` → `checks: 1974 passed: 1974 FAILED: 0`, `node src/test/live-ux.js` → `checks: 16 passed: 16 FAILED: 0`. The role then hand-traced the removed branch to prove the mutation was substantive rather than inert: without the guard, execution falls through to `updateMsg(workMid, processCard(...), threadId); await delay(180); updateMsg(workMid, agentCard(reply, workMid), threadId);` — which would overwrite the cancelled card with the fallback answer, i.e. reproduce exactly the defect the finding describes.

So the behaviour is correct and the guard is load-bearing, but **no test drives "click Cancel, then let the async head resolve afterwards"**. This is precisely the state the step-9 role names as half-closed: «если молча откатить эту строку, что покраснеет? Ничего — значит правка ничем не защищена». Note the guard is PRE-EXISTING, not written by step 9 — step 9 classified #8 as «Отклонена» on border grounds and therefore never ran the revert-check on it. The divergence between the two steps is bookkeeping, not a disagreement about behaviour: both agree the display is correct today. What step 10 adds is that nothing keeps it correct tomorrow.

## Cross-cutting checks (role's own, verbatim)
- `src/js/agent.js` diff: none — `git diff 88c4a8e..HEAD -- src/js/agent.js` empty, confirmed twice (before any mutation work and again at the end).
- `src/test/smoke.js`: purely additive. No existing `check(...)` line touched or deleted — two new blocks only (`done.ms` transport, and the ~330-line turn-state block).
- Final sequential suite runs: `node src/test/smoke.js` → `checks: 1974 passed: 1974 FAILED: 0`; `node server/test/proxy-test.js` → `all proxy checks passed`; `node src/test/live-ux.js` → `checks: 16 passed: 16 FAILED: 0`.
- Final `git status --porcelain`: empty. HEAD unchanged at `0f9d624`.
- `/c/temp/takt-step10-mut/` deleted; no `.backup` left beside any original at any point.

## Defect found in the run's own record (not in the code)

The ledger's `init` entry carries `"base_sha": "00fcbee3adc120856679d7f5535efd91a10da691"`. That commit **does not exist in `wespace-demo`** — it is a commit in the `wewall` tooling repo, which is a different repository. Confirmed by the lead:

```
$ git -C .../wespace-demo/.worktrees/takt-concierge-turnstate cat-file -t 00fcbee3adc...
fatal: git cat-file: could not get object info
$ git -C .../wewall cat-file -t 00fcbee3adc...
commit
$ git -C .../wespace-demo/.worktrees/takt-concierge-turnstate cat-file -t 88c4a8e
commit          # and: merge-base --is-ancestor 88c4a8e HEAD → YES
```

`[проверено прогоном: `git cat-file -t 00fcbee3adc120856679d7f5535efd91a10da691`]`

The correct base is `88c4a8e`, which is what both `00-intent.md:4` and `00-granica.txt` say. The role was handed the wrong SHA in its dispatch (lead's error, carried over from the ledger), detected that it did not resolve, and substituted the correct one on its own rather than proceeding against a broken base or silently diffing against nothing — which is the behaviour the core role text asks for and the reason this step is worth its cost.

**Blast radius: none, verified.** No review in this run was actually performed against the wrong base: Codex at step 7 reported `git diff --check 88c4a8e..HEAD` (correct base), the lead's step-9 verification used working-tree-vs-HEAD diffs (base-independent), and step 10 used `88c4a8e`. The wrong SHA sat in the ledger and in one dispatch prompt without ever reaching a diff. It is recorded here because a later reader would otherwise take `base_sha` as authoritative.

## Lead's own verification of this step
- Re-ran the base-SHA check myself rather than taking the role's word for it — commands and outputs quoted above; the role's claim is correct.
- Confirmed the tree is clean and at `0f9d624` after the role's mutation work: `git status --porcelain` → empty.
- Confirmed `/c/temp/takt-step10-mut/` is gone.
- Note on this step's execution history: two earlier dispatches of step 10 were killed by the parent process exiting mid-run. The second left `src/js/engine.js` mutated (line 1025 removed — the #8 mutation). Recovered from the role's own temp copy after `git restore` was correctly refused by the `git-tree-guard` hook; `git status` clean afterwards. Step 9's work was already committed at that point, which is why nothing was lost — the argument for committing each confirmed step rather than accumulating.

## Decision this step drives
Nine findings are closed AND protected. Two need an explicit decision at step 12 (Приёмка), neither of which step 10 may take itself:
1. **#3** — an acceptance criterion in `00-intent.md` §2 is not met, because the file that would satisfy it is outside `00-granica.txt`. Accept as a boundary consequence with the deferral recorded, or widen the border.
2. **#8** — correct today, unprotected tomorrow. Either add the missing regression test (cancel → late resolve → assert the cancelled card survives) or accept the gap knowingly.
