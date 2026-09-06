# -*- coding: utf-8 -*-
"""
Мутационная проверка работы этой сессии.

Каждое исправление ломается обратно, и прогоняется набор тестов. Если тесты
проходят на сломанном коде — исправление НЕ ЗАКРЕПЛЕНО, и первая же правка его
уронит молча. Это единственный способ отличить настоящую проверку от галочки:
ровно так в этой сессии мимо гейта прошла мёртвая защита от двойной отправки.
"""
import io, os, subprocess, sys, shutil, tempfile

import pathlib
ROOT = str(pathlib.Path(__file__).resolve().parent.parent)

# (имя, файл, что_найти, чем_заменить)
MUTATIONS = [
    (u'подбор ранжируется по выгоде клиента, а не по нашей комиссии',
     'src/js/ui.js',
     u'.sort((a, b) => clientValue(b, c).score - clientValue(a, c).score).slice(0, 3);',
     u'.sort((a, b) => oppComm(b) - oppComm(a)).slice(0, 3);'),

    (u'подборка режется до трёх, а не до двух',
     'src/js/ui.js',
     u'.sort((a, b) => clientValue(b, c).score - clientValue(a, c).score).slice(0, 3);',
     u'.sort((a, b) => clientValue(b, c).score - clientValue(a, c).score).slice(0, 2);'),

    (u'назначение сохраняет запись, а не удаляет её',
     'src/js/store.js',
     u'  rec.assignee = userId;',
     u'  (store.data.inbox || []).splice((store.data.inbox || []).indexOf(rec), 1);\n  rec.assignee = userId;'),

    (u'стенд открывается на Консьерже',
     'src/js/store.js',
     u"const START_VIEW = 'concierge';",
     u"const START_VIEW = 'start';"),

    (u'в КП клиента нет нашей комиссии',
     'src/js/ui.js',
     u"<th class=\"num\">Доходность</th><th class=\"num\">Готовность</th></tr></thead>",
     u"<th class=\"num\">Доходность</th><th class=\"num\">Комиссия</th></tr></thead>"),

    (u'офлайновый ответ помечен на экране',
     'src/js/engine.js',
     u"    if (!r || r.source !== 'offline') return '';",
     u"    if (true) return '';"),

    (u'загрузка до-заполняет, а не теряет новые коллекции',
     'src/js/store.js',
     u'      if (store.data[k] === undefined || store.data[k] === null) { store.data[k] = fresh[k]; filled.push(k); }',
     u'      if (false) { store.data[k] = fresh[k]; filled.push(k); }'),

    (u'запросы брокера сохраняются на диск',
     'src/js/store.js',
     u'        signals: store.signals, snapSentHash: store.snapSentHash, installId: store.installId,',
     u'        snapSentHash: store.snapSentHash, installId: store.installId,'),

    (u'оговорка стоит на самой схеме планировки',
     'src/js/floorplan.js',
     u'>Схема по площади и составу комнат · не чертёж застройщика</text>',
     u'></text>'),

    (u'голосовая команда не подставляет чужой объект',
     'src/js/main.js',
     u"'рассылка': () => { const id = hereObject(); return id ? WS.ui.openPromotion(id) : WS.ui.pickObjectFor('promo', 'Рассылка по какому объекту?'); },",
     u"'рассылка': () => { const id = hereObject(); WS.ui.openPromotion(id || (store.data.objects[0] || {}).id); },"),

    (u'сделка наследует ответственного из заявки',
     'src/js/ui.js',
     u'agent: r.assignee',
     u"agent: 'u_none'"),

    (u'выбор объекта требует подтверждения',
     'src/js/ui.js',
     u"    if (state === 'selected') { openRequestSelectionConfirm(reqId, objId); return; }",
     u"    if (false) { openRequestSelectionConfirm(reqId, objId); return; }"),

    (u'офлайн не отрицает существующий объект',
     'src/js/agent.js',
     u'    const named = namedRecord(text);\n    if (named) {',
     u'    const named = null;\n    if (named) {'),

    (u'озвучка склеивает разряды числа',
     'src/js/voice.js',
     u"    for (let i = 0; i < 4; i++) t = t.replace(/(\\d)[\\u00a0\\u202f ](\\d{3})\\b/g, '$1$2');",
     u"    for (let i = 0; i < 0; i++) t = t.replace(/(\\d)[\\u00a0\\u202f ](\\d{3})\\b/g, '$1$2');"),

    (u'Пульс руководителя в разделах, как у брокера',
     'src/js/ui.js',
     u"  const PULSE_SECTIONS_MGR = ['decide', 'risk', 'team', 'analytics'];",
     u"  const PULSE_SECTIONS_MGR = ['day', 'prospects', 'insights', 'analytics'];"),
]


def run_tests():
    """Возвращает (ok, краткий отчёт)."""
    b = subprocess.run(['node', 'src/build.js'], cwd=ROOT, capture_output=True, text=True)
    if b.returncode != 0:
        return (False, 'build упал')
    outs = []
    for cmd in (['node', 'src/test/smoke.js'],
                ['node', 'src/test/upgrade-preserves-state.js']):
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        outs.append(r.returncode)
    return (all(c == 0 for c in outs), 'коды: ' + str(outs))


def main():
    backup = tempfile.mkdtemp(prefix='mut_')
    files = sorted(set(m[1] for m in MUTATIONS))
    for f in files:
        os.makedirs(os.path.join(backup, os.path.dirname(f)), exist_ok=True)
        shutil.copy(os.path.join(ROOT, f), os.path.join(backup, f))

    print('Базовый прогон (без мутаций)...')
    ok, note = run_tests()
    if not ok:
        print('  БАЗА КРАСНАЯ — мутационная проверка бессмысленна. ' + note)
        return 1
    print('  база зелёная\n')

    caught, missed, broken = [], [], []
    for name, rel, find, repl in MUTATIONS:
        p = os.path.join(ROOT, rel)
        src = io.open(p, encoding='utf-8').read()
        n = src.count(find)
        if n != 1:
            broken.append((name, 'якорь найден ' + str(n) + ' раз'))
            print('  ??  ' + name + '  [якорь x' + str(n) + ']')
            continue
        io.open(p, 'w', encoding='utf-8', newline='').write(src.replace(find, repl))
        ok, note = run_tests()
        io.open(p, 'w', encoding='utf-8', newline='').write(src)  # вернуть
        if ok:
            missed.append(name)
            print('  ПРОПУЩЕНО  ' + name)
        else:
            caught.append(name)
            print('  поймано    ' + name)

    for f in files:
        shutil.copy(os.path.join(backup, f), os.path.join(ROOT, f))
    subprocess.run(['node', 'src/build.js'], cwd=ROOT, capture_output=True)

    total = len(caught) + len(missed)
    print('\n' + '=' * 62)
    print('Поймано ' + str(len(caught)) + ' из ' + str(total) +
          ('  (якоря не сошлись: ' + str(len(broken)) + ')' if broken else ''))
    if missed:
        print('\nНЕ ЗАКРЕПЛЕНО ТЕСТАМИ:')
        for m in missed:
            print('  - ' + m)
    if broken:
        print('\nНЕ ПРОВЕРЕНО (якорь изменился):')
        for m, why in broken:
            print('  - ' + m + ' :: ' + why)
    return 0


if __name__ == '__main__':
    sys.exit(main())
