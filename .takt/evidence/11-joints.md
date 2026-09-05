# Step 11 — Сверка стыков (Codex, per roles.json step 11: model `codex`)

Role gate: «предъявлен прогон, показывающий совпадение или расхождение; проверяется совпадение, а не наличие». `evidence_kind: run`, `verdict_needs_run: true`.

This step is on probation in `roles.json`: measured over four prior runs it found no defect first, three times retold the cross-model review's findings, once produced no artifact at all, and once made a false claim. The dispatch said so plainly and told it that retelling step 7's findings would not count. **This run it produced its own probe and found two divergences that are not in `07-codex-raw.md`** — both verified independently by the lead below.

Codex wrote and ran its own probe (`contracts-probe.js`, in a temp dir, since deleted) driving a real `server/proxy.js` over real HTTP/SSE with a fake CLI, and a jsdom client with real `fetch`/`AbortController`.

## Joints checked

| # | Joint | Verdict |
|---|---|---|
| 1 | Stage names across proxy.js → live.js → engine.js | совпадает |
| 2 | `done` event field set | **расходится — `model` теряется** |
| 3 | Cancellation contract (client abort → server slot release) | совпадает |
| 4 | Client watchdog vs server `stallMs` | **расходится при поднятии серверного лимита** |
| 5 | Shape of the `turn` object across creator/transport/card/cancel/reset | совпадает |

## 1. Stage names — совпадают
`[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]`
```
WIRE_STAGE_SET_MATCH=true server=accepted,model_started,web live=accepted,model_started,web engine=accepted,model_started,web
ENGINE_DISPLAYS_EACH_WIRE_STAGE=true {"accepted":true,"model_started":true,"web":true,"streaming":false}
STREAMING_IS_DELTA_DERIVED_NOT_SERVER_STAGE=true engine=context_ready,accepted,model_started,web,streaming server=accepted,model_started,web
```
No stage the server sends is dropped by the client, and none the client expects is never sent. `streaming` is a locally derived state (from the first `delta`), not an expected wire event — so its absence from the server set is correct, not a gap.

## 2. `done` fields — расходятся: `model` is lost in transport
`[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]`
```
SERVER_DONE_KEYS=chat,depth,doc,docWhy,mode,model,ms,plan,say
LIVE_REPLY_KEYS=blocks,depth,evidence,kind,mode,ms,next,report,speak,text
DONE_MODE_DEPTH_MS_TRANSFER=true mode=roi depth=deep ms=974
DONE_MODEL_NOT_EXPOSED=true server=claude-opus-5 reply=undefined
DONE_LANGUAGE_META_MAPPED_TO_REPORT=true server=en/ru/asked replyTop=undefined/undefined/undefined report={...,"lang":"en","why":"setting"}
```
Language fields are not lost — they are deliberately remapped into `reply.report.lang/why`, which is a rename, not a drop. **`model` is genuinely dropped.** No functional breakage today; the diagnostic contract is lossy.

**Lead's independent confirmation** — this is the sibling of the `done.ms` defect that step 9 DID fix, left behind in the same object literal:
`[проверено прогоном: `grep -n "model:" server/proxy.js`]` → `server/proxy.js:1256` sends `model: CFG.model` on the `done` event.
`[проверено прогоном: `sed -n '995,1015p' src/js/live.js`]` → `live.js:998-1004` builds `ran` from `mode`, `depth`, `doc`, `chat`, `docWhy`, `ms` — and no `model`. The step-9 comment explaining why dropping `ms` was a defect sits directly above the line where `model` is omitted for exactly the same reason.

## 3. Cancellation contract — совпадает
`[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]`
```
CANCEL_CHAIN={"button":true,"signalAborted":true,"serverInFlight":0,"cardCancelled":true}
CANCEL_BROWSER_TO_SERVER_SLOT=true aborted=true inFlight=0
CANCEL_FOLLOW_UP={"servedDelta":1,"serverInFlight":0,"replyRendered":true}
CANCEL_FREES_NEXT_REAL_CALL=true servedDelta=1 inFlight=0
```
This is the one chain step 7 explicitly said it had NOT checked end to end («Единым прогоном не проверял цепочку «реальная кнопка браузера → настоящий fetch → proxy → fake CLI»; клиентский abort и освобождение server slot проверены раздельно»). Now checked as one signal, against a real proxy at `concurrency=1`: the button aborts the signal, the broken fetch reaches the server, the slot frees, and the next real call completes. This closes step 7's own stated gap.

## 4. Client watchdog vs server `stallMs` — расходятся
`[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]`
```
SERVER_STALL_ENV_OVERRIDE=true status=0 stdout=180000
PRODUCTION_LIMIT_ORDER={"clientWatchdog":135000,"serverStallFromEnv":180000,"clientEndsFirst":true}
PRODUCTION_LIMITS_DIVERGE_WHEN_SERVER_RAISED=true client=135000 server=180000
SCALED_LIMIT_RESULT={"clientWatchdog":600,"serverStall":2000,"elapsedFromServerStart":596,"beforeServerStall":true,"failedCard":true,"serverInFlight":0}
CLIENT_WATCHDOG_WINS_BEFORE_LARGER_SERVER_STALL=true elapsed=596 serverStall=2000
```
`WESPACE_PROXY_STALL_MS=180000` really does raise the server limit, while the client stays on a hardcoded `135000` and kills a request the server still considers valid — the visitor gets a connection-error card for a call that was fine. Verified end to end with proportionally scaled limits (client 600 ms / server 2000 ms): the client ended the call at 596 ms, before the server's own limit, and showed the failed card. The slot did release correctly.

Note on provenance: the step-9 fix agent listed this exact risk in its own «seen nearby, not touched» section. Step 11 is what turned that observation into a run. The `00-intent.md` §2 criterion says the client watchdog must sit «чуть больше серверного stall limit» — it does against the DEFAULT (135000 > 120000), and stops doing so the moment the server's env var is raised past 135 s. Whether that counts as met is a step-12 decision, not step 11's.

## 5. `turn` object shape — совпадает
`[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]`
```
TURN_SHAPE_KEYS_MATCH=true actual=abortController,depth,id,lastProgressAt,messageId,mode,stage,startedAt,status,text,threadId expected=(same)
TURN_CREATOR_RENDER_TRANSPORT_LINKS_MATCH=true stage=accepted mode=roi depth=deep
TURN_CANCEL_CONSUMERS_MATCH=true status=cancelled stage=cancelled
TURN_END_CONSUMERS_MATCH=true removed=true rendered=true
TURN_RESET_CONSUMERS_MATCH=true before=2 after=0 aborted=2
PROBE_RESULT=PASS
```
The field set matches `00-intent.md` §2's specified shape exactly (`id`, `threadId`, `status`, `stage`, `startedAt`, `lastProgressAt`, `mode`, `depth`, `abortController`, `messageId`), and creator, transport, card, cancel, end and reset all use the same names. Two live turns under `reset` were both aborted and removed.

## Standard suites
`[проверено прогоном: `node src/test/smoke.js`]` → `checks: 1974  passed: 1974  FAILED: 0`
`[проверено прогоном: `node server/test/proxy-test.js`]` → `all proxy checks passed`
`[проверено прогоном: `node src/test/live-ux.js`]` → `checks: 16  passed: 16  FAILED: 0`

## Not checked (role's own, verbatim)
- The real Claude CLI was not invoked, to avoid spending the shared subscription; a fake CLI with a real process, real SSE and a real HTTP server was used instead. `[не проверено прогоном: реальный внешний вызов исключён намеренно]`
- The real 135 s / 180 s wait was not performed; exact production values were checked, and the same end-to-end path was rerun with proportionally scaled limits. `[не проверено прогоном: полный временной интервал заменён масштабированным воспроизведением]`
- Chrome/iOS were not launched; the browser side ran in `jsdom` with real `fetch`/`AbortController`. `[не проверено прогоном: задача шага ограничена модульными контрактами]`

## Cleanliness
`[проверено прогоном: `git status --porcelain`]` → empty. Temp probe directory deleted — lead confirmed independently: `ls /c/temp/takt-step11-mut` → `No such file or directory`.

## Two new findings this step produced (neither is in `07-codex-raw.md`)
1. **`done.model` dropped in transport** (`live.js:998-1004` vs `proxy.js:1256`) — sibling of the fixed `done.ms`, same object literal, left behind.
2. **Client watchdog is a hardcoded constant while the server limit is env-configurable** (`engine.js:801` vs `proxy.js:91`) — the §2 acceptance criterion holds at defaults and breaks as soon as `WESPACE_PROXY_STALL_MS` is raised above 135 s.

Both go to step 12 (Приёмка) as decisions, together with step 10's two residual items (#3 unlabeled offline fallback, #8 unprotected cancel-guard). This step does not fix them — its remit is to show divergence, not to close it.

## Note for the harness verdict (the real purpose of this run)
This is the strongest showing this role has had. Its recorded history is four runs of prose with proof in one; this run produced an independent probe, two findings that were not retellings, and literal output for every claim — including closing the end-to-end cancellation chain that step 7 had explicitly left unchecked. The dispatch differed from prior ones in one deliberate way: it named the role's own failure history and stated up front that retelling the previous review would not count. Worth recording as a data point on whether the probation should end.
