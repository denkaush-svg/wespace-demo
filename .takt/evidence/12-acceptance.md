# Шаг 12 — Приёмка против намерения

Роль шага человеческая: отвечает принципал, по каждому пункту постановки шага 0. Гейт: «предъявлен вывод прогона и артефакт, а не заявление». Ниже — каждый пункт §4 намерения с тем, чем именно он доказан, и честным исходом.

Прогон, на котором снята вся картина, — свежий, снятый ПОСЛЕ мутирующего шага 10 (этого требует гейт шага 13):

```
node src/test/smoke.js         → checks: 1989  passed: 1989  FAILED: 0
node server/test/proxy-test.js → all proxy checks passed
node src/test/live-ux.js       → checks: 16  passed: 16  FAILED: 0
git status --porcelain         → (пусто)
```
`[проверено прогоном: `node src/test/smoke.js`]` · `[проверено прогоном: `node server/test/proxy-test.js`]` · `[проверено прогоном: `node src/test/live-ux.js`]`

## Пункты приёмки §4 — по одному

**1. «Через 20 секунд таймер показывает реальное значение, не `0 с`» — да, с оговоркой по букве.**
`live-ux · after ~3s on screen the card shows a real elapsed time (>= 2 с), not "0 с"`. Механизм — `Date.now() - turn.startedAt`, перерисовка тикером; он же проверен на живучесть при уходе в другой тред: `live-ux · the ORIGINAL thread keeps ticking after switching away, not frozen`.
Оговорка честная: проверка снята на ~3 секундах, а не на 20. Двадцатисекундного прогона нет намеренно — он добавил бы 20 секунд к каждому прогону набора. Ничего, что ломалось бы именно на двадцатой секунде, в механизме нет, но буквальная цифра из постановки прогоном не подтверждена. `[не проверено прогоном: 20-секундная выдержка не запускается, чтобы не удлинять набор; проверено на 3 секундах]`

**2. «Одновременно виден принятый server `mode`/`depth`» — да.**
`turn-state · the accepted mode/depth is shown on the waiting card, not just a spinner` и `turn-state · the accepted mode/depth survives the model going out to the web`. Второй появился из находки шага 7: параметры показывались только на двух стадиях и исчезали при переходе в `web`.

**3. «Второй вопрос в занятом треде не создаёт перемешанную карточку и не даёт второй сетевой запрос» — да, с числовым критерием.**
Все четыре входа закрыты и меряются числом запросов: кнопка (`a second Send click in a busy thread is blocked`), клавиша (`Enter in a busy thread must not start a second call`), подсказка-продолжение (`a follow-up chip in a busy thread must not start a second request`) и подсказка первого экрана (`a first-screen suggestion in a busy thread must not start a second request`). Два последних — находки шага 7: они шли в обход общей блокировки. Отдельно закрыт пол под блокировкой: `a turn that replaces a running one closes the request it replaces`. И проверено, что блокировка не глобальная: `a different, idle thread is not blocked by another thread being busy`.

**4. «"Отменить" заканчивает запрос и освобождает server concurrency slot» — да, и сквозной цепочкой.**
На сервере: `cancelling one call lets the very next one actually run, not just reset a counter`, `a client that walks away frees the slot instead of holding it`, `the slot is handed back afterwards`. Шаг 7 прямо записал, что не проверял всю цепочку единым прогоном; шаг 11 прогнал «настоящая кнопка → fetch → прокси → освобождение слота» как один сигнал против живого прокси при `concurrency=1` и закрыл этот пробел.

**5. «Ошибка, fallback и успех визуально и по данным различимы» — НЕТ, и это единственный невыполненный пункт.**
Ошибка отличима: `live-ux · a stream that never ends is closed by the client watchdog` + `and the card says so and offers to send the question again`. Успех отличим. **Подмена — нет:** когда модель не отвечает, посетитель получает локальный ответ без всякой пометки.
Причина в `src/js/agent.js`, который §3 той же постановки выносит за границу задачи. То есть документ намерения противоречит сам себе: §4 требует различимости, §3 запрещает трогать единственный файл, который знает, что произошло. Три способа закрыть пункт внутри границы разобраны и отвергнуты с причинами, минимальная правка и протокольный маршрут записаны в `09-deferred.md`.
Выносится принципалу как сознательно принятое, а не как незамеченное.

**6. «Тест с отложенным async-ответом: через 2,5 с DOM показывает время не меньше "2 с"; после resolve карточка ожидания исчезает» — да.**
`live-ux · after ~3s on screen the card shows a real elapsed time (>= 2 с), not "0 с"` и `live-ux · the waiting card is gone once the call resolves (replaced by the reply)`.

**7. «Тест переключения тредов: таймер/итог обновляются в исходном треде, а не в активном» — да.**
`live-ux · the ORIGINAL thread keeps ticking after switching away, not frozen` и `live-ux · the reply is written back into the ORIGINAL (now background) thread`. Сюда же легла находка шага 7 о потере запроса при быстром переключении: `live-ux · a question asked just before switching threads still reaches the network` и `the answer lands back in the thread the question was asked in`.

## Пункты §2, которые стоит подтвердить отдельно

Все четыре подтверждены прогонами, снятыми ведущим лично; ниже под каждым — какой именно:

```
node src/test/smoke.js                            → checks: 1989  passed: 1989  FAILED: 0
node src/test/live-ux.js                          → checks: 16  passed: 16  FAILED: 0
node C:\temp\takt-step11-mut\contracts-probe.js   → PROBE_RESULT=PASS (проба шага 11, каталог удалён после)
```

**Форма объекта хода** — сверена шагом 11 против списка из §2 поле в поле: `id`, `threadId`, `status`, `stage`, `startedAt`, `lastProgressAt`, `mode`, `depth`, `abortController`, `messageId`. Совпадает, и все шесть потребителей (создание, транспорт, карточка, отмена, завершение, сброс) используют одни имена. `[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]` → `TURN_SHAPE_KEYS_MATCH=true`, `TURN_RESET_CONSUMERS_MATCH=true before=2 after=0 aborted=2`.

**Реальные стадии вместо декоративных** — множества имён стадий у `proxy.js`, `live.js` и `engine.js` совпадают, и движок показывает каждую пришедшую с провода. `[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]` → `WIRE_STAGE_SET_MATCH=true server=accepted,model_started,web live=... engine=...`, `ENGINE_DISPLAYS_EACH_WIRE_STAGE=true`. Отдельно на карточке: `[проверено прогоном: `node src/test/smoke.js`]` → зелёные `turn-state · «принят» and «модель работает» are not the same line on the card` и `the card names the stage that actually happened, web included`.

**Сторож чуть больше серверного лимита** — выполнен, но не тем, чем был в первой редакции. Изначально построили дедлайн на весь звонок, и он обрывал ответы, которые печатались дольше потолка; §2 говорит «после разрыва потока», то есть про молчание. `[проверено прогоном: `node src/test/smoke.js`]` → зелёные `a turn that keeps streaming past the ceiling is left alone, not cut` и `a turn adopts the silence limit the server announced instead of its own default ceiling`; обратный случай сохранён — `[проверено прогоном: `node src/test/live-ux.js`]` → `a stream that never ends is closed by the client watchdog`. Откат перевзвода красит первую пару: `checks: 1989  passed: 1987  FAILED: 2`.

**Отмена через `AbortController`** — `[проверено прогоном: `node src/test/smoke.js`]` → зелёные `the waiting card offers a way to cancel the request`, `a reply that finishes after «Отменить» never lands on the card`, `and the thread is not put back into waiting by that late reply`. Освобождение серверного слота той же кнопкой — `[проверено прогоном: `node C:\temp\takt-step11-mut\contracts-probe.js`]` → `CANCEL_BROWSER_TO_SERVER_SLOT=true aborted=true inFlight=0`.

## Что остаётся открытым — целиком, без умолчаний

1. **Подпись офлайн-ответа** (пункт 5 выше). Единственный невыполненный пункт приёмки. Спека и маршрут — `09-deferred.md`.
2. **Гейт границы не работал весь прогон.** В начальной записи журнала стоит базовый коммит из другого репозитория, из-за чего `takt.py check` говорит «сверить границу не с чем». Соответствие правок границе устанавливали только люди и модели чтением, машина — ни разу. Разобрано в `10-recheck.md` (там же исправлено моё раннее слишком сильное утверждение, будто радиус поражения нулевой).
3. **Тонкий временной запас приёмочных тестов.** `waitPastSetup()` ждёт 750 мс против 560 мс задержек подготовки — запас 190 мс. Открыт с шага 4, живьём наблюдался один раз за прогон. Находка о тестах, идёт их автору.
4. **Доказательство шага 3 — живой файл, а не отчёт.** Записан `server/test/proxy-test.js`; последующие круги законно дописывали в него тесты, и хеш разошёлся, из-за чего `check` говорит «шаг опирается уже не на то, что предъявлял». Не порча, а следствие того, что доказательством назвали растущий файл.
5. **Замечания, найденные попутно и не входившие ни в одну находку** (записаны, не правились): сторож не перевзводится на путях повтора и на внутренней подмене `askAsync`; не проверено, доходит ли каждый тип события провода до движка как прогресс — heartbeat без текста страница сочтёт молчанием, а сервер нет; тикер прогресса гасится на первом куске текста.
6. **Ни один прогон не касался живой модели и настоящего обрыва сокета.** Всё проверено на поддельном CLI с настоящим процессом, HTTP и SSE, и на jsdom с настоящими `fetch`/`AbortController`. Боевой признак шага 16 — отдельный ответ на этот пробел.

## Что решает принципал

Принять работу при одном невыполненном пункте приёмки (подпись офлайн-ответа), зная его причину, цену и записанный маршрут закрытия, — или не принимать.
