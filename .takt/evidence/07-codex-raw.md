# Step 7 — Codex's raw report (verbatim, translated from Russian where noted)

Recovered from the session transcript after the earlier summarized note in `07-review.md` abbreviated findings 5-7 and the "plausible" group as "see raw transcript." This file supersedes that gap with the full text Codex actually returned.

---

Итог прогона: результат пока не готов к слиянию. Штатные тесты зелёные, но независимый probe подтвердил 7 функциональных дефектов; ещё 4 дефекта правдоподобны по коду.

## Подтверждённые находки

### Высокая — запрос теряется при быстрой смене треда
`src/js/engine.js:774` и `:776` завершают turn, если пользователь сменил тред во время подготовительных задержек 60/500 мс. В production вопрос уже остаётся в истории, но сеть не вызывается, карточки ожидания и ошибки нет: пользователь видит вопрос без ответа и без объяснения.
`PROBE quick_switch calls=0 busy=false has_question=true has_wait=false`

### Высокая — follow-up обходит блокировку; отменяется не тот запрос
Клик по прежней подсказке проходит через `src/js/main.js:280` → `src/js/engine.js:1273` → `freeReply()` без `send()`-guard. Второй turn перезаписывает `turns[threadId]`. После этого кнопка первой карточки в `src/js/engine.js:565` отменяет второй запрос; первый продолжает занимать серверный слот, а UI уже считает тред свободным и допускает третий запрос.
`PROBE followup_bypass calls=2 cancel_buttons=2 first_aborted=false second_aborted=true busy_after_first_cancel=false`

### Высокая — отказ модели скрывается под обычным локальным ответом
`src/js/agent.js:845` по-прежнему переводит любую ошибку в безымянный offline fallback. Итоговая карточка не отличает его от ответа модели. В production брокер не узнаёт, что нейросеть не ответила.
`PROBE fallback visible_offline_banner=false has_answer=true`

### Средняя — принятые mode/depth исчезают при стадии `web`
`src/js/engine.js:828` показывает параметры только для `accepted` и `model_started`; переход в `web` на строке `881` скрывает их.
`PROBE stage_visibility accepted_has_mode=true accepted_has_depth=true web_has_mode=false web_has_depth=false`

### Средняя — общий сброс не отменяет активный запрос
`src/js/engine.js:669` очищает треды и активный идентификатор, но не `turns` и не `AbortController`. Стенд выглядит сброшенным, но невидимый запрос продолжает занимать server concurrency slot; поздний ответ теряется.
`PROBE reset active_call_aborted=false active_thread=null busy=false`

### Средняя — `done.ms` теряется
В `src/js/live.js:998` из серверного `done` переносятся mode/depth/lang, но не `ms`. Длительность нельзя сохранить и показать в истории ответа.
`PROBE done_metadata keys=blocks,evidence,kind,next,report,speak,text ms=undefined`

### Средняя — `model_started` отправляется до успешного запуска процесса
`server/proxy.js:909` вызывает `spawn()`, после чего строка `914` немедленно сообщает `model_started`. Ошибка запуска приходит асинхронно позже. При отсутствующем/сломанном CLI пользователь увидит «модель запущена», хотя процесс не стартовал.
`PROBE spawn_failure stages=["model_started"] error="spawn:spawn takt-probe-command-that-does-not-exist ENOENT"`

## Правдоподобные находки (не проверено пробным прогоном)

- Высокая — ручной abort всё равно запускает offline planner: исключение перехватывается в `src/js/agent.js:857`, затем `return ask(clean)` на строке `867`. Результат скрывается карточкой `cancelled`, но локальная обработка уже произошла. Не проверено прогоном: ветка abort не была инструментирована отдельным счётчиком fallback.
- Высокая — клиентского watchdog нет: `src/js/engine.js:863` без ограничения ждёт `askAsync`; в `src/js/live.js` отсутствуют `Promise.race` или клиентский таймер. При зависшем fetch turn может навсегда остаться `running`. Не проверено прогоном: ожидание длиннее серверного `stallMs=120000` не выполнялось.
- Средняя — прогресс всё ещё нарушает контракт: `src/js/engine.js:795` добавляет «Формулирую ответ» до первого `delta`, а `processCard()` выводит все шаги. После `delta` нет статуса «Ответ поступает»; также отсутствуют состояния через 8 и 30 секунд. Подтверждено чтением, не прогоном.
- Средняя — `data-cgask` также обходит guard: `src/js/main.js:283` напрямую вызывает `routePrompt()`. Найдено командой `rg -n 'data-cgask|routePrompt\(d\.cgask\)' src/js`, не прогоном.

## Восемь осей (Codex's own summary)
1. Делает ли результат то, что требует намерение? — **нет**. Путь ломается при быстрой смене треда, отказе модели и повторном follow-up.
2. Не сломано ли соседнее поведение? — **нет**. Общий reset оставляет невидимый запрос; старые follow-up chips обходят новую блокировку.
3. Полон ли охват случаев? — **нет**. Поиск нашёл `agentNext()` и `data-cgask`, которых нет в общем `send()`-guard.
4. Краевые входы — **нет**. Быстрая смена треда дала `calls=0`; два turn-объекта в одном треде дали `calls=2` и отмену второго вместо первого.
5. Соответствует ли стиль соглашениям репозитория? — **да**. `git diff --check` RC=0; нет AGENTS.md/CLAUDE.md внутри репозитория, найдено поиском.
6. Поймают ли тесты сломанную реализацию? — **нет, только частично**. smoke.js:4002 ловит снятый Enter-guard, пропускает follow-up-chip обход. live-ux.js:116 ловит возврат `same()`-ограничения, пропускает смену треда в первые 560мс.
7. На каких предположениях держится решение? — **нет, одно неверно**. `model_started` предполагает, что возврат из `spawn()` = работающий процесс; probe с несуществующей командой показал `model_started` перед `ENOENT`.
8. Что происходит с уже накопленным состоянием? — **нет**. Быстрая смена треда: вопрос сохраняется, turn удаляется. Reset: история исчезает, запрос и server slot остаются. Рассинхронизация данных и фактической работы.

## Штатные прогоны (Codex's own)
- `npm run test:smoke` → checks: 1954 passed: 1954 FAILED: 0
- `npm run test:proxy` → all proxy checks passed
- `npm run live:ux` → checks: 8 passed: 8 FAILED: 0
- `npm run build` → built OK, index.html restored byte-for-byte from HEAD afterward; temp probe/mutation copies deleted; `INDEX_DIFF_RC=0`, `REVIEWED_FILES_DIFF_RC=0`; `.takt/sealed/00-granica.txt` not read.

Codex did not run the full real-browser-button → real fetch → proxy → fake-CLI chain as one signal; client abort and server-slot release were checked separately. The real Claude CLI was not invoked either.
