# -*- coding: utf-8 -*-
"""
Автоматическая мутационная проверка ПО ДИФФУ.

Ручной список мутаций (tools/mutation-check.py) имеет врождённый порок: его пишет
тот же, кто писал исправления. Получается экзамен из вопросов, к которым готовились,
а дефекты живут ровно там, куда автор не подумал посмотреть.

Здесь список не составляется, а ВЫВОДИТСЯ: берутся строки, добавленные диффом,
из них отбираются исполняемые, и каждая ломается механически по своему виду —
условие, число, строковый литерал, возврат, логическая связка. Что мутировать,
решает код, а не память автора.

Запуск:
    py -X utf8 tools/mutation-auto.py <база>          # напр. 88c4a8e
    py -X utf8 tools/mutation-auto.py <база> --limit 40
    py -X utf8 tools/mutation-auto.py <база> --full    # весь npm test на каждую

Правила, которые делают проверку честной:
  * якорь, не совпавший ровно один раз, — ОШИБКА прогона, а не предупреждение;
    молчаливый пропуск в инструменте против молчаливых пропусков бессмыслен;
  * выживший мутант НЕ равен дефекту: он равен «поведение не проверяется».
    Каждого выжившего надо разобрать руками — часть окажется эквивалентной
    подменой, которая ничего не меняет;
  * знаменатель печатается всегда: сколько строк изменено, сколько отобрано,
    сколько отброшено и почему.
"""
import io
import os
import re
import subprocess
import sys
import shutil
import tempfile
import pathlib

ROOT = str(pathlib.Path(__file__).resolve().parent.parent)

# Строки, которые мутировать бессмысленно: комментарии, разметка без логики,
# объявления без поведения. Отбрасываются ЯВНО и попадают в отчёт.
SKIP = [
    (re.compile(r'^\s*(//|/\*|\*)'), 'комментарий'),
    (re.compile(r'^\s*$'), 'пустая'),
    (re.compile(r'^\s*[}\])]+[;,]?\s*$'), 'закрывающая скобка'),
    (re.compile(r'^\s*(import|export)\b'), 'модульная'),
]


def mutants_for(line):
    """Список (описание, новая_строка) — как сломать ЭТУ строку по её виду."""
    out = []
    st = line.strip()

    # 1. Условие целиком -> всегда ложно / всегда истинно
    m = re.search(r'\bif \((.+?)\) \{', line)
    if m and m.group(1) not in ('true', 'false'):
        out.append(('условие всегда ложно', line.replace('if (' + m.group(1) + ')', 'if (false)', 1)))

    # 2. Тернарное условие -> вторая ветка
    m = re.search(r'(\w[\w.\[\]() ]*) \? ', line)
    if m and ' ? ' in line and ' : ' in line:
        out.append(('тернарное всегда по ветке else', line.replace(m.group(0), 'false ? ', 1)))

    # 3. Числовой литерал -> другое число (не 0/1, чтобы не ловить индексы)
    for m in re.finditer(r'(?<![\w.])(\d{2,})(?![\w.])', line):
        n = m.group(1)
        if n in ('10', '100'):
            continue
        out.append(('число ' + n + ' изменено', line[:m.start(1)] + str(int(n) + 7) + line[m.end(1):]))
        break

    # 4. slice(0, N) -> slice(0, N-1)
    m = re.search(r'slice\(0, (\d+)\)', line)
    if m and int(m.group(1)) > 1:
        out.append(('обрезка на один короче',
                    line.replace(m.group(0), 'slice(0, ' + str(int(m.group(1)) - 1) + ')', 1)))

    # 5. Сравнение -> отрицание
    for op, inv in (('===', '!=='), ('!==', '==='), (' >= ', ' < '), (' <= ', ' > ')):
        if op in line:
            out.append(('сравнение ' + op.strip() + ' обращено', line.replace(op, inv, 1)))
            break

    # 6. Логическая связка
    if ' && ' in line:
        out.append(('&& заменено на ||', line.replace(' && ', ' || ', 1)))

    # 7. Возврат значения -> null
    m = re.match(r'^(\s*)return (?!null|;|$)(.+);\s*$', line)
    if m and len(m.group(2)) < 120:
        out.append(('возврат обнулён', m.group(1) + 'return null;'))

    # 8. Русский строковый литерал -> пустой (ловит текст, который должны видеть)
    m = re.search(r"'([А-Яа-яЁё][^']{9,})'", line)
    if m:
        out.append(('текст «' + m.group(1)[:26] + '…» вычищен', line.replace(m.group(0), "''", 1)))

    return out


def changed_lines(base):
    """[(файл, номер, текст)] — только ДОБАВЛЕННЫЕ строки в src/js."""
    d = subprocess.run(['git', 'diff', '-U0', base + '..HEAD', '--', 'src/js/'],
                       cwd=ROOT, capture_output=True, text=True).stdout
    out, path, ln = [], None, 0
    for raw in d.split('\n'):
        if raw.startswith('+++ b/'):
            path = raw[6:]
        elif raw.startswith('@@'):
            m = re.search(r'\+(\d+)', raw)
            ln = int(m.group(1)) if m else 0
        elif raw.startswith('+') and not raw.startswith('+++'):
            out.append((path, ln, raw[1:]))
            ln += 1
    return out


def run(full):
    if subprocess.run(['node', 'src/build.js'], cwd=ROOT, capture_output=True).returncode != 0:
        return 'build'
    cmds = [['node', 'src/test/smoke.js']]
    if full:
        cmds += [['node', 'src/test/acceptance-audience.js'],
                 ['node', 'src/test/acceptance-incident-consent.js'],
                 ['node', 'src/test/upgrade-preserves-state.js']]
    for c in cmds:
        if subprocess.run(c, cwd=ROOT, capture_output=True).returncode != 0:
            return 'caught'
    return 'survived'


def main():
    if len(sys.argv) < 2:
        print('нужна база: py tools/mutation-auto.py <ref>')
        return 2
    base = sys.argv[1]
    limit = None
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    full = '--full' in sys.argv
    # --behaviour: только подмены, меняющие ПОВЕДЕНИЕ (условия, сравнения, связки,
    # возвраты, обрезки). Текстовые литералы и числа-константы — отдельным прогоном:
    # выживший текстовый мутант чаще значит «на эту подпись нет проверки», а это
    # не всегда дефект, и мешает читать результат.
    behaviour = '--behaviour' in sys.argv
    BEH = ('условие', 'тернарное', 'сравнение', '&&', 'возврат', 'обрезка')

    lines = changed_lines(base)
    skipped = {}
    cands = []
    for path, ln, text in lines:
        why = None
        for rx, label in SKIP:
            if rx.match(text):
                why = label
                break
        if why:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        muts = mutants_for(text)
        if not muts:
            skipped['нет применимой подмены'] = skipped.get('нет применимой подмены', 0) + 1
            continue
        for desc, new in muts:
            if behaviour and not desc.startswith(BEH):
                continue
            cands.append((path, ln, text, desc, new))

    print('Изменённых строк в src/js: ' + str(len(lines)))
    print('Отброшено:')
    for k in sorted(skipped, key=lambda x: -skipped[x]):
        print('   ' + str(skipped[k]).rjust(4) + '  ' + k)
    print('Мутаций получено: ' + str(len(cands)))
    if limit:
        cands = cands[:limit]
        print('Прогоняется (--limit): ' + str(len(cands)))
    print('Набор на мутацию: ' + ('весь npm test' if full else 'smoke.js'))
    print()
    sys.stdout.flush()

    # Два прогона в одном рабочем дереве затирают друг друга: второй замерит базу
    # в момент, когда первый держит мутацию, и объявит её красной. Ровно это здесь
    # и случилось. Грязное src/js — либо чужой прогон, либо несохранённая работа;
    # и то и другое делает результат бессмысленным.
    dirty = subprocess.run(['git', 'status', '--porcelain', '--', 'src/js/'],
                           cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if dirty:
        print(u'src/js \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0435\u0442 \u0441 \u043a\u043e\u043c\u043c\u0438\u0442\u043e\u043c \u2014 \u043f\u0440\u043e\u0433\u043e\u043d \u043e\u0442\u043c\u0435\u043d\u0451\u043d.')
        print(u'\u041b\u0438\u0431\u043e \u0438\u0434\u0451\u0442 \u0434\u0440\u0443\u0433\u043e\u0439 \u043c\u0443\u0442\u0430\u0446\u0438\u043e\u043d\u043d\u044b\u0439 \u043f\u0440\u043e\u0433\u043e\u043d, \u043b\u0438\u0431\u043e \u0435\u0441\u0442\u044c \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u043f\u0440\u0430\u0432\u043a\u0438:')
        print(dirty[:400])
        return 2

    # Проверка чистоты на СТАРТЕ не спасает: мешает работе не запуск, а тот,
    # кто правит файлы в СЕРЕДИНЕ прогона. Именно так критик увидел живую
    # мутацию, принял её за дефект, «починил» — и загрязнил весь прогон.
    #
    # Замок виден со стороны: любой, кто собрался трогать src/, может спросить
    # файл tools/.mutation-lock и узнать, что дерево сейчас не в своём виде.
    lock = os.path.join(ROOT, 'tools', '.mutation-lock')
    if os.path.exists(lock):
        try:
            held = io.open(lock, encoding='utf-8').read().strip()
        except Exception:
            held = '?'
        print(u'\u0417\u0430\u043c\u043e\u043a \u0437\u0430\u043d\u044f\u0442 \u2014 \u043f\u0440\u043e\u0433\u043e\u043d \u043e\u0442\u043c\u0435\u043d\u0451\u043d. \u0423\u0436\u0435 \u0438\u0434\u0451\u0442: ' + held)
        print(u'\u0415\u0441\u043b\u0438 \u0442\u043e\u0442 \u043f\u0440\u043e\u0433\u043e\u043d \u0443\u043c\u0435\u0440 \u2014 \u0443\u0434\u0430\u043b\u0438\u0442\u0435 tools/.mutation-lock \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 git status.')
        return 2
    io.open(lock, 'w', encoding='utf-8').write(
        base + u' \u00b7 ' + str(len(cands)) + u' \u043c\u0443\u0442\u0430\u0446\u0438\u0439 \u00b7 pid ' + str(os.getpid()))

    backup = tempfile.mkdtemp(prefix='automut_')
    files = sorted(set(c[0] for c in cands))
    for f in files:
        os.makedirs(os.path.join(backup, os.path.dirname(f)), exist_ok=True)
        shutil.copy(os.path.join(ROOT, f), os.path.join(backup, f))

    if run(full) != 'survived':
        print('БАЗА КРАСНАЯ — прогон бессмыслен')
        return 1

    survived, anchor_fail, caught = [], [], 0
    current = [None]  # файл, в котором ПРЯМО СЕЙЧАС стоит мутация

    def restore_all():
        """Вернуть всё на место и снять замок — на ЛЮБОМ выходе."""
        for f2 in files:
            try:
                shutil.copy(os.path.join(backup, f2), os.path.join(ROOT, f2))
            except OSError:
                pass
        try:
            os.remove(lock)
        except OSError:
            pass

    import atexit
    import signal
    atexit.register(restore_all)
    try:
        signal.signal(signal.SIGTERM, lambda *_: (restore_all(), sys.exit(130)))
        signal.signal(signal.SIGINT, lambda *_: (restore_all(), sys.exit(130)))
    except (ValueError, AttributeError):
        pass

    for i, (path, ln, text, desc, new) in enumerate(cands, 1):
        p = os.path.join(ROOT, path)
        src = io.open(p, encoding='utf-8').read()
        eol = '\r\n' if '\r\n' in src else '\n'
        body = src.replace('\r\n', '\n')
        if body.count(text) != 1:
            # Якорь не уникален — это ОШИБКА прогона, а не повод промолчать.
            anchor_fail.append((path, ln, desc, body.count(text)))
            print(str(i).rjust(3) + '  ЯКОРЬ x' + str(body.count(text)) + '  ' + path + ':' + str(ln) + '  ' + desc)
            sys.stdout.flush()
            continue
        io.open(p, 'w', encoding='utf-8', newline='').write(
            (body.replace(text, new)).replace('\n', eol) if eol == '\r\n' else body.replace(text, new))
        r = run(full)
        io.open(p, 'w', encoding='utf-8', newline='').write(src)
        if r == 'survived':
            survived.append((path, ln, text.strip()[:96], desc))
            print(str(i).rjust(3) + '  ВЫЖИЛ    ' + path + ':' + str(ln) + '  ' + desc)
        else:
            caught += 1
            print(str(i).rjust(3) + '  поймано  ' + path + ':' + str(ln) + '  ' + desc)
        sys.stdout.flush()

    for f in files:
        shutil.copy(os.path.join(backup, f), os.path.join(ROOT, f))
    subprocess.run(['node', 'src/build.js'], cwd=ROOT, capture_output=True)
    try:
        os.remove(lock)
    except OSError:
        pass

    # Результат пишется В ФАЙЛ, а не только в вывод: при фоновом запуске
    # перехват обрезается до хвоста, и счёт пойманных теряется — ровно это
    # случилось на первом полном прогоне.
    import json as _json
    _out = os.path.join(ROOT, 'tools', 'mutation-report.json')
    io.open(_out, 'w', encoding='utf-8').write(_json.dumps({
        'base': base, 'behaviour_only': behaviour, 'full_suite': full,
        'caught': caught,
        'survived': [{'file': p, 'line': l, 'code': t, 'mutation': d}
                     for p, l, t, d in survived],
        'anchor_fail': [{'file': p, 'line': l, 'mutation': d, 'matches': n}
                        for p, l, d, n in anchor_fail],
    }, ensure_ascii=False, indent=1))
    print('')
    print('отчёт: tools/mutation-report.json')

    total = caught + len(survived)
    print('\n' + '=' * 70)
    print('Поймано ' + str(caught) + ' из ' + str(total) +
          ('  (' + str(round(100.0 * caught / total)) + '%)' if total else ''))
    if anchor_fail:
        print('\nЯКОРЬ НЕ УНИКАЛЕН — эти строки НЕ ПРОВЕРЕНЫ (' + str(len(anchor_fail)) + '):')
        for path, ln, desc, n in anchor_fail[:20]:
            print('  ' + path + ':' + str(ln) + '  x' + str(n) + '  ' + desc)
    if survived:
        print('\nВЫЖИВШИЕ — поведение этих строк набором не проверяется (' + str(len(survived)) + '):')
        for path, ln, text, desc in survived:
            print('  ' + path + ':' + str(ln))
            print('      ' + desc)
            print('      ' + text)
    print('\nВыживший мутант НЕ равен дефекту: разберите каждого руками —')
    print('часть окажется подменой, которая поведения не меняет.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
