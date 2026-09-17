/* Ответ против ОБРАЗА РЕЗУЛЬТАТА, а не против схемы.

   Юнит-проверки доказывают, что поле доехало. Они ничего не говорят о том,
   получил ли брокер то, за чем пришёл. Разбор стенограммы дал три расхождения,
   и все три живут в формулировках модели, а не в коде:

     1. «Сам написать или позвонить я не могу» — граница контура, поданная как
        неспособность. Брокер читает это как приговор продукту.
     2. «Цену метра я не считал — скажите, посчитаю» — переклад работы обратно
        на человека там, где данные для счёта уже на руках.
     3. Отчёт о том, чего не спрашивали («содержимого вложений у меня нет»).

   Проверяется на ЖИВОЙ модели через локальный прокси: поведение подсказки
   нечем проверить, кроме как задав вопрос.

   Запуск:  node src/test/live-result-image.js
   Нужен  claude  в PATH (или в CLAUDE_CLI_EXECUTABLE).
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PROBE_PORT || 8799);

let fails = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails += 1;
  console.log('  ✗ ' + name + (detail ? '\n      ' + detail : ''));
}

/* Слепок рабочего места берётся из настоящего стенда, а не собирается руками:
   вопрос к модели имеет смысл только вместе с теми данными, которые она видит
   у брокера. */
function buildPayload() {
  return new Promise((resolve) => {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
      { runScripts: 'dangerously', pretendToBeVisual: true });
    setTimeout(() => {
      const W = dom.window.WS;
      resolve({
        digest: W.live.digest(),
        history: [],
        scope: W.live.scope ? W.live.scope() : null,
        screen: { вид: 'concierge', экран: 'Консьерж' },
        pending: null,
        ids: { installId: 'i_probe', sessionId: 's_probe' },
      });
    }, 4000);
  });
}

/* Подсказка собирается ТЕМ ЖЕ кодом, что и в бою — прокси её экспортирует.
   Сам прокси здесь не поднимается: на Windows Node не запускает .bat напрямую,
   а менять ради этого боевой запуск процесса нельзя. Проверяется то, что
   проверять и надо: текст запроса и ответ живой модели на него. */
const { buildPrompt } = require(path.join(ROOT, 'server', 'proxy.js'));

function askModel(payload, text, mode, depth) {
  const prompt = buildPrompt(Object.assign({}, payload, {
    text: text, mode: mode || 'auto', depth: depth || 'think',
  }));
  return new Promise((resolve, reject) => {
    const cli = process.env.CLAUDE_CLI_EXECUTABLE || 'claude';
    /* Подсказка уходит в поток ввода, ровно как в боевом прокси. Оболочка не
       нужна и не используется: CLI — исполняемый файл, и путь к нему никто по
       дороге не переписывает. */
    const sh = spawn(cli, ['--print', '--model', 'claude-opus-5',
      '--disallowed-tools', 'Bash', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Task', 'Skill'],
      { windowsHide: true });
    let out = '', err = '';
    sh.stdout.on('data', (c) => { out += c; });
    sh.stderr.on('data', (c) => { err += c; });
    sh.on('close', (code) => {
      if (code !== 0 && !out) return reject(new Error('cli ' + code + ': ' + err.slice(0, 200)));
      resolve(out);
    });
    sh.on('error', reject);
    sh.stdin.write(prompt);
    sh.stdin.end();
  });
}

/* Вопросы взяты из стенограммы дословно — переформулировать их значило бы
   проверять удобную для нас задачу вместо той, что реально задали. */
const PROBES = [
  {
    q: 'Свяжись с ней и Вступительная сообщение напиши какое-то',
    want: [
      ['граница названа как свойство контура, а не как неспособность',
        (a) => !/(^|[^а-я])я не могу|сам написать .{0,20}не могу|не могу позвонить/i.test(a)],
      ['сказано, что каналы просто не подключены здесь',
        (a) => /не подключен|рабочем контуре|рабочей верси/i.test(a)],
      ['текст сообщения выдан сразу',
        (a) => /Анна/.test(a) && a.length > 400],
    ],
  },
  {
    q: 'как лучше продавать Creekline Residences, Unit 1208 и кому больше подойдет объект?',
    want: [
      ['нет обещания посчитать позже',
        (a) => !/скажите.{0,40}посчитаю|не считал|посчитаю из/i.test(a)],
    ],
  },
  {
    /* Здесь число и есть предмет вопроса: если модель его не назовёт,
       значит посчитанными полями она не пользуется. */
    q: 'сколько стоит метр в Creekline Residences 1208, сколько это за фут и сколько выходит сервисный сбор в год',
    want: [
      ['цена за метр названа числом',
        (a) => /22[\s\u00a0]?195/.test(a)],
      ['цена за фут названа числом',
        (a) => /2[\s\u00a0]?061/.test(a)],
      ['сервисный сбор за год назван числом',
        (a) => /14[\s\u00a0]?1\d\d/.test(a)],
      ['нет обещания посчитать позже',
        (a) => !/скажите.{0,40}посчитаю|если знаете площадь/i.test(a)],
    ],
  },
  {
    /* Образ результата для «свяжись с клиентом» шире одного сообщения: брокеру
       нужен ещё план разговора — что спросить и что ответить на возражение. */
    q: 'сейчас буду звонить Анне — что спросить и как вести разговор',
    want: [
      ['вопросы к клиенту перечислены, а не описаны вообще',
        (a) => (a.match(/\?/g) || []).length >= 3],
      ['названо, чем закрыть разговор',
        (a) => /закрыть|договориться|следующий шаг|договорённост/i.test(a)],
      ['граница не подаётся как неспособность',
        (a) => !/(^|[^а-я])я не могу|не могу позвонить/i.test(a)],
    ],
  },
  {
    /* Дефект, названный принципалом: на этот вопрос агент давал разбор
       по бюджетам, а брокеру нужен скрипт продажи. Причина была не в
       требованиях, а в данных: кроме бюджета модель о клиенте ничего не знала. */
    q: 'кому из наших контактов имеет смысл отправить Bay Central Tower 1907 и кого отправлять нельзя',
    want: [
      ['довод привязан к тому, как человек решает, а не только к бюджету',
        (a) => /аналитик|по цифрам|ценит|доходност|безопасност|тоне|темп/i.test(a)],
      ['названо возражение и ответ на него',
        (a) => /возражен|скажет|возрази|ответить/i.test(a)],
      ['есть следующий шаг',
        (a) => /следующий шаг|предложить|предложите|напишите|позвоните/i.test(a)],
      ['кому нельзя — с причиной',
        (a) => /согласи|отозв/i.test(a)],
    ],
  },
];


async function main() {
  console.log('Собираю слепок рабочего места…');
  const payload = await buildPayload();
  console.log('  дайджест: ' + JSON.stringify(payload.digest).length + ' символов');

  for (const p of PROBES) {
    console.log('\nВопрос «' + p.q.slice(0, 60) + '…»');
    let answer = '';
    try {
      answer = await askModel(payload, p.q);
    } catch (e) {
      console.log('  ✗ модель не ответила: ' + e.message);
      fails += 1;
      continue;
    }
    /* Брокер видит ОБЕ части ответа — прозу и разметку, — значит и судить надо
       по обеим. Первая версия пробы читала только прозу и объявила недостачей
       список вопросов, который модель аккуратно положила в блоки. */
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(answer);
    let blocksText = '';
    if (fence) {
      try {
        const plan = JSON.parse(fence[1]);
        const walk = (b) => {
          if (!b || typeof b !== 'object') return;
          if (b.text) blocksText += ' ' + b.text;
          if (Array.isArray(b.items)) blocksText += ' ' + b.items.join(' ');
          if (Array.isArray(b.rows)) b.rows.forEach((r) => {
            if (Array.isArray(r)) blocksText += ' ' + r.join(' ');
            else if (r && typeof r === 'object') blocksText += ' ' + (r.k || '') + ' ' + (r.v || '');
          });
        };
        (plan.blocks || []).forEach(walk);
        if (plan.report) (plan.report.blocks || []).forEach(walk);
        if (plan.say_aloud) blocksText += ' ' + plan.say_aloud;
      } catch (e) { /* модель отдала не JSON — тогда судим по прозе */ }
    }
    const plain = answer.split('```')[0] + blocksText;
    console.log('  — ' + plain.replace(/\s+/g, ' ').slice(0, 260) + '…');
    p.want.forEach(([name, fn]) => check(name, fn(plain), plain.replace(/\s+/g, ' ').slice(0, 300)));
  }

  console.log('\n' + (fails ? 'НЕ СОШЛОСЬ: ' + fails : 'Всё сошлось'));
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
