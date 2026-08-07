#!/usr/bin/env node
'use strict';
/* Stands in for `claude` in the proxy tests. Speaks the same JSONL on stdout,
   so the parser and the streaming path are exercised for real without
   touching the subscription. Mode comes from FAKE_CLI_MODE:

     ok     — partial deltas, then a fenced plan, then a result   (default)
     whole  — no partial deltas, one whole assistant message
     plain  — narration with no fenced block
     broken — narration with an unparseable fenced block
     echo   — returns the prompt it received, so tests can inspect it
     fail   — non-zero exit with a message on stderr
     slow   — writes nothing and hangs, to exercise the timeout
*/
const MODE = process.env.FAKE_CLI_MODE || 'ok';

let stdin = '';
process.stdin.on('data', (c) => { stdin += c.toString('utf8'); });
process.stdin.on('end', () => run());

function line(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function delta(t) { line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }); }
function whole(t) { line({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }); }
function result(t) { line({ type: 'result', subtype: 'success', result: t }); }

const PLAN = '```json\n' + JSON.stringify({
  read: ['deals_active', 'deals_active_sum'],
  next: [{ label: 'Просроченные', ask: 'сколько просроченных задач' }],
}) + '\n```';

function run() {
  line({ type: 'system', subtype: 'init', model: 'fake' });

  // Stays alive and silent: an empty event loop would exit and look like a
  // fast empty answer rather than a hang.
  if (MODE === 'slow') { setTimeout(() => process.exit(0), 60000); return; }
  if (MODE === 'fail') {
    process.stderr.write('fake failure\n');
    process.exit(2);
  }
  if (MODE === 'echo') {
    const t = 'PROMPT>>>' + stdin;
    delta(t);
    result(t);
    return process.exit(0);
  }
  // Both channels at once — what the real CLI does with partial messages on.
  // The whole message repeats what the deltas already carried.
  if (MODE === 'both') {
    const t = 'Ответ пришёл дважды.';
    delta(t);
    whole(t);
    result(t);
    return process.exit(0);
  }
  if (MODE === 'whole') {
    const t = 'Целым сообщением.\n' + PLAN;
    whole(t);
    result(t);
    return process.exit(0);
  }
  if (MODE === 'plain') {
    const t = 'Без плана, только текст.';
    delta(t);
    result(t);
    return process.exit(0);
  }
  if (MODE === 'broken') {
    const t = 'Ответ есть.\n```json\n{ это не json }\n```';
    delta('Ответ есть.\n');
    delta('```json\n{ это не json }\n```');
    result(t);
    return process.exit(0);
  }

  const say = 'Сейчас четыре сделки в работе на 8,86 млн AED.';
  delta('Сейчас четыре сделки ');
  delta('в работе на 8,86 млн AED.');
  delta('\n' + PLAN);
  result(say + '\n' + PLAN);
  process.exit(0);
}
