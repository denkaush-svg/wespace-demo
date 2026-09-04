/* ============================================================
   Scenario engine + mock adapters.
   Drives the Concierge chat for a scenario's `flow` steps.
   Approval states A1–A4, prepared AI processing, channel sims.
   ============================================================ */
(function (WS) {
  const I = WS.icon;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // spec §15.3 simulated durations
  const DUR = { voice: 1200, file: 1100, search: 1300, send: 800, simple: 500 };

  const engine = {
    session: null,       // current RUN state { scenarioId, flowIndex, pending, threadId }
    threads: {},         // entity-scoped conversations: id -> { id, label, icon, items:[] }
    activeThreadId: null, // which thread the Concierge is showing
    container: null,     // chat DOM node
    onUpdate: null,      // callback to re-render concierge
    _skip: false,
  };

  // ---------- threads (messenger model: one conversation per deal/object/lead) ----------
  const THREAD_MAP = {
    G1: 'deal:d_anna', G2: 'deal:d_anna', G3: 'deal:d_anna', S3: 'deal:d_anna', S8: 'deal:d_anna',
    S4: 'deal:d_viktor', S6: 'request:r_karim',
    S2: 'object:new', S10: 'object:new', S9: 'object:o_bayline',
    S14: 'lead:sarah', S15: 'lead:cold', S13: 'general', S1: 'general',
  };
  const THREAD_META = {
    'deal:d_anna': { label: 'Анна Петрова · сделка', icon: 'users' },
    'deal:d_viktor': { label: 'Виктор Орлов · документ', icon: 'users' },
    'request:r_karim': { label: 'Karim Aziz · партнёр', icon: 'users' },
    'object:new': { label: 'Новый объект · карточка', icon: 'building' },
    'object:o_bayline': { label: 'Bayline Terraces · доступность', icon: 'building' },
    'lead:sarah': { label: 'Sarah Mansour · ночной лид', icon: 'moon' },
    'lead:cold': { label: 'Холодный лид', icon: 'flame' },
    'general': { label: 'Общий', icon: 'sparkle' },
    'object:o_bayline_av': { label: 'Bayline 1603 · проверка', icon: 'building' },
    'contact:c_partner': { label: 'Karim Aziz · подбор', icon: 'users' },
    'request:r_viktor': { label: 'Виктор Орлов · запрос', icon: 'mail' },
    'deal:d_rentbiz': { label: 'Портфель DIFC · сделка', icon: 'briefcase' },
  };
  function threadMeta(id) { return THREAD_META[id] || { label: id, icon: 'chat' }; }
  /* ---------- what was quietly thrown away ----------

     Nearly every guard around the Concierge degrades silently, and that is the
     right behaviour: a visitor gets a plainer answer, never a broken one. The
     price is that nobody can say how often it happens. «Блок выбросят молча»
     appears in four comments in this codebase and was never once a number.

     So each drop is counted where it happens — cheap, in memory, never shown to
     the broker. It is read by the day-run, which records it per question, and
     by whoever asks whether the stand is answering well rather than merely
     answering. Names are free-form on purpose: a counter that throws on an
     unfamiliar key would turn a degradation into an outage, inside the very
     path that exists to prevent one. */
  const counts = {};
  WS.quality = {
    note(kind) {
      const k = String(kind || 'unknown');
      counts[k] = (counts[k] || 0) + 1;
      return counts[k];
    },
    counts() { return Object.assign({}, counts); },
    reset() { Object.keys(counts).forEach((k) => { delete counts[k]; }); },
  };
  const note = (k) => WS.quality.note(k);

  function ensureThread(id) {
    if (!engine.threads[id]) { const m = threadMeta(id); engine.threads[id] = { id: id, label: m.label, icon: m.icon, items: [], updatedAt: null, seen: 0 }; }
    return engine.threads[id];
  }
  function items() { const t = engine.threads[engine.activeThreadId]; return t ? t.items : []; }

  // Messages are addressed by id, never by position. A streamed reply is updated many
  // times while tool writes redraw the app around it; "replace the last item" would
  // clobber whatever arrived in between.
  let midSeq = 0;
  function nextMid() { midSeq++; return 'm' + midSeq; }
  function item(html) { return { id: nextMid(), html: html }; }
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]); }
  // strip HTML → plain-text preview for the thread list
  function stripHtml(html) { return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function markSeen(id) { const t = engine.threads[id]; if (t) t.seen = t.items.length; }
  // Seed the night-lead conversation so the Concierge opens with a real unread thread
  // (mirrors fixtures.inbox night lead — not fabricated).
  // Панель диалогов не должна открываться пустой: агент приходит в Консьержа с историей, а не с
  // чистым листом, и по ней надо иметь возможность походить. Всё, что здесь засеяно, опирается на
  // те же фикстуры, что и карточки, — выдуманных сущностей в переписке нет.
  const SEED = [
    { id: 'lead:sarah', at: '02:14', unread: 1, items: [
      ['user', 'Sarah Mansour · @wa · 02:14', 'Hi, still looking for a 1BR investment unit in JVC, budget ~1.3M. Can you help?'],
    ] },
    { id: 'deal:d_anna', at: '09:34', items: [
      ['user', 'Марина Волкова · 09:30', 'Собери бриф к звонку с Анной — что напомнить и о чём не говорить.'],
      ['ai', 'Консьерж · 09:34', 'Анна ждёт график первого платежа: просила его 14 мая и с тех пор к теме не возвращалась. ' +
        'Показ Creekline прошёл 9 мая, объект она выбрала 11-го. Не начинайте с доходности — она её уже посчитала; ' +
        'начните с графика и срока внесения EOI. Тон по делу, с расчётами, без давления.'],
    ] },
    { id: 'deal:d_viktor', at: 'вчера', items: [
      ['user', 'Марина Волкова · вчера', 'Что нужно к Oqood по брони Bayline?'],
      ['ai', 'Консьерж · вчера', 'Бронирование 97 500 AED внесено 12 мая, MOU согласован. Для Oqood не хватает подтверждения дохода ' +
        'от Emirates NBD — банк запросил его 13 мая, задача на вас. Черновик договора бронирования у клиента с 13 мая, подписи пока нет.'],
    ] },
    { id: 'object:o_bayline_av', at: 'вчера', unread: 1, items: [
      ['user', 'Омар Рахман · вчера', 'Bayline 1603 ещё в продаже? Клиент спрашивает.'],
      ['ai', 'Консьерж · вчера', 'Проверка доступности от 2 апреля — устарела, прошло больше месяца. Trakheesi по объекту в процессе, ' +
        'до его получения объект нельзя публиковать как листинг. Прежде чем обещать показ, сверьтесь с застройщиком.'],
    ] },
    { id: 'contact:c_partner', at: '09:12', items: [
      ['user', 'Лина Хассан · 09:00', 'Karim просит резиденцию в Downtown до 2,6 млн. У нас там есть что-нибудь?'],
      ['ai', 'Консьерж · 09:12', 'В Downtown своего инвентаря нет ни одного объекта. Ближе всего по остальным критериям — ' +
        'Park Terrace в JVC, но район не тот, что он просил. Разумнее запросить объект у клубного партнёра: ' +
        'соглашение брокеров по этой сделке уже в черновике.'],
    ] },
    { id: 'request:r_viktor', at: '05 мая', items: [
      ['user', 'Марина Волкова · 05 мая', 'Собери КП по портфелю DIFC и квартире Bayline.'],
      ['ai', 'Консьерж · 05 мая', 'КП собрано на три объекта: Bayline 1603 и два смежных офиса в DIFC Gate District. ' +
        'Офисы уходят одним договором — они в одном комплексе; Bayline оформляется отдельно, это другой проект. ' +
        'Расчёт доходности и график платежей внутри.'],
    ] },
    { id: 'general', at: 'сегодня', items: [
      ['user', 'Марина Волкова · сегодня', 'Что просрочено на этой неделе?'],
      ['ai', 'Консьерж · сегодня', 'Один контакт просрочен: КП Игорю Лебедеву обещали 12 мая и не отправили. ' +
        'По остальным сделкам сроки в пределах; ближайший — показ Creekline сегодня в 16:00.'],
    ] },
  ];
  function seedThreads() {
    SEED.forEach((sd) => {
      const t = ensureThread(sd.id);
      if (t.items.length) return;
      sd.items.forEach((m) => t.items.push(item(msg(m[0], m[1].replace('@wa', chanIcon('whatsapp')), esc(m[2])))));
      t.updatedAt = sd.at;
      // Непрочитанным остаётся ровно то, чего агент ещё не открывал.
      t.seen = sd.unread ? Math.max(0, t.items.length - sd.unread) : t.items.length;
    });
  }

  // Proactive push (event layer): message lands in a thread the agent didn't open →
  // stays unread. Does NOT change activeThreadId.
  function pushEvent(threadId, label, icon, html) {
    const t = ensureThread(threadId);
    if (label) t.label = label; if (icon) t.icon = icon;
    t.items.push(item(html));
    t.updatedAt = WS.storeApi.clockLabel().time;
    if (engine.onUpdate && engine.activeThreadId === threadId) engine.onUpdate();
  }
  function aiMsg(who, body) { return msg('ai', who, body); }

  function el() { return engine.container; }
  function scrollDown() { const c = el(); if (c) requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; }); }
  // Append to a named thread and return the id of the message, so a later chunk can
  // find it again even if the agent has walked off to another conversation.
  function pushMsg(html, threadId) {
    const tid = threadId || engine.activeThreadId || 'general';
    const t = ensureThread(tid);
    const m = item(html);
    t.items.push(m);
    t.updatedAt = WS.storeApi.clockLabel().time;
    if (engine.onUpdate && engine.activeThreadId === tid) engine.onUpdate();
    scrollDown();
    return m.id;
  }
  // Refuses rather than falling through to another message when the target is gone.
  function updateMsg(id, html, threadId) {
    const tid = threadId || engine.activeThreadId;
    const t = engine.threads[tid];
    if (!t) return false;
    const m = t.items.find((x) => x.id === id);
    if (!m) return false;
    m.html = html;
    if (engine.onUpdate && engine.activeThreadId === tid) engine.onUpdate();
    return true;
  }
  // `who` is our own composed label (icons, channel); `text` is not ours - a client's
  // wording, a model's reply, a pasted transcript - so it is shown as text, not markup.
  function pushText(role, who, text, threadId) { return pushMsg(msg(role, who, esc(text)), threadId); }

  function push(html) { return pushMsg(html); }
  function replaceLast(html) {
    const it = items();
    if (!it.length) return false;
    it[it.length - 1].html = html;
    if (engine.onUpdate) engine.onUpdate();
    scrollDown();
    return true;
  }

  // ---------- renderers ----------
  function msg(role, who, body) {
    return '<div class="msg ' + role + ' fadeup"><div class="who">' + who + '</div><div class="bubble">' + body + '</div></div>';
  }
  function chanIcon(ch) {
    if (ch === 'voice') return I('mic') + ' голосом';
    if (ch === 'whatsapp') return I('whatsapp') + ' WhatsApp';
    if (ch === 'file') return I('upload') + ' файл';
    if (ch === 'email') return I('mail') + ' email';
    return I('chat') + ' текст';
  }

  function shortlistCard() {
    const objs = WS.store.data.objects;
    let rows = objs.map((o) => {
      const vb = o.verified === 'verified'
        ? '<span class="badge ok">' + I('check') + 'Проверено ' + o.checkedAt + '</span>'
        : '<span class="badge warn">' + I('warn') + 'Проверка истекла</span>';
      const sb = '<span class="badge">' + I(o.source === 'club' ? 'star' : o.source === 'import' ? 'download' : 'briefcase') + o.sourceLabel + '</span>';
      return '<div class="obj-card" style="margin-bottom:10px"><div class="obj-body">' +
        '<div class="ot">' + o.name + '</div>' +
        '<div class="om">' + o.area + ' · ' + o.br + ' · ' + o.size + ' м²</div>' +
        '<div class="obadges">' + sb + vb + '<span class="badge acc">' + WS.AED(o.price) + '</span></div>' +
        '<div class="match">' + I('target') + '<span>' + o.match + '</span></div>' +
        '</div></div>';
    }).join('');
    return '<div style="margin-top:10px">' + rows + '</div>';
  }

  function financeCard() {
    const m = WS.store.data.refModel;
    const r = WS.finance.compute(m);
    const kpi = (v, k, neg) => '<div class="kpi"><div class="kv' + (neg ? ' neg' : '') + '">' + v + '</div><div class="kk">' + k + '</div></div>';
    return '<div class="card pad" style="margin-top:10px">' +
      '<div class="fin-kpis">' +
        kpi(r.fmt.roi5, 'ROI 5 лет') + kpi(r.fmt.irr, 'IRR') + kpi(r.fmt.npv, 'NPV', r.npv < 0) +
      '</div>' +
      '<div class="prov" style="margin-top:4px"><span class="src">' + I('source') + 'Creekline 1208 · допущения из сделки</span>' +
      '<span class="badge demo">' + I('lock') + 'DEMO расчёт</span></div>' +
      '<div style="margin-top:10px;font-size:12px;color:var(--mut)">Валовая доходность ' + r.fmt.grossYield + ' · чистая ' + r.fmt.netYield + '. Открыть полную модель — раздел «Подборы и расчёты».</div>' +
      '<button class="btn sm" style="margin-top:10px" data-nav="calc">' + I('calc') + 'Открыть финмодель</button>' +
      '</div>';
  }

  function docCard() {
    return '<div class="card pad" style="margin-top:10px">' +
      '<div style="display:flex;align-items:center;gap:10px"><div class="icon-tile i-acc">' + I('doc') + '</div>' +
      '<div><div style="font-weight:650;color:var(--ink)">Договор бронирования · черновик v1</div>' +
      '<div style="font-size:12px;color:var(--mut)">Заполнено 7 из 8 полей</div></div>' +
      '<span class="badge stop" style="margin-left:auto">' + I('lock') + 'Экспорт заблокирован</span></div>' +
      '<div class="field missing" style="margin-top:8px"><div class="k">Дата заезда</div><div class="v">обязательное поле не заполнено</div></div>' +
      '<button class="btn sm" style="margin-top:8px" data-nav="docs">' + I('eye') + 'Открыть документ</button></div>';
  }

  /* `skippable` is false for a wait nobody can shorten. The button used to be
     drawn on every process card, including the one covering a live model call —
     where the delay is the call itself and the flag it sets is read only by the
     scripted player. Clicking it did nothing, which is the worst thing a
     control can do: it teaches that the buttons here are decoration. */
  function processCard(step, activeIdx, done, skippable) {
    const rows = step.steps.map((s, i) => {
      let cls = 'step', ic = '';
      if (i < activeIdx || done) { cls += ' done'; ic = '<div class="dot">' + I('check') + '</div>'; }
      else if (i === activeIdx) { cls += ' active'; ic = '<div class="dot"></div>'; }
      else { ic = '<div class="dot"></div>'; }
      const note = (i === activeIdx && !done && step.notes && step.notes[i])
        ? '<em class="note">' + step.notes[i] + '</em>' : '';
      return '<div class="' + cls + '">' + ic + '<span>' + s + note + '</span></div>';
    }).join('');
    const skip = (!done && skippable !== false)
      ? '<button class="skip" data-eng="skip">Пропустить ожидание</button>' : '';
    return '<div class="msg ai fadeup"><div class="who">' + I('sparkle', '') + ' Консьерж</div>' +
      '<div class="processing"><div class="icon-tile i-acc">' + I('sparkle') + '</div>' +
      '<div class="steps">' + rows + '</div></div>' +
      (skip ? '<div style="margin-top:4px">' + skip + '</div>' : '') + '</div>';
  }

  function previewCard(step, rejected, filled) {
    rejected = rejected || new Set();
    filled = filled || {};
    const lvl = (step.level || 'A1').toLowerCase();
    const fields = step.fields.map((f, i) => {
      const isRej = rejected.has(i);
      const isFilled = f.missing && filled[i] != null;
      const stillMissing = f.missing && !isFilled;
      let v;
      if (stillMissing) v = '<span>' + (f.hint || 'не заполнено') + '</span>';
      else if (isFilled) v = '<span class="now">' + filled[i] + '</span>';
      else if (f.was) v = '<span class="was">' + f.was + '</span><span class="now">' + f.now + '</span>';
      else v = '<span class="now">' + f.now + '</span>';
      const src = (f.src && !stillMissing) ? '<div class="prov" style="margin-top:3px"><span class="src">' + I('source') + (isFilled ? 'уточнено агентом' : f.src) + '</span></div>' : '';
      const art = f.artifact ? '<button class="mini-btn" data-eng="artifact" data-art="' + f.artifact + '">' + I('eye') + ' смотреть</button>' : '';
      const fill = stillMissing ? '<button class="mini-btn cta-hint" data-eng="fill" data-i="' + i + '">' + I('plus') + ' уточнить</button>' : '';
      const rej = (!f.missing && step.level === 'A3') ? '<button class="mini-btn" data-eng="reject" data-i="' + i + '">' + (isRej ? 'вернуть' : 'отклонить') + '</button>' : '';
      return '<div class="field' + (stillMissing ? ' missing' : '') + (isRej ? ' rejected' : '') + '"><div class="k">' + f.k + '</div>' +
        '<div class="v">' + v + src + '</div><div class="fx">' + fill + art + rej + '</div></div>';
    }).join('');
    const branch = step.branch ? '<div style="padding:10px 15px"><span class="badge warn">' + I('shield') + step.branch.label + '</span><div style="font-size:12px;color:var(--mut);margin-top:6px">' + step.branch.text + '</div></div>' : '';
    const hasMissing = step.fields.some((f, i) => f.missing && filled[i] == null);
    const confirmLabel = step.confirm || 'Подтвердить изменения';
    const noteIcon = step.level === 'A2' ? I('shield') : I('warn');
    const confirmBtn = hasMissing
      ? '<button class="btn primary" disabled title="Заполните обязательное поле">' + I('lock') + confirmLabel + '</button>'
      : '<button class="btn primary cta-hint" data-eng="confirm">' + I('check') + confirmLabel + '</button>';
    return '<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('sparkle') + ' Консьерж · предпросмотр</div>' +
      '<div class="preview"><div class="ph"><div class="icon-tile i-acc">' + I('layers') + '</div><div class="t">' + step.title + '</div>' +
      '<span class="lvl-tag ' + lvl + ' lvl">' + (step.level || 'A1') + (step.channel ? ' · ' + step.channel : '') + '</span></div>' +
      '<div class="pb">' + fields + '</div>' + branch +
      '<div class="approval"><div class="note">' + noteIcon + '<span>' + (step.note || '') + '</span></div>' +
      '<div class="acts"><button class="btn sm ghost" data-eng="edit">Изменить</button>' + confirmBtn + '</div></div></div></div>';
  }

  function resultCard(step) {
    const evs = step.events.map((e) => '<div class="feed-row"><div class="fi i-ok">' + I('check') + '</div><div class="ft"><div class="t">' + e + '</div></div></div>').join('');
    const branch = step.branchNote ? '<div style="margin-top:8px"><span class="badge warn">' + I('shield') + 'Безопасная ветка</span> <span style="font-size:12px;color:var(--mut)">' + step.branchNote + '</span></div>' : '';
    const artifact = step.artifact ? '<button class="btn cta-hint" style="margin-top:12px;margin-right:8px" data-artopen="' + step.artifact.id + '">' + I('eye') + (step.artifact.label || 'Открыть результат') + '</button>' : '';
    const rollback = step.rollback ? '<button class="btn sm" style="margin-top:12px;margin-right:8px" data-eng="rollback">' + I('replay') + 'Отменить пакет целиком</button>' : '';
    const next = step.next ? '<button class="btn primary cta-hint" style="margin-top:12px" data-eng="next" data-next="' + step.next + '">' + I('arrowRight') + (step.nextLabel || 'Дальше') + '</button>' : '';
    return '<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('checkCircle') + ' Результат</div>' +
      '<div class="card pad"><div style="display:flex;align-items:center;gap:9px;margin-bottom:6px"><span class="badge ok">' + I('checkCircle') + step.title + '</span></div>' +
      '<div class="feed">' + evs + '</div>' + branch + artifact + rollback + next + '</div></div>';
  }

  // ---------- interactive panels (S2/S4/S10/S9 mechanics, spec §16 safe branches) ----------
  function fieldRow(k, v, src, cls) {
    const s = src ? '<div class="prov" style="margin-top:3px"><span class="src">' + I('source') + src + '</span></div>' : '';
    return '<div class="field ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + s + '</div></div>';
  }
  function panelShell(step, inner, actions, branch) {
    const lvl = step.level ? '<span class="lvl-tag ' + step.level.toLowerCase() + ' lvl">' + step.level + '</span>' : '';
    const br = branch ? '<div style="padding:10px 15px"><span class="badge warn">' + I('shield') + branch.label + '</span><div style="font-size:12px;color:var(--mut);margin-top:6px">' + branch.text + '</div></div>' : '';
    return '<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('sparkle') + ' Консьерж · ' + step.who + '</div>' +
      '<div class="preview"><div class="ph"><div class="icon-tile i-acc">' + I(step.icon || 'layers') + '</div><div class="t">' + step.title + '</div>' + lvl + '</div>' +
      '<div class="pb">' + inner + '</div>' + br +
      '<div class="approval"><div class="note">' + I('shield') + '<span>' + (step.note || '') + '</span></div><div class="acts">' + actions + '</div></div></div></div>';
  }

  function extractCard(step, ps) {
    let inner = step.fields.map((f) => fieldRow(f.k, f.v, f.src)).join('');
    // price/area conflict resolved manually
    const c = step.conflict;
    const chosen = ps.resolved;
    inner += '<div class="field ' + (chosen ? '' : 'missing') + '"><div class="k">' + c.k + '</div><div class="v">' +
      (chosen ? '<span class="now">' + c.options.find((o) => o.id === chosen).v + '</span><div class="prov" style="margin-top:3px"><span class="src">' + I('source') + 'разрешено вручную</span></div>'
              : '<span style="color:var(--warn)">конфликт значений — выберите источник</span>') + '</div>' +
      '<div class="fx">' + c.options.map((o) => '<button class="mini-btn' + (chosen === o.id ? '' : ' cta-hint') + '" data-eng="panelResolve" data-val="' + o.id + '">' + o.label + '</button>').join('') + '</div></div>';
    const prim = chosen
      ? '<button class="btn primary cta-hint" data-eng="panelPrimary">' + I('check') + 'Подтвердить карточку</button>'
      : '<button class="btn primary" disabled title="Разрешите конфликт">' + I('lock') + 'Подтвердить карточку</button>';
    return panelShell(step, inner, prim, step.branch);
  }

  function docformCard(step, ps) {
    let inner = step.fields.map((f) => fieldRow(f.k, f.v, f.src)).join('');
    const m = step.missing;
    inner += '<div class="field ' + (ps.filled ? '' : 'missing') + '"><div class="k">' + m.k + '</div><div class="v">' +
      (ps.filled ? '<span class="now">' + m.fill + '</span>' : '<span style="color:var(--warn)">обязательное поле не заполнено</span>') + '</div>' +
      '<div class="fx">' + (ps.filled ? '' : '<button class="mini-btn cta-hint" data-eng="panelFill">' + I('plus') + ' заполнить</button>') + '</div></div>';
    const exp = ps.filled
      ? '<button class="btn primary cta-hint" data-eng="panelPrimary">' + I('doc') + 'Зафиксировать версию</button>'
      : '<button class="btn primary" disabled title="Заполните обязательное поле">' + I('lock') + 'Экспорт заблокирован</button>';
    return panelShell(step, inner, exp, step.branch);
  }

  function publishCard(step, ps) {
    const inner = step.checks.map((c) => {
      const cls = c.status === 'ok' ? 'ok' : c.status === 'pending' ? 'warn' : 'stop';
      const ic = c.status === 'ok' ? 'check' : c.status === 'pending' ? 'clock' : 'x';
      return '<div class="field"><div class="k">' + c.label + '</div><div class="v"><span class="badge ' + cls + '">' + I(ic) + c.state + '</span></div></div>';
    }).join('');
    const acts = '<button class="btn" disabled title="Нет Madmoun QR">' + I('lock') + 'Опубликовать</button>' +
      '<button class="btn primary cta-hint" data-eng="panelPrimary">' + I('layers') + 'Подготовить пакет + задача на QR</button>';
    return panelShell(step, inner, acts, step.branch);
  }

  function availabilityCard(step, ps) {
    if (!ps.checked) {
      const src = step.sources.map((s) => '<div class="field"><div class="k">Источник</div><div class="v">' + s + '</div></div>').join('');
      const act = '<button class="btn primary cta-hint" data-eng="panelCheck">' + I('replay') + 'Проверить доступность</button>';
      return panelShell(step, src, act, step.branch);
    }
    const rows = step.results.map((r) => {
      const map = { available: ['ok', 'check', 'Доступен'], unavailable: ['stop', 'x', 'Недоступен'], noanswer: ['warn', 'clock', 'Нет ответа'] };
      const [cls, ic, lbl] = map[r.status];
      return '<div class="field"><div class="k">' + r.name + '</div><div class="v"><span class="badge ' + cls + '">' + I(ic) + lbl + '</span>' +
        '<div class="prov" style="margin-top:3px"><span class="src">' + I('source') + r.src + ' · ' + r.at + '</span></div></div></div>';
    }).join('');
    const act = '<button class="btn" disabled title="Повторно связываться в тот же день нельзя">' + I('lock') + 'Повторить сегодня</button>' +
      '<button class="btn primary cta-hint" data-eng="panelPrimary">' + I('check') + 'Пересобрать подборку</button>';
    return panelShell(step, rows, act, step.branch);
  }

  function panelCard(step, ps) {
    ps = ps || {};
    if (step.kind === 'extract') return extractCard(step, ps);
    if (step.kind === 'docform') return docformCard(step, ps);
    if (step.kind === 'publish') return publishCard(step, ps);
    if (step.kind === 'availability') return availabilityCard(step, ps);
    return '';
  }

  // ---------- flow control ----------
  function startScenario(id, chainId) {
    const scn = WS.scenarioById(id);
    if (!scn) return;
    // resolve chain context: explicit chainId, else keep current chain if it contains id
    const wantChain = chainId || WS.store.tour.chainId;
    const chain = wantChain ? WS.chainById(wantChain) : null;
    const inChain = chain && chain.scenarios.includes(id);
    const tour = {
      active: true, scenarioId: id, stepIndex: 0, coach: null, done: false,
      chainId: inChain ? chain.id : null,
      chainIndex: inChain ? chain.scenarios.indexOf(id) : 0,
      chainLen: inChain ? chain.scenarios.length : 1,
    };
    // scenarios with a dedicated view (e.g. S5 radar) just navigate there
    if (scn.view) {
      WS.storeApi.setScenarioStatus(id, 'done');
      WS.store.tour = inChain ? Object.assign(tour, { done: true }) : { active: false, scenarioId: null, stepIndex: 0 };
      WS.router.go(scn.view, { scenario: id });
      return;
    }
    // bind the run to its entity thread (messenger model)
    const threadId = THREAD_MAP[id] || 'general';
    ensureThread(threadId);
    engine.activeThreadId = threadId;
    engine.session = { scenarioId: id, threadId: threadId, flowIndex: 0, pending: null, rejected: new Set(), filled: {} };
    WS.store.tour = tour;
    WS.storeApi.setScenarioStatus(id, 'prog');
    // docked chat: stay on the current page — render the flow in the dock instead of navigating
    if (!WS.store.cgDock) WS.router.go('concierge'); else if (WS.ui && WS.ui.renderCgDock) WS.ui.renderCgDock();
    setTimeout(() => advance(), 60);
  }

  // Выбрать тред, НЕ уходя с текущего экрана. Диалог внутри карточки сделки и раздел Консьержа —
  // это один и тот же тред, показанный в двух местах; разница только в том, меняется ли маршрут.
  function bindThread(threadId, label, icon) {
    const t = ensureThread(threadId);
    if (label) t.label = label;
    if (icon) t.icon = icon;
    engine.activeThreadId = threadId;
    engine.session = null;
    markSeen(threadId);
    return t;
  }
  function openThread(threadId, label, icon) {
    bindThread(threadId, label, icon);
    WS.router.go('concierge');
  }
  function closeThread() { engine.activeThreadId = null; engine.session = null; WS.storeApi.emit(); }
  // Abort a running scene's live session if it matches (used by resetScene).
  function endSessionForScene(id) { if (engine.session && engine.session.scenarioId === id) { engine.session = null; } }
  function threadList() {
    return Object.keys(engine.threads).map((k) => engine.threads[k]).filter((t) => t.items.length)
      .map((t) => Object.assign({}, t, {
        preview: stripHtml(t.items[t.items.length - 1].html).slice(0, 68),
        unread: Math.max(0, t.items.length - (t.seen || 0)),
      }));
  }
  function activeThread() { return engine.threads[engine.activeThreadId] || null; }

  /* ---------- an instruction the broker started and has not finished ----------

     It is held on the CONVERSATION, because that is its scope: threads here are
     per deal, per object, per lead, and a name given in one of them answers the
     question asked in that one. A single global slot would have carried an
     answer across to whatever the agent walked into next.

     Nothing here is invented by the model. The operation it means to run is
     parked exactly as it sent it, minus the field the write layer refused it
     for — so what resumes is the instruction itself, not a retelling.

     And it goes stale. Three exchanges later a short reply is about something
     else, and taking it as the missing name would file a stranger. Absent beats
     stale: forgetting costs one repeated question, guessing costs a record. */
  const PENDING_STALE_AFTER = 6;   // messages, so three exchanges

  function pendingAction() {
    const t = activeThread();
    const p = t && t.pending;
    if (!p) return null;
    if ((t.items || []).length - p.at > PENDING_STALE_AFTER) { t.pending = null; note('pending_stale'); return null; }
    return p;
  }
  function setPendingAction(p) {
    const t = activeThread() || ensureThread(engine.activeThreadId || 'general');
    t.pending = p ? Object.assign({}, p, { at: (t.items || []).length }) : null;
  }
  function clearPendingAction() {
    const t = activeThread();
    if (t) t.pending = null;
  }

  function startChain(chainId) {
    const c = WS.chainById(chainId);
    if (c) startScenario(c.scenarios[0], chainId);
  }

  function setCoach(text) { WS.store.tour.coach = text; WS.storeApi.emit(); }

  async function advance() {
    const s = engine.session; if (!s) return;
    const scn = WS.scenarioById(s.scenarioId);
    if (s.flowIndex >= scn.flow.length) return;
    const step = scn.flow[s.flowIndex];
    WS.store.tour.stepIndex = s.flowIndex;

    // guard: bail if the session was swapped/reset mid-await (spec: no cross-scene corruption)
    const alive = () => engine.session === s;
    if (step.type === 'user') {
      push(msg('me', chanIcon(step.channel), step.text));
      s.flowIndex++; await delay(360); if (!alive()) return; return advance();
    }
    if (step.type === 'ai') {
      let body = step.text;
      if (step.shortlist) body += shortlistCard();
      if (step.finance) body += financeCard();
      if (step.doc) body += docCard();
      push(msg('ai', I('sparkle') + ' Консьерж', body));
      s.flowIndex++; await delay(320); if (!alive()) return; return advance();
    }
    if (step.type === 'process') {
      engine._skip = false;
      const dur = DUR[step.kind] || DUR.simple;
      const per = Math.max(180, dur / step.steps.length);
      const mid = pushMsg(processCard(step, 0, false));
      const tid = engine.activeThreadId;
      for (let i = 0; i < step.steps.length; i++) {
        updateMsg(mid, processCard(step, i, false), tid);
        scrollDown();
        if (!engine._skip) await delay(per);
        if (!alive()) return;
      }
      updateMsg(mid, processCard(step, step.steps.length, true), tid);
      s.flowIndex++; await delay(200); if (!alive()) return; return advance();
    }
    if (step.type === 'preview') {
      s.rejected = new Set();
      s.filled = {};
      s.pending = step;
      push(previewCard(step, s.rejected, s.filled));
      const hasMissing = step.fields.some((f) => f.missing);
      setCoach(hasMissing
        ? 'Уточните обязательное поле, затем подтвердите: ' + step.title
        : (step.level === 'A2' ? 'Внешнее действие — подтвердите отправку: ' + step.title : 'Проверьте изменения и подтвердите: ' + step.title));
      return; // wait for confirm
    }
    if (step.type === 'panel') {
      s.panel = {};
      s.pending = step;
      push(panelCard(step, s.panel));
      setCoach(step.coach || ('Разберите панель и подтвердите: ' + step.title));
      return; // wait for panel primary action
    }
    if (step.type === 'result') {
      // apply declarative effects to shared data (spec §18.2) then log events (§14.2)
      WS.storeApi.applyEffects(step.effects);
      step.events.forEach((e) => WS.storeApi.logEvent({ scenario: s.scenarioId, action: e, result: 'EXECUTED', level: 'A3' }));
      push(resultCard(step));
      WS.storeApi.setScenarioStatus(s.scenarioId, 'done');
      WS.store.tour.done = true;
      s.flowIndex++;
      setCoach(step.next ? ('Готово. Дальше: ' + (step.nextLabel || 'следующий шаг')) : 'Сценарий пройден.');
      return;
    }
  }

  // ---------- interaction handlers (delegated from main.js) ----------
  function handle(action, ds) {
    const s = engine.session;
    if (action === 'skip') { engine._skip = true; return; }
    if (!s) return;
    if (action === 'reject') {
      const i = +ds.i;
      if (s.rejected.has(i)) s.rejected.delete(i); else s.rejected.add(i);
      replaceLast(previewCard(s.pending, s.rejected, s.filled));
      return;
    }
    if (action === 'fill') {
      const i = +ds.i;
      const f = s.pending.fields[i];
      s.filled[i] = f.fill || 'уточнено';
      replaceLast(previewCard(s.pending, s.rejected, s.filled));
      WS.storeApi.toast('Поле «' + f.k + '» уточнено', 'ok');
      return;
    }
    if (action === 'panelResolve') { s.panel.resolved = ds.val; replaceLast(panelCard(s.pending, s.panel)); WS.storeApi.toast('Источник выбран', 'ok'); return; }
    if (action === 'panelFill') { s.panel.filled = true; replaceLast(panelCard(s.pending, s.panel)); WS.storeApi.toast('Обязательное поле заполнено', 'ok'); return; }
    if (action === 'panelCheck') {
      WS.storeApi.toast('Проверяю доверенные источники…');
      setTimeout(() => { if (engine.session === s && s.panel) { s.panel.checked = true; replaceLast(panelCard(s.pending, s.panel)); } }, 900);
      return;
    }
    if (action === 'panelPrimary') {
      const step = s.pending; const res = step.result;
      WS.storeApi.applyEffects(res.effects);
      res.events.forEach((e) => WS.storeApi.logEvent({ scenario: s.scenarioId, action: e, result: 'EXECUTED', level: step.level || 'A3' }));
      replaceLast('<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('checkCircle') + ' Подтверждено</div>' +
        '<div class="card pad" style="border-color:var(--ok-line)"><span class="badge ok">' + I('check') + step.title + ' — применено</span></div></div>');
      push(resultCard(res));
      WS.storeApi.setScenarioStatus(s.scenarioId, 'done');
      WS.store.tour.done = true;
      s.pending = null; s.flowIndex++;
      setCoach(res.next ? ('Готово. Дальше: ' + (res.nextLabel || 'следующий шаг')) : 'Сценарий пройден.');
      return;
    }
    if (action === 'artifact') { WS.ui.openArtifact(ds.art); return; }
    if (action === 'edit') { WS.storeApi.toast('Режим ручной правки полей (демо)', ''); return; }
    if (action === 'confirm') {
      const step = s.pending;
      // A2 external → channel sim (spec §13.2): sent → delivered
      if (step.level === 'A2') {
        WS.storeApi.toast('Отправка через ' + (step.channel || 'whatsapp') + ' · delivered', 'ok');
      }
      // A3 partial reject: apply per-field effects ONLY for accepted fields (spec §18.5)
      if (step.fieldEffects) {
        Object.keys(step.fieldEffects).forEach((k) => {
          if (!s.rejected.has(+k)) WS.storeApi.applyEffects(step.fieldEffects[k]);
        });
      }
      // mark confirmed: replace preview with a confirmed compact version
      const rejectedCount = s.rejected.size;
      const confirmedNote = rejectedCount ? (' · отклонено полей: ' + rejectedCount) : '';
      replaceLast('<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('checkCircle') + ' Подтверждено' + confirmedNote + '</div>' +
        '<div class="card pad" style="border-color:var(--ok-line)"><span class="badge ok">' + I('check') + step.title + ' — применено' + (rejectedCount ? ' (' + rejectedCount + ' полей отклонено)' : '') + '</span></div></div>');
      WS.storeApi.logEvent({ scenario: s.scenarioId, action: step.title, result: 'EXECUTED', level: step.level });
      s.pending = null; s.flowIndex++;
      setTimeout(() => advance(), 260);
      return;
    }
    if (action === 'rollback') {
      const id = s.scenarioId;
      WS.storeApi.resetScene(id);
      pushMsg('<div class="msg ai fadeup"><div class="who">' + I('replay') + ' Откат</div>' +
        '<div class="card pad" style="border-color:var(--stop-line)"><span class="badge stop">' + I('reset') + 'Пакет отменён — исходные данные восстановлены</span></div></div>');
      WS.storeApi.toast('Пакет отменён, данные восстановлены', 'ok');
      return;
    }
    if (action === 'next') {
      // guard against a double-click re-launching the same scenario over itself (audit P0-3)
      if (engine.session && engine.session.scenarioId === ds.next) return;
      startScenario(ds.next); return;
    }
  }

  function mount(container, onUpdate) { engine.container = container; engine.onUpdate = onUpdate; }
  function reset() { engine.session = null; engine.threads = {}; engine.activeThreadId = null; seedThreads(); }
  // persistence hooks (audit P0-6): threads survive a page reload
  // The chat is persisted as markup, and the buttons under it point at reply
  // objects that only lived in memory. After a reload every «откуда это число»,
  // every follow-up and every «прослушать» under an older answer resolved to
  // nothing and did nothing at all. The replies ride along with their messages.
  function exportThreads() {
    const out = {};
    Object.keys(engine.threads).forEach((k) => {
      const t = engine.threads[k];
      out[k] = Object.assign({}, t, {
        items: (t.items || []).map((m) => (replies[m.id] ? Object.assign({}, m, { reply: replies[m.id] }) : m)),
      });
    });
    return out;
  }
  // Threads come back from localStorage and are then written into the DOM, so they are
  // treated as input: anything that is not a well-formed thread is dropped rather than
  // trusted. Without this, a tampered or half-written snapshot becomes persistent markup.
  function importThreads(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    const clean = {};
    // The whole set of threads is being replaced, so the answers behind them
    // are too: keeping the old map would leave replies from a previous
    // snapshot addressable under ids the new one reuses.
    Object.keys(replies).forEach((k) => { delete replies[k]; });
    Object.keys(obj).forEach((k) => {
      const t = obj[k];
      if (!t || typeof t !== 'object' || !Array.isArray(t.items)) return;
      const list = t.items
        .map((m) => {
          if (!m || typeof m !== 'object' || typeof m.html !== 'string') return null;
          const id = typeof m.id === 'string' && m.id ? m.id : nextMid();
          // The reply is restored beside its message, and it is snapshot input
          // like everything else here: a shape the renderers do not expect is
          // dropped rather than handed to them.
          if (m.reply && typeof m.reply === 'object' && !Array.isArray(m.reply)) replies[id] = m.reply;
          return { id: id, html: m.html };
        })
        .filter(Boolean);
      clean[k] = {
        id: String(t.id || k), label: String(t.label || k), icon: String(t.icon || 'chat'),
        items: list, updatedAt: t.updatedAt || null, seen: Number(t.seen) || 0,
      };
    });
    engine.threads = clean;
  }

  async function freeReply(text) {
    /* inFlight is set for the duration of the call so the UI can disable the send
       button. The guard itself lives in the UI click handlers (cgSend / cgDockSend /
       cardSend in main.js), not here: engine-level blocking would also block test
       harness calls that correctly send a second prompt while the first is still in
       the delay(180) terminal flash. */
    engine.inFlight = true;
    const threadId = engine.activeThreadId || 'general';
    ensureThread(threadId); engine.activeThreadId = threadId;
    // A scripted run waiting on a confirmation is not discarded just because a question
    // was typed: dropping it would strand the pending approval with no way back to it.
    if (engine.session && !engine.session.pending) engine.session = null;
    const same = () => engine.activeThreadId === threadId;
    if (!WS.store.cgDock) WS.router.go('concierge'); else if (WS.ui && WS.ui.renderCgDock) WS.ui.renderCgDock();
    await delay(60); if (!same()) return;
    pushText('me', chanIcon('text'), text, threadId);
    await delay(500); if (!same()) return;
    // The request is kept as a research signal regardless of how it is answered —
    // what brokers actually type is the most useful thing this stand collects.
    /* Запись сразу на диск: формулировка брокера — исследовательский след, а не черновик.
       Ждать чужого save() значит терять его, если вкладку закроют до следующей правки данных. */
    (WS.store.signals || (WS.store.signals = [])).push(text);
    if (WS.storeApi && WS.storeApi.save) WS.storeApi.save();
    /* What the wait is actually made of.

       Two steps and a timer said nothing about a call that can run a minute:
       the card looked the same at second two and second fifty. These steps are
       driven by events that really happen — the workspace is read, the model
       may go out to the web, the first words arrive — so the card is a report,
       not an animation. Nothing here advances on a timer.

       The counts are read from the store, so the line says what was genuinely
       handed over rather than a stock phrase. */
    const d = (WS.store && WS.store.data) || {};
    const cnt = (k, forms) => {
      const v = (d[k] || []).length;
      return v + ' ' + WS.agent.tools.plural(v, forms);
    };
    const trace = { steps: ['Разбираю запрос', 'Смотрю рабочее место', 'Формулирую ответ'], notes: [] };

    /* The line under the active step changes while the call runs — a still card
       reads as a hung one, and a minute is a long time to look at one that has
       not moved. What it must NOT become is a slideshow of invented activity:
       every line below is a true description of what was actually handed over,
       so cycling them tells the same truth in more detail rather than narrating
       work nobody is doing. The elapsed seconds are the honest pulse. */
    const LOOK = [
      () => cnt('deals', ['сделка', 'сделки', 'сделок']) + ' — суммы, стадии, сроки шагов',
      () => cnt('requests', ['запрос', 'запроса', 'запросов']) + ' — что предложено и что клиент выбрал',
      () => cnt('objects', ['объект', 'объекта', 'объектов']) + ' — цены, площади, комиссия',
      () => cnt('clients', ['контакт', 'контакта', 'контактов']) + ' и история по ним',
      () => 'срез по районам Дубая · происхождение каждой величины',
    ];
    const WEB_LOOK = [
      () => 'открываю страницы вне системы',
      () => 'сверяю, на какой момент величина',
      () => 'цена предложения и цена закрытых сделок — разные вещи',
    ];
    const started = Date.now();
    let tick = 0;
    let at = 1;
    const secs = () => { const e = Math.round((Date.now() - started) / 1000); return e > 0 ? e + ' с' : ''; };
    function note() {
      const web = trace.steps[at] === 'Ищу во внешних источниках';
      const list = web ? WEB_LOOK : LOOK;
      return list[tick % list.length]() + ' · ' + secs();
    }
    const draw = () => {
      trace.notes = [];
      trace.notes[at] = note();
      updateMsg(workMid, processCard(trace, at, false, false), threadId);
    };
    trace.notes[at] = note();
    const workMid = pushMsg(processCard(trace, at, false, false), threadId);
    // Slow enough to be read, quick enough that the card is never still.
    const beat = setInterval(() => { if (!same()) return; tick++; draw(); }, 2200);
    // The live head streams; the offline one returns at once. Both land in the
    // same message, so the card simply fills in rather than being replaced.
    let reply;
    try {
      reply = await WS.agent.askAsync(text, {
        onStage: (k) => {
          if (!same() || k !== 'web') return;
          // Only shown when it happened. A step that is always there, whether or
          // not the model went out, is back to being an animation.
          if (trace.steps.indexOf('Ищу во внешних источниках') < 0) {
            trace.steps.splice(2, 0, 'Ищу во внешних источниках');
            at = 2; tick = 0; draw();
          }
        },
        onText: (partial) => {
          if (!same() || !partial) return;
          clearInterval(beat);
          // Briefly show «Формулирую ответ» as active before the text lands, so the step
          // is never a permanent fixture of the card that is never reached.
          at = trace.steps.indexOf('Формулирую ответ');
          if (at < 0) at = trace.steps.length - 1;
          updateMsg(workMid, processCard(trace, at, false, false), threadId);
          updateMsg(workMid, msg('ai', I('sparkle') + ' Консьерж', esc(partial)), threadId);
        },
      });
    } finally {
      clearInterval(beat);
      engine.inFlight = false;
    }
    engine.inFlight = false;
    // Flash the all-done card so the progress card reads as concluded,
    // not as stuck mid-run. 180 ms is enough to register and not enough to
    // intrude. The live (streaming) path ran onText and already replaced the
    // card; updateMsg here just overwrites an already-replaced card, which is
    // safe and produces the same brief done-flash.
    updateMsg(workMid, processCard(trace, trace.steps.length, true, false), threadId);
    await delay(180);
    // The reply is written back to the thread it was asked in, whether or not
    // the agent has since walked to another one — messages are addressed, so
    // this is safe, and returning early left a «Разбираю запрос» card there
    // forever. Only the shared «last reply» state waits for the same thread.
    updateMsg(workMid, agentCard(reply, workMid), threadId);
    if (!same()) return;
    engine.lastReply = reply;
  }

  function freeReplyLegacy(text) {
    const threadId = engine.activeThreadId || 'general';
    // Wizard-of-Oz: minimal context binding (recognise a client the demo knows),
    // honest «подготовлено близкое», плашка намерений, и запись запроса как сигнала.
    const lc = (text || '').toLowerCase();
    const known = (WS.store.data.clients || []).find((c) => lc.indexOf((c.name || '').split(' ')[0].toLowerCase()) >= 0);
    const ctx = known ? ' По <b>' + known.name + '</b> контекст подхватил.' : '';
    // log the free request as a research signal (what brokers actually ask)
    /* Запись сразу на диск: формулировка брокера — исследовательский след, а не черновик.
       Ждать чужого save() значит терять его, если вкладку закроют до следующей правки данных. */
    (WS.store.signals || (WS.store.signals = [])).push(text);
    if (WS.storeApi && WS.storeApi.save) WS.storeApi.save();
    updateMsg(workMid, msg('ai', I('sparkle') + ' Консьерж',
      'Понял поручение.' + ctx + ' Подготовлены близкие результаты — выберите, что собрать (демо, Wizard-of-Oz):' +
      '<div class="qa-row" style="margin-top:10px">' +
      (known ? '<button class="chip" data-scn="S8">' + I('sparkle') + 'Подготовить к встрече</button>' +
               '<button class="chip" data-scn="G2">' + I('building') + 'Подобрать / собрать материалы</button>' +
               '<button class="chip" data-scn="S3">' + I('calendar') + 'Запланировать показ</button>'
             : '<button class="chip" data-scn="G1">' + I('mic') + 'Разобрать входящее</button>' +
               '<button class="chip" data-scn="G2">' + I('building') + 'Подобрать объект</button>' +
               '<button class="chip" data-scn="S15">' + I('flame') + 'Ответить лиду</button>') +
      '</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-top:8px">' + (WS.events ? WS.events.SIM : 'симуляция') + ' · ваш запрос сохранён как сигнал для доработки.</div>'), threadId);
  }


  // ---------- agent replies ----------
  // Every reply the Concierge gives is one of these four shapes. Numbers arrive
  // with the query that produced them, so a figure can be opened; anything that
  // writes arrives as a proposal with the change spelled out, never as a fait
  // accompli; and an action we cannot actually perform arrives as the artifact
  // itself, labelled, rather than as an apology.
  // A chip belongs to the message it sits under, not to whatever answered last.
  // Addressed by index into a global, an older card's «откуда это число» opened
  // the newest reply's rows — and a reply landing after the agent switched
  // threads made that reachable in one click.
  const replies = {};
  let chipMid = null;
  // An addressed key resolves to its own reply or to nothing. Falling through
  // to «whatever answered last» is how a chip under an old card opened the
  // newest answer's rows; the fallback is only for keys from before chips
  // carried an address at all.
  // Callers address a reply three ways: «m12:3» from a chip, a bare «m12» from
  // the listen button and from history, and a bare index from a snapshot taken
  // before chips carried an address. Only the last of those may fall through to
  // whatever answered most recently.
  function replyFor(key) {
    const s = String(key == null ? '' : key);
    const mid = s.indexOf(':') >= 0 ? s.split(':')[0] : (/^\d*$/.test(s) ? '' : s);
    if (mid) return replies[mid] || null;
    return engine.lastReply || null;
  }
  function chipIndex(key) { return Number(String(key || '').split(':').pop()); }
  function chipKey(i) { return (chipMid ? chipMid + ':' : '') + i; }

  function evChips(ev) {
    if (!ev || !ev.length) return '';
    return '<div class="ev-cap">' + I('source') + 'откуда это число</div>' +
      '<div class="qa-row" style="margin-top:5px">' + ev.map((e, i) =>
      '<button class="chip src" data-agev="' + chipKey(i) + '" title="показать записи, из которых это посчитано">' +
      (e.money ? WS.AED(e.value) : e.value) + ' ' + esc(e.label) + '</button>').join('') + '</div>';
  }
  function nextChips(next) {
    if (!next || !next.length) return '';
    return '<div class="qa-row" style="margin-top:11px">' + next.map((n, i) =>
      '<button class="chip" data-agnext="' + chipKey(i) + '">' + I(n.open ? 'users' : 'sparkle') + esc(n.label) + '</button>').join('') + '</div>';
  }
  // Russian prints a decimal comma, and no gap before a percent sign.
  function anVal(v, suffix) {
    const s = String(v == null ? '' : v).replace('.', ',');
    const suf = String(suffix || '');
    if (!suf) return s;
    return suf === '%' ? s + suf : s + '\u00a0' + suf;
  }

  // An analytical answer is a shape, not a wall of prose. The model names the
  // shape; the markup is built here, so nothing it returns can be markup.
  // Where the figures in a block came from. Built by the code from a query, it
  // says so quietly; typed by the model, it says that too — the same answer
  // should not present both kinds as if they were one thing.
  function srcNote(b) {
    const t = String(b && b.t);
    if (t !== 'table' && t !== 'bars' && t !== 'kv') return '';
    // Brought back from outside: no query owns it, so the source and the date
    // are what stand in for one. Deliberately not the green «из данных» mark —
    // the two must never read as the same kind of figure.
    if (b.src === 'web') {
      return '<div class="an-src web">' + I('globe') + 'из внешнего источника · ' + esc(b.source) +
        (b.asOf ? ' · ' + esc(b.asOf) : '') + '</div>';
    }
    if (b.src === 'data') {
      // The block was built at a revision. Scrolling back to it an hour later,
      // after a stage moved and a deal was added, the rows are still the old
      // ones — true when they were drawn, and quietly wrong now unless the
      // card says which moment it is showing.
      const now = WS.store && WS.store.dataRevision;
      const moved = b.revision != null && now != null && b.revision !== now;
      return '<div class="an-src ok">' + I('source') + 'из данных' +
        (b.count ? ' · ' + b.count + ' ' + plural(b.count, ['запись', 'записи', 'записей']) : '') +
        (moved ? '<span class="moved">· данные с тех пор менялись</span>' : '') + '</div>';
    }
    return '<div class="an-src">' + I('warn') + 'собрано моделью, не сверено с данными</div>';
  }
  function plural(n, forms) {
    const a = Math.abs(n) % 100; const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function blocksHtml(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return '';
    const out = blocks.map((b) => {
      if (!b || typeof b !== 'object') return '';
      const t = String(b.t || '');
      if (t === 'p') return '<p class="an-p">' + esc(b.text) + '</p>';
      if (t === 'h') return '<div class="an-h">' + esc(b.text) + '</div>';
      if (t === 'note') return '<div class="an-note">' + I('shield') + '<span>' + esc(b.text) + '</span></div>';
      if (t === 'list') {
        const li = (Array.isArray(b.items) ? b.items : []).slice(0, 8).map((x) => '<li>' + esc(x) + '</li>').join('');
        return li ? '<ul class="an-list">' + li + '</ul>' : '';
      }
      if (t === 'kv') {
        const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 8).map((x) =>
          '<div class="an-kv"><span class="k">' + esc(x && x.k) + '</span><span class="v">' + esc(x && x.v) + '</span></div>').join('');
        return rows ? '<div class="an-kvs">' + rows + '</div>' + srcNote(b) : '';
      }
      if (t === 'table') {
        const head = (Array.isArray(b.head) ? b.head : []).slice(0, 5);
        const body = (Array.isArray(b.rows) ? b.rows : []).slice(0, 8)
          .map((row) => '<tr>' + (Array.isArray(row) ? row : []).slice(0, 5).map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
        if (!body) return '';
        return '<div class="an-tw"><table class="an-t">' +
          (head.length ? '<thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead>' : '') +
          '<tbody>' + body + '</tbody></table></div>' + srcNote(b);
      }
      if (t === 'bars') {
        const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 6).filter((x) => x && isFinite(Number(x.value)));
        if (!rows.length) return '';
        const max = Math.max.apply(null, rows.map((x) => Math.abs(Number(x.value)))) || 1;
        return '<div class="an-bars">' + rows.map((x) => {
          const w = Math.max(3, Math.round(Math.abs(Number(x.value)) / max * 100));
          return '<div class="an-bar"><span class="bl">' + esc(x.label) + '</span>' +
            '<span class="bt"><i style="width:' + w + '%"></i></span>' +
            '<span class="bv">' + esc(anVal(x.value, x.suffix)) + '</span></div>';
        }).join('') + '</div>' + srcNote(b);
      }
      return '';
    }).join('');
    return out ? '<div class="an">' + out + '</div>' : '';
  }

  // The file is offered, never pushed: a download that starts by itself in a
  // demo reads as something going wrong.
  /* Why the document is in the language it is in, in the words a broker would
     use about it. The reason travels as an id from the server; spelling it out
     is this side's job, and it matters that the sentence names WHOSE account
     the choice is on — «на английском» alone reads as the Concierge deciding
     for itself, which is the thing that went wrong. */
  const DOC_LANG_RU = { ru: 'на русском', en: 'на английском', ar: 'на арабском' };
  const DOC_WHY_RU = {
    asked: 'вы попросили',
    setting: 'так в настройках',
    contact: 'так читает получатель',
    market: 'язык получателя не записан',
    broker: 'документ для вас',
  };
  function reportCard(rp) {
    if (!rp) return '';
    const lang = rp.lang ? ' · ' + (DOC_LANG_RU[rp.lang] || rp.lang) +
      (DOC_WHY_RU[rp.why] ? ', ' + DOC_WHY_RU[rp.why] : '') : '';
    return '<div class="rp"><div class="rp-i">' + I('doc') + '</div>' +
      '<div class="rp-t"><b>' + esc(rp.title) + '</b><span>' + esc(rp.name) + ' · ' +
      rp.count + ' блоков' + esc(lang) + '</span></div>' +
      '<div class="rp-a"><button class="btn sm" data-rpopen="' + esc(rp.id) + '">Открыть</button>' +
      '<button class="btn sm primary" data-rpsave="' + esc(rp.id) + '">' + I('download') + 'Скачать</button></div></div>';
  }

  // Offered, never automatic — and only where the browser can actually speak,
  // so nobody presses a button that was never going to do anything. Carries its
  // own message id: an answer from ten minutes ago must not read out the latest.
  function sayBtn(r, mid) {
    if (!WS.voice || !WS.voice.canSpeak() || !WS.voice.spokenText(r)) return '';
    return '<div class="qa-row" style="margin-top:9px">' +
      '<button class="chip say" data-agsay="' + esc(mid || '') + '" title="Зачитать ответ вслух">' +
      I('voice2') + '<span class="lb">Прослушать</span></button></div>';
  }

  /* Which setting produced this answer, as the server resolved it. Shown only
     when the person moved something off the default — otherwise it is noise on
     every reply. It reads back what actually ran: the mode pill is a real
     instruction now, and an answer scrolled back to a day later should not
     leave you guessing which one it was given. */
  function modeNote(r) {
    if (!r || !WS.ui || !WS.ui.cgModeLabel) return '';
    const m = r.mode && r.mode !== 'auto' ? WS.ui.cgModeLabel(r.mode) : '';
    const d = r.depth && r.depth !== 'think' ? WS.ui.cgDepthLabel(r.depth) : '';
    const parts = [m, d].filter(Boolean);
    return parts.length ? '<div class="an-mode">' + I('sparkle') + parts.join(' · ') + '</div>' : '';
  }

  function answerCard(r, mid) {
    chipMid = mid || null;
    if (mid) replies[mid] = r;
    // The note is appended after, never folded into `body`: `body` decides
    // whether the prose is a lead paragraph or the whole answer, and a mode
    // note would have quietly made every plain reply a lead.
    const body = blocksHtml(r.blocks) + reportCard(r.report);
    // The prose is the fallback: with no shape declared, it is the whole answer.
    const head = body ? (r.text ? '<p class="an-lead">' + esc(r.text) + '</p>' : '') : esc(r.text);
    return msg('ai', I('sparkle') + ' Консьерж',
      head + body + modeNote(r) + sayBtn(r, mid) + evChips(r.evidence) + nextChips(r.next));
  }
  function proposalCard(p) {
    const lines = (p.lines || []).map((l) =>
      '<div class="field"><div class="k">Изменение</div><div class="v"><span class="now">' + esc(l) + '</span></div></div>').join('');
    const badge = p.tier === 'guarded'
      ? '<span class="lvl-tag a3 lvl">нужно подтверждение</span>'
      : '<span class="lvl-tag a1 lvl">безопасное</span>';
    // The live head says something before it proposes; the offline one does not.
    const said = p.text ? '<div style="margin:0 0 9px;line-height:1.5">' + esc(p.text) + '</div>' : '';
    /* What the new card still needs, on the card that asks to confirm it.
       A record is opened from one field and that is deliberate — a form is
       where a conversation stops. But «завёл» with nothing else said leaves the
       broker to discover a week later that the request has no budget and no
       district, which is the same gap arriving later and more expensively.
       The list is the store's, computed from the record, so it cannot drift
       from what the card itself calls «Ключевые условия». */
    const gaps = (p.missing || []).length
      ? '<div class="pb">' + (p.missing || []).map((m) =>
        '<div class="field"><div class="k">Дозаполнить</div><div class="v"><span class="now">' +
        esc(m) + '</span></div></div>').join('') + '</div>'
      : '';
    return '<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('sparkle') + ' Консьерж · предложение</div>' +
      said +
      '<div class="preview"><div class="ph"><div class="icon-tile i-acc">' + I('layers') + '</div>' +
      '<div class="t">' + esc(p.title) +
      // Asked for while reading an analysis: the card says so, so a change made
      // from that posture is not mistaken for the analysis proposing it.
      (p.askedIn ? '<span class="pmode">' + I('sparkle') + 'запрошено вами · ' + esc(p.askedIn) + '</span>' : '') +
      '</div>' + badge + '</div>' +
      '<div class="pb">' + lines + '</div>' + gaps +
      '<div class="approval"><div class="note">' + I('shield') + '<span>' + esc(p.note) + '</span></div>' +
      '<div class="acts"><button class="btn sm ghost" data-agcancel="' + p.id + '">Отмена</button>' +
      '<button class="btn primary cta-hint" data-agok="' + p.id + '">' + I('check') + 'Подтвердить</button></div>' +
      '</div></div>' + nextChips(p.next) + '</div>';
  }
  function draftCard(r) {
    const a = r.artifact || {};
    return '<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('sparkle') + ' Консьерж · черновик</div>' +
      '<div class="card pad"><div style="font-weight:650;color:var(--ink)">' + esc(a.title || 'Черновик') + '</div>' +
      '<div style="margin-top:8px;white-space:pre-wrap;font-size:13px;line-height:1.55;color:var(--ink-2)">' + esc(a.body || '') + '</div>' +
      '<div class="prov" style="margin-top:10px"><span class="badge demo">' + I('lock') + esc(a.note || '') + '</span></div>' +
      nextChips(r.next) + '</div></div>';
  }
  // The message id travels with the reply so the chips under it stay bound to
  // it — the whole point of addressing them was lost if this dropped it.
  function agentCard(r, mid) {
    if (!r) return msg('ai', I('sparkle') + ' Консьерж', 'Слушаю.');
    chipMid = mid || null;
    if (mid) replies[mid] = r;
    if (r.kind === 'proposal') return proposalCard(r);
    if (r.kind === 'draft') return draftCard(r);
    if (r.kind === 'error') return msg('ai', I('warn') + ' Консьерж', esc(r.text) + nextChips(r.next));
    return answerCard(r, mid);
  }

  /* Как открыть то, что было заведено. Ключ — коллекция, значение — атрибут, который уже
     умеет открывать карточку в общем обработчике кликов. Коллекция без карточки (задачи,
     события) ведёт на свой экран, а не в никуда: молчащая кнопка хуже отсутствующей. */
  const OPEN_CREATED = {
    deals: (id) => 'data-deal="' + id + '"', requests: (id) => 'data-request="' + id + '"',
    clients: (id) => 'data-client="' + id + '"', companies: (id) => 'data-company="' + id + '"',
    objects: (id) => 'data-obj="' + id + '"', tasks: () => 'data-nav="tasks"',
  };
  const CREATED_RU = { deals: 'сделку', requests: 'запрос', clients: 'контакт',
    companies: 'компанию', objects: 'объект', tasks: 'задачи' };
  function openCreatedBtn(created) {
    const first = (created || []).filter((c) => c && OPEN_CREATED[c.coll])[0];
    if (!first) return '';
    return '<button class="btn sm primary" ' + OPEN_CREATED[first.coll](first.id) + '>' +
      I('arrowRight') + 'Открыть ' + (CREATED_RU[first.coll] || 'запись') + '</button>';
  }
  function agentConfirm(id) {
    const p = WS.agent.pendingProposal(id);
    const res = WS.agent.confirm(id);
    if (res.ok) {
      /* Что осталось дозаполнить — на карточке, которая это сделала, и КНОПКОЙ. Раньше это была
         строка текста: агент читал «не заполнены: бюджет, район», нажимал на неё и ничего не
         происходило — открывать было нечего, потому что ссылки не было вовсе. */
      const open = openCreatedBtn(res.created);
      const gaps = (p && p.missing || []).length
        ? '<div style="margin-top:9px;font-size:12px;color:var(--mut)">' + I('warn') +
          ' ' + ((p && p.missing) || []).map(esc).join('<br>') + '</div>'
        : '';
      const acts = open ? '<div class="qa-row" style="margin-top:10px">' + open + '</div>' : '';
      pushMsg('<div class="msg ai fadeup" style="max-width:100%"><div class="who">' + I('checkCircle') + ' Применено</div>' +
        '<div class="card pad" style="border-color:var(--ok-line)"><span class="badge ok">' + I('check') + esc((p && p.title) || 'Изменение') + '</span>' +
        '<div style="margin-top:7px;font-size:12px;color:var(--mut)">' + ((p && p.lines) || []).map(esc).join('<br>') + '</div>' +
        gaps + acts + '</div></div>');
      WS.storeApi.toast('Применено', 'ok');
      WS.storeApi.logEvent({ scenario: 'agent', action: (p && p.title) || 'изменение', result: 'EXECUTED', level: p && p.tier === 'guarded' ? 'A3' : 'A1' });
    } else {
      const why = res.code === 'stale' ? 'данные изменились с момента предложения — спросите ещё раз, соберу заново'
        : res.code === 'used' ? 'это предложение уже применено'
        : (res.error || 'применить не вышло');
      pushMsg('<div class="msg ai fadeup"><div class="who">' + I('warn') + ' Не применил</div>' +
        '<div class="card pad" style="border-color:var(--stop-line)"><span class="badge warn">' + I('warn') + esc(why) + '</span></div></div>');
    }
  }
  // A card left over from a previous session points at a document that no
  // longer exists. Saying so is the whole fix: silence looked like a dead button.
  const GONE = 'Файл собран в прошлой сессии — попросите собрать заново';
  function reportOpen(id) {
    if (!WS.report || !WS.report.get(id)) return WS.storeApi.toast(GONE);
    WS.report.openTab(id);
  }
  function reportSave(id) {
    if (!WS.report || !WS.report.get(id)) return WS.storeApi.toast(GONE);
    if (WS.report.download(id)) WS.storeApi.toast('Отчёт сохранён', 'ok');
  }
  function agentCancel() {
    pushMsg(msg('ai', I('sparkle') + ' Консьерж', 'Отменил. Ничего не записано.'));
  }
  // Screens the Concierge may open on its own. A whitelist rather than
  // whatever string came back, so a wrong guess is ignored instead of
  // navigating the stand somewhere that does not render.
  // Kept level with the navigation: the stand grew Заявки, Лиды, Показы,
  // Партнёры, Команда, Услуги, Согласования, and a whitelist frozen at the old
  // set quietly meant the Concierge could not offer to open the screen the
  // whole funnel now runs through.
  const OPENABLE = ['start', 'concierge', 'clients', 'companies', 'objects', 'requests', 'leads',
    'calc', 'valuation', 'finance', 'tasks', 'shows', 'docs', 'analytics', 'club', 'partners',
    'team', 'services', 'approvals', 'promotion', 'profile', 'settings'];
  function navigateTo(o) {
    if (!o) return;
    const v = String(o.view || '');
    if (v === 'contact' && o.id) return WS.ui.clientCard(o.id);
    if (v === 'company' && o.id) return WS.ui.companyCard(o.id);
    if (v === 'deal' && o.id) return WS.ui.dealCard(o.id);
    if (v === 'request' && o.id) return WS.ui.requestCard(o.id);
    if (OPENABLE.indexOf(v) >= 0) return WS.router.go(v);
  }

  // Chips under a reply: either another question, or a card to open.
  const LOST = 'Этот ответ из прошлой сессии — спросите ещё раз, соберу заново';
  function agentNext(key) {
    const r = replyFor(key);
    if (!r) return WS.storeApi.toast(LOST);
    const n = r.next && r.next[chipIndex(key)];
    if (!n) return;
    if (n.ask) return freeReply(n.ask);
    if (n.open) return navigateTo({ view: n.open, id: n.id });
  }

  function restartScene() {
    const s = engine.session; if (!s || !s.scenarioId) return;
    const id = s.scenarioId;
    const chainId = WS.store.tour.chainId;
    WS.storeApi.resetScene(id);
    startScenario(id, chainId);
  }

  WS.engine = { startScenario, startChain, restartScene, advance, handle, mount, reset, freeReply, inFlight: false,
    pushMsg, updateMsg, pushText, escape: esc,
    agentConfirm, agentCancel, agentNext, agentCard, reportOpen, reportSave, replyFor,
    // Readable and settable: it is conversation state, and the deterministic
    // head now consults it to tell a reply-to-our-question from a new query.
    // A getter alone meant a test could not set up that situation at all.
    get lastReply() { return engine.lastReply; },
    set lastReply(v) { engine.lastReply = v; },
    openThread, bindThread, closeThread, endSessionForScene, threadList, activeThread, markSeen, seedThreads,
    pushEvent, aiMsg, exportThreads, importThreads,
    pendingAction, setPendingAction, clearPendingAction,
    activeThreadId: () => engine.activeThreadId,
    session: () => engine.session, financeCard, shortlistCard };
})(window.WS = window.WS || {});
