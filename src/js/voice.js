/* ============================================================
   Voice — dictation into the composer, and a reply said out loud.

   Both halves are the browser's own: SpeechRecognition for the microphone,
   speechSynthesis for the answer. Neither is available everywhere, so every
   entry point checks at the moment it is used rather than at load — a stand
   that hides the microphone on one browser and pretends on another is worse
   than one that says plainly what it can do.

   Two rules shape everything here:

   Dictation writes into the live input node, never through a re-render. The
   composer is rebuilt on almost any state change, and a rebuild mid-sentence
   throws away both the text and the node the recogniser is writing to.

   Speaking is offered, never automatic. A demo that starts talking by itself
   in a meeting room is a demo someone reaches to mute. The reply carries its
   own spoken form — one or two sentences, not the table read aloud.
   ============================================================ */
(function (WS) {
  const st = {
    rec: null, on: false, elId: null, el: null, base: '', final: '', lastError: null,
    saying: null,
  };

  // Looked up per call, not captured at load: a test installs its own, and a
  // browser can have the prefixed one only.
  function RecCtor() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }
  function synth() { return (typeof window !== 'undefined' && window.speechSynthesis) || null; }
  function UtterCtor() { return (typeof window !== 'undefined' && window.SpeechSynthesisUtterance) || null; }

  function canDictate() { return !!RecCtor(); }
  function canSpeak() { return !!(synth() && UtterCtor()); }
  function dictating() { return st.on; }
  function speaking() { return st.saying; }

  function toast(m, k) { if (WS.storeApi && WS.storeApi.toast) WS.storeApi.toast(m, k); }

  // ---------- dictation ----------

  // The composer is re-rendered on almost any state change, which detaches the
  // node we were writing into. If it had an id we find the replacement; if it
  // is simply gone, dictation stops rather than typing into nothing.
  function target() {
    if (st.el && (!st.el.ownerDocument || st.el.ownerDocument.contains(st.el))) return st.el;
    const next = st.elId && typeof document !== 'undefined' ? document.getElementById(st.elId) : null;
    if (next) { st.el = next; return next; }
    return null;
  }

  function write(interim) {
    const el = target();
    if (!el) return stop();
    const parts = [st.base, st.final, interim].map((s) => String(s || '').trim()).filter(Boolean);
    el.value = parts.join(' ');
  }

  // The recording state is painted straight onto the buttons. Going through a
  // re-render would replace the input the recogniser is filling.
  function paint() {
    if (typeof document === 'undefined') return;
    const list = document.querySelectorAll('[data-act="voice"]');
    Array.prototype.forEach.call(list, (b) => {
      b.classList.toggle('rec', st.on);
      b.setAttribute('aria-pressed', st.on ? 'true' : 'false');
      b.setAttribute('title', st.on ? 'Остановить запись' : 'Голосом');
    });
  }

  function stop() {
    const r = st.rec;
    st.rec = null; st.on = false;
    if (r) { try { r.stop(); } catch (e) { /* already stopped */ } }
    paint();
    return true;
  }

  // Toggle: a second press ends the recording. `el` is the input the words go
  // into — resolved from the composer the button sits in, so the same control
  // works on Пульс, in the Concierge and in the dock.
  function dictate(el) {
    if (st.on) return stop();
    const R = RecCtor();
    if (!R || !el) {
      toast('Диктовка недоступна в этом браузере — наберите текстом');
      return false;
    }
    // The microphone would otherwise pick up the answer being spoken.
    stopSpeech();

    let rec;
    try { rec = new R(); } catch (e) { toast('Микрофон недоступен — наберите текстом'); return false; }
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    st.rec = rec; st.on = true; st.el = el; st.elId = el.id || null;
    st.base = String(el.value || '').trim(); st.final = ''; st.lastError = null;

    rec.onresult = (e) => {
      const res = (e && e.results) || [];
      let interim = '';
      for (let i = (e && e.resultIndex) || 0; i < res.length; i++) {
        const alt = res[i] && res[i][0];
        const txt = (alt && alt.transcript) || '';
        if (res[i] && res[i].isFinal) st.final = (st.final ? st.final + ' ' : '') + txt.trim();
        else interim += txt;
      }
      write(interim);
    };
    rec.onerror = (e) => {
      st.lastError = (e && e.error) || 'error';
      // Inform on hard failures; give a soft hint on silence so the broker
      // knows the mic actually ran and just heard nothing.
      if (st.lastError === 'not-allowed' || st.lastError === 'service-not-allowed') {
        toast('Браузер не дал доступ к микрофону — наберите текстом');
      } else if (st.lastError === 'audio-capture') {
        toast('Микрофон не найден — наберите текстом');
      } else if (st.lastError === 'no-speech') {
        toast('Ничего не услышал — попробуйте ещё раз');
      }
      stop();
    };
    rec.onend = () => {
      st.rec = null; st.on = false; paint();
      const el2 = target();
      if (el2 && el2.focus) el2.focus();
    };

    try { rec.start(); } catch (e) {
      st.rec = null; st.on = false;
      toast('Не удалось включить микрофон — наберите текстом');
      return false;
    }
    paint();
    return true;
  }

  // ---------- what a reply sounds like ----------

  // Read aloud, a table is noise. The live head returns its own spoken form;
  // when there is none — an offline reply, or a model that skipped the field —
  // the prose is used, and failing that the first blocks that are actually
  // sentences. Bars and tables are never spoken.
  const SPEAKABLE = { p: 1, note: 1, list: 1 };
  function spokenText(r) {
    if (!r || typeof r !== 'object') return '';
    const said = typeof r.speak === 'string' ? r.speak.replace(/\s+/g, ' ').trim() : '';
    if (said) return said.slice(0, 600);
    let out = String(r.text || '').replace(/\s+/g, ' ').trim();
    if (!out) {
      const parts = [];
      (Array.isArray(r.blocks) ? r.blocks : []).forEach((b) => {
        if (!b || parts.length >= 2 || !SPEAKABLE[String(b.t)]) return;
        if (b.t === 'list') {
          const items = (Array.isArray(b.items) ? b.items : []).slice(0, 3).map((x) => String(x).trim()).filter(Boolean);
          if (items.length) parts.push(items.join('. '));
        } else if (b.text) parts.push(String(b.text).trim());
      });
      out = parts.join(' ');
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, 600);
  }

  // ---------- speaking ----------

  function paintSay() {
    if (typeof document === 'undefined') return;
    const list = document.querySelectorAll('[data-agsay]');
    Array.prototype.forEach.call(list, (b) => {
      const on = st.saying != null && b.getAttribute('data-agsay') === st.saying;
      b.classList.toggle('on', on);
      const lb = b.querySelector('.lb');
      if (lb) lb.textContent = on ? 'Остановить' : 'Прослушать';
    });
  }

  function stopSpeech() {
    const s = synth();
    st.saying = null;
    if (s && s.cancel) { try { s.cancel(); } catch (e) { /* nothing to cancel */ } }
    paintSay();
  }

  // Chrome cuts a single utterance off at about fifteen seconds — mid-sentence,
  // silently. Two or three Russian sentences sit right on that edge, so the
  // text is queued as short utterances instead of one long one.
  const CHUNK = 170;
  function chunks(text) {
    const parts = String(text).split(/(?<=[.!?…])\s+/);
    const out = [];
    parts.forEach((p) => {
      let s = p.trim();
      if (!s) return;
      if (out.length && (out[out.length - 1] + ' ' + s).length <= CHUNK) {
        out[out.length - 1] += ' ' + s;
        return;
      }
      while (s.length > CHUNK) {
        // No sentence end within reach — break on a word instead of a letter.
        let cut = s.lastIndexOf(' ', CHUNK);
        if (cut < CHUNK / 2) cut = CHUNK;
        out.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
      }
      if (s) out.push(s);
    });
    return out.length ? out : [String(text)];
  }

  /* Что синтезатор читает неправильно, если дать ему экранный текст как есть.

     Intl в ru-RU группирует разряды неразрывным пробелом: «20 228 000». Голос видит
     три разных числа и читает «двадцать — двести двадцать восемь — ноль» вместо
     «двадцать миллионов двести двадцать восемь тысяч». Склеиваем группы обратно.
     «AED» тот же голос читает по буквам — подставляем русское слово в нужном числе. */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function forSpeech(text) {
    let t = String(text || '');
    // Склеить разряды: «20 228 000» → «20228000» (обычный и неразрывный пробел, узкий неразрывный).
    for (let i = 0; i < 4; i++) t = t.replace(/(\d)[\u00a0\u202f ](\d{3})\b/g, '$1$2');
    // Валюта словом, в согласии с числом перед ней.
    t = t.replace(/(\d+)\s*AED\b/gi, (m, n) => n + ' ' + plural(+n, 'дирхам', 'дирхама', 'дирхамов'));
    t = t.replace(/\bAED\b/gi, 'дирхамов');
    // Единицы, которые иначе читаются символами.
    t = t.replace(/(\d)\s*м²/g, '$1 квадратных метров');
    t = t.replace(/(\d)\s*%/g, '$1 процентов');
    return t;
  }

  function say(text, key) {
    const s = synth(); const U = UtterCtor();
    const t = forSpeech(text).trim();
    if (!s || !U || !t) return false;
    try { s.cancel(); } catch (e) { /* nothing to cancel */ }

    // A Russian voice if the system has one; otherwise the default reads
    // Cyrillic as gibberish, which is worse than the browser's own choice.
    let ru = null;
    try {
      const voices = (s.getVoices && s.getVoices()) || [];
      ru = voices.filter((v) => /^ru/i.test((v && v.lang) || ''))[0] || null;
    } catch (e) { /* voice list not ready — the default will do */ }

    const done = () => { st.saying = null; paintSay(); };
    const list = chunks(t);
    st.saying = key == null ? '' : String(key);
    for (let i = 0; i < list.length; i++) {
      let u;
      try { u = new U(list[i]); } catch (e) { done(); return false; }
      u.lang = 'ru-RU';
      u.rate = 1.03;
      if (ru) u.voice = ru;
      // Only the last one releases the button; an error anywhere ends it.
      if (i === list.length - 1) u.onend = done;
      u.onerror = done;
      try { s.speak(u); } catch (e) { done(); return false; }
    }
    paintSay();
    return true;
  }

  // The button under a message speaks THAT message. Same addressing as the
  // evidence chips: a card from ten minutes ago must not read out the latest
  // answer.
  function sayReply(key) {
    const k = key == null ? '' : String(key);
    if (st.saying === k) return stopSpeech();
    const r = WS.engine && WS.engine.replyFor ? WS.engine.replyFor(k) : null;
    const t = spokenText(r);
    if (!t) return toast('Здесь нечего зачитывать');
    if (!say(t, k)) toast('Озвучка недоступна в этом браузере');
  }

  // Leaving the page with the Concierge still talking is the kind of thing a
  // browser keeps doing after the tab is gone.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', () => { stop(); stopSpeech(); });
  }

  WS.voice = { canDictate, canSpeak, dictate, stop, dictating, spokenText, say, sayReply, stopSpeech, speaking, forSpeech,
    get lastError() { return st.lastError; } };
})(window.WS = window.WS || {});
