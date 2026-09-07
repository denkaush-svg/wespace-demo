# Приёмочные тесты — Task 7: наблюдаемое/отменяемое/адресуемое состояние ожидания Консьержа

Ветка `session/takt-concierge-turnstate`. Тесты писались от намерения (см. `01-recon.md` и постановку Task 7), до какой-либо реализации — граница `.takt/sealed/`/`00-granica*` не читалась и не листалась ни разу за сессию.

Изменены/созданы три файла:
- `src/test/smoke.js` — расширен блоком «Waiting for the Concierge» (10 новых чеков).
- `src/test/live-ux.js` — новый файл, реал-таймовые тесты (8 чеков), НЕ включён в `npm test`. Предлагаемый (не добавленный) npm-скрипт: `"live:ux": "node src/test/live-ux.js"`.
- `server/test/proxy-test.js` — расширен `stageChecks()` и усиленным тестом на освобождение слота при отмене (сделано в предыдущей сессии; в этой сессии файл не трогал, только перепрогнал).

Итог по всем трём: **было бы `npm test` зелёным и `test:proxy` зелёным, если бы граница уже была реализована; сегодня оба падают** (см. `03-acceptance-red.txt` — полный сырой вывод трёх прогонов).

## Сводка

| Файл | Всего чеков | Было (baseline, без моих чеков) | Стало | Новых чеков | RED | GREEN |
|---|---|---|---|---|---|---|
| `src/test/smoke.js` | 1954 | 1944 (проверено: `git show HEAD:src/test/smoke.js` → `checks: 1944 passed: 1944 FAILED: 0`) | 1950 passed / 4 FAILED | 10 | 4 | 6 |
| `src/test/live-ux.js` | 8 | 0 (файла не существовало) | 7 passed / 1 FAILED | 8 | 1 | 7 |
| `server/test/proxy-test.js` | 132 | 128 (не менялся в этой сессии; создан в предыдущей) | 128 OK / 4 FAILED | 4 | 4 | 0 (для новых; существующие 128 не тронуты) |

Итоговый код выхода **всех трёх прогонов — 1 (не ноль)** [проверено прогоном: `echo $?` после каждого из трёх `node ...` — все вернули `EXIT=1`, кроме `acceptance-audience.js`/`acceptance-incident-consent.js`, которые в scope Task 7 не входят и остались зелёными].

---

## 1. `src/test/smoke.js` — блок «Waiting for the Concierge»

### 1.1 RED (4) — доказывают реальный пробел в коде

**`turn-state · Enter in a busy thread must not start a second call (main.js:613 has no guard)`**
Ассерт: после первого `clickSend()` (тред занят через стаб `eng.freeReply`), нажатие Enter во второй раз не должно увеличивать счётчик вызовов.
Факт [проверено прогоном]: `✗ ... [calls=2]` — второй Enter реально запускает второй вызов.
Причина в коде: `src/js/main.js:610-616` — обработчик `Enter` вызывает `routePrompt(promptValue('cgPrompt'))` напрямую, без проверки `WS.engine.inFlight` (гвард стоит только на клике, `main.js:508-520`).

**`turn-state · a different, idle thread is not blocked by another thread being busy`**
Ассерт: занятость треда А не должна блокировать отправку в свежеоткрытом треде Б.
Факт: `✗ ... [calls=1]` — второй вызов (в треде Б) заблокирован.
Причина: `WS.engine.inFlight` — единственный, ГЛОБАЛЬНЫЙ булев флаг (`engine.js:1164`), не привязан к треду; гвард в `main.js` читает именно его.

**`turn-state · the waiting card offers a way to cancel the request`**
Ассерт: пока идёт реальный `freeReply()` (не застаб), на карточке ожидания должна быть кнопка с текстом «отменить».
Факт: `✗ ... [buttons on card: ]` — список кнопок пуст.
Причина: в `processCard`/`freeReply` кнопки «Отменить» нет вообще; есть отдельная «Пропустить ожидание» (`engine.js:260`, флаг `engine._skip`), но она читается только в детерминированном сценарии (`advance()`, `:520`), не в `freeReply()` — на живом вызове это no-op-кнопка, не более.

**`turn-state · the accepted mode/depth is shown on the waiting card, not just a spinner`**
Ассерт: после вызова `stageFn({k:'accepted', mode:'roi', depth:'deep'})` карточка должна показать «roi»/«deep»/«инвест»/«глубок».
Факт: `✗` — текст карточки на момент проверки: `текствопрос КонсьержРазбираю запросСмотрю рабочее место10 сделок — суммы, стадии, сроки шагов · Формулирую ответ` — ни слова про режим/глубину.
Причина: `onStage` в `engine.js:762-770` реагирует ТОЛЬКО на `k === 'web'`; событие `accepted` со своим `mode`/`depth` полностью игнорируется.

### 1.2 GREEN (6) — с доказательством мутацией

**`turn-state · sending starts exactly one call`** и **`turn-state · a second Send click in a busy thread is blocked (existing guard)`**
Это существующий клик-гвард (`main.js:508-509`). Мутация: копия `src/`+`server/` в `C:\temp\takt-mutation-smoke-guard`, в `main.js` убран гвард —
```
case 'cgSend': routePrompt(promptValue('cgPrompt')); break;
```
Прогон мутанта [проверено прогоном, `NODE_PATH` на `node_modules` основного репо]: `✗ turn-state · a second Send click in a busy thread is blocked (existing guard) [calls=2]` — ИМЕННО этот чек упал, остальные 3 старых RED не изменились. Копия удалена, реальный репозиторий перепрогнан и вернулся к исходным `1954/1950/4`.

**`turn-state · the thread is free again once the call settles`**
Оговорка честно: этот чек проверяет `WS.engine.inFlight === false` после `stub.settleAll()` — а `settleAll` сам же стаб и сбрасывает флаг (`resolvers.push(() => { WS.engine.inFlight = false; })`). То есть чек в основном подтверждает корректность СВОЕГО ЖЕ стаба, а не поведение продакшен-кода `freeReply`. Отдельно не мутировал — мутировать здесь значит портить тестовый харнесс, а не источник; оставляю как слабый/тривиальный чек с этой пометкой, а не как доказанное поведение системы.

**`turn-state · setup: the thread is busy after the first send`** и **`turn-state · setup: thread A is now busy`**
Это чисто вспомогательные setup-проверки внутри двух других тестов (не самостоятельное поведение) — их «зелёность» проверяется тем же путём, что и основной клик-гвард выше; отдельной мутации не делал, так как это тот же код (`main.js:508-509`), уже покрытый мутацией выше.

**`turn-state · freeReply hands askAsync a stage callback`**
Незапланированная находка: это УЖЕ реально работает сегодня. Мутация: копия в `C:\temp\takt-mutation-smoke-stage`, в `engine.js` убран блок `onStage: (k) => {...}` из вызова `askAsync` (оставлен только `onText`).
Прогон мутанта [проверено прогоном]: `✗ turn-state · freeReply hands askAsync a stage callback` — упал; чек `the accepted mode/depth is shown...` из отчёта вообще исчез (`1953` вместо `1954` чеков) — ожидаемо: в моём же тесте он вложен в `if (typeof stageFn === 'function')` и просто не выполняется, когда `stageFn` не пришёл; это поведение тестового файла, не баг. Остальные 2 старых RED (`Enter...`, `waiting card offers a way to cancel`) не изменились. Копия удалена, реальный репозиторий перепрогнан — вернулся к `1954/1950/4`.

---

## 2. `src/test/live-ux.js` (новый файл, реал-тайм, не в `npm test`)

### 2.1 RED (1)

**`live-ux · the ORIGINAL thread keeps ticking after switching away, not frozen`**
Ассерт: спустя ~3 c треда Б активным, переключаемся на тред В, ждём ещё ~3 c — секунды в сохранённой карточке треда Б должны были вырасти (`secsB > secsA`).
Факт [проверено прогоном, реальное время ~7 c на тест]: `✗ ... [secsA=2 secsB=2 (today the beat bails out via 'if (!same()) return', so secsB stays == secsA)]` — таймер треда Б действительно замер после переключения.
Причина: `engine.js:756` — `const beat = setInterval(() => { if (!same()) return; tick++; draw(); }, 2200);`, где `same = () => engine.activeThreadId === threadId`.

### 2.2 GREEN (7) — с доказательством мутацией (2 независимые мутации)

**Мутация А** (`C:\temp\takt-mutation-liveux-secs`, `engine.js`: `secs()` заменена на `() => ''`):
Прогон [проверено прогоном]:
```
✗ live-ux · after ~3s on screen the card shows a real elapsed time (>= 2 с), not "0 с"  [card note seconds=null; ...]
✗ live-ux · setup: thread B shows a real elapsed time while active  [secsA=null]
✗ live-ux · the ORIGINAL thread keeps ticking after switching away, not frozen  [secsA=null secsB=null]
```
— то есть чек «после ~3с показывает реальное время» и «setup: тред Б показывает реальное время» оба честно ловят мутацию (детектируют, что часы вообще не работают, а не просто «то и так было красным»). «Card is gone once resolved» и «reply written back» остались зелёными — они не зависят от `secs()`, что ожидаемо и корректно (не ложноположительная мутация-детекция).

**Мутация Б** (`C:\temp\takt-mutation-liveux-addr`, `engine.js:798`: `updateMsg(workMid, agentCard(reply, workMid), threadId)` → `..., engine.activeThreadId || 'general')`):
Прогон [проверено прогоном]:
```
✗ live-ux · the ORIGINAL thread keeps ticking after switching away, not frozen  [secsA=2 secsB=2 ...]
✗ live-ux · the reply is written back into the ORIGINAL (now background) thread  [B has reply=false; C has reply=false]
```
— адресный чек ловит мутацию: при адресации по «текущему активному» треду вместо захваченного `threadId`, `updateMsg` не находит нужный `messageId` ни в Б (сообщение уже там, но апдейт ушёл не туда), ни в В (апдейт ушёл туда, но там нет такого `messageId`, апдейт отклонён — «a stale reference to a gone message is refused»), поэтому ответ теряется в обоих. Это подтверждает, что чек действительно проверяет корректную адресацию, а не просто «наличие текста где-нибудь».

Обе копии удалены, реальный репозиторий перепрогнан — вернулся к исходным `7 passed / 1 FAILED` с тем же единственным падением.

---

## 3. `server/test/proxy-test.js`

Не менялся в этой сессии (доработан в предыдущей — `stageChecks()` + усиленный тест на освобождение слота при отмене). В этой сессии только перепрогнан для контроля регрессий: [проверено прогоном] `128 OK`, `4 FAILED` — совпадает с состоянием на конец предыдущей сессии.

### 3.1 RED (4)
```
✗ the server announces acceptance, and before any model text arrives          [events=delta,delta,delta,done]
✗ the server announces the model actually starting, ... no later than first text [events=delta,delta,delta,done]
✗ acceptance carries the mode/depth the server actually resolved, not just a bare «waiting» [undefined expected mode=roi depth=deep]
✗ even a call that answers in one shot was told it was accepted first         [events=delta,done]
```
Причина (см. `01-recon.md`): `server/proxy.js` не эмитирует `stage:{k:'accepted'}` и `stage:{k:'model_started'}` нигде — единственная реальная стадия сегодня — `onStage('web')` (`:990`), внутри обработки инструментов websearch/webfetch.

### 3.2 GREEN, релевантные Task 7 (мутация выполнена в предыдущей сессии)
`the slot is handed back afterwards`, `a client that walks away frees the slot instead of holding it`, `cancelling one call lets the very next one actually run, not just reset a counter` — все три сейчас зелёные. Мутация из предыдущей сессии (копия `C:\temp\takt-mutation-proxy-75661`, `res.on('close', ...)` заменён на no-op) подняла падений с 4 до 6 — то есть ровно 2 из перечисленных выше чеков (согласно логу предыдущей сессии — по смыслу это `a client that walks away frees the slot instead of holding it` и `cancelling one call lets the very next one actually run`) корректно среагировали на отключение реального механизма отмены. Копия была удалена и восстановление до `4 FAILED` подтверждено в предыдущей сессии; точный посимвольный список двух флипнувшихся имён в перенесённой сводке не сохранился дословно — если нужен точный перечень, требуется перезапуск той конкретной мутации (не выполнялся заново в этой сессии, так как файл не менялся и общий счёт `128 OK/4 FAILED` уже совпал с ожидаемым — новой мутации не потребовалось).

---

## Что НЕ проверялось прогоном (и почему)

- Точный посимвольный список двух чеков `proxy-test.js`, флипнувшихся при мутации `res.on('close')` — восстановлен из сводки предыдущей сессии по смыслу, не перепрогонялся заново в этой сессии (см. выше). [не проверено прогоном: перенесённая сводка предыдущей сессии, не переисполнено]
- `docs/wespace/plans/*` и остальные ~11000 строк `src/js/ui.js` / ~8500 строк `src/test/smoke.js` вне уже найденных секций — не читались (см. `01-recon.md`, границы просмотра); тесты писались только по тем участкам кода, что были прочитаны и процитированы построчно.
- `.takt/sealed/` и любой файл `00-granica*` — сознательно не читались и не листались НИ РАЗУ за всю сессию (blindness-constraint соблюдён).

## Регрессии

`npm test`-цепочка (кроме уже описанного `smoke.js`) — `acceptance-audience.js` (30/30, 0 FAILED) и `acceptance-incident-consent.js` (17/17, 0 FAILED) [оба проверены прогоном] — без изменений, оба зелёные, Task 7 их не касается.
