/* ProbQuest user interface.  All learning logic lives in engine.js; question content in data/qbank.js */
(function () {
  'use strict';
  const D = window.PQ_DATA, E = window.PQ_ENGINE, T = window.PQ_TEX.tex;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pct = x => Math.round(x * 100) + '%';

  /* ---------- storage (fall back to memory when the browser blocks localStorage) ---------- */
  let storage, persistent = true;
  try { localStorage.setItem('pq.probe', '1'); localStorage.removeItem('pq.probe'); storage = localStorage; }
  catch (e) { persistent = false; const m = {}; storage = { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; } }; }
  /* optional extra question pack (window.PQ_EXTRA): validated; invalid questions are skipped, never shown */
  if (window.PQ_EXTRA) { try { const r = E.mergePacks(D, window.PQ_EXTRA); if (r.rejected.length && window.console) console.warn('ProbQuest: skipped ' + r.rejected.length + ' invalid extra question(s)', r.rejected); } catch (e) { /* ignore a malformed pack */ } }
  const eng = E.create(D, storage);
  const TOPIC = {}; D.topics.forEach(t => { TOPIC[t.id] = t; });
  const LETTERS = 'ABCDEFGH';
  const HINT_LABEL = ['Recognise', 'Formulate', 'Work it out'];
  const PER_Q_SECONDS = { 1: 60, 2: 100, 3: 150 };

  /* ---------- UI state ---------- */
  const V = { screen: 'home', lib: { topic: '', diff: '', src: '', status: '', text: '', open: null, shown: 40 }, cfg: { chN: 10, chTimed: false, chScope: '', exN: 10, exTimed: true } };
  let SES = null, QS = null, EX = null, tick = null, lastRank = eng.rank().name;

  const main = $('#main');
  function clearTick() { if (tick) { clearInterval(tick); tick = null; } }
  function toast(msg) {
    const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = msg;
    document.body.appendChild(d); setTimeout(() => d.remove(), 3600);
  }
  function modal(html) {
    closeModal();
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div>' + html + '</div>'; document.body.appendChild(m);
    const b = m.querySelector('button'); if (b) b.focus();
  }
  function closeModal() { const m = $('#modal'); if (m) m.remove(); }
  function confirmModal(title, text, okLabel, act, arg) {
    modal(`<h3>${esc(title)}</h3><p>${text}</p><div class="row" style="margin-top:16px"><button class="btn ghost" data-act="close">Cancel</button><span class="sp"></span><button class="btn pri" data-act="${act}" data-arg="${esc(arg || '')}">${esc(okLabel)}</button></div>`);
  }

  /* ---------- helpers ---------- */
  const diffChip = d => `<span class="chip f${d}">${E.DIFF_NAME[d]}</span>`;
  function topicShort(id) { return TOPIC[id].short; }
  function stemHTML(q) { return `<div class="stem">${T(q.stem)}${q.data ? T(q.data) : ''}</div>`; }
  function levelClass(l) { return l === 'Mastered' ? 'mas' : l === 'Proficient' ? 'pro' : ''; }
  function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function ago(ts) {
    const d = ts - Date.now();
    if (d <= 0) return 'now';
    const h = d / 36e5; if (h < 20) return 'in ' + Math.max(1, Math.round(h)) + ' h';
    return 'in ' + Math.round(h / 24) + ' d';
  }
  function guard(fn) { try { fn(); } catch (e) { console.error(e); main.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="mut">${esc(e.message)}</p><button class="btn pri" data-act="go" data-arg="home">Return to home</button></div>`; } }

  /* ---------- navigation ---------- */
  const NAV = [
    ['home', 'Home'], ['learn', 'Learn'], ['challenge', 'Challenge'], ['exam', 'Exam'], ['weakness', 'Weakness practice'],
    ['revision', 'Revision'], ['daily', 'Daily challenge'], ['sep'], ['library', 'Question library'], ['progress', 'Progress'], ['about', 'How it works']
  ];
  function renderNav() {
    const due = eng.dueList().length;
    $('#nav').innerHTML = NAV.map(n => n[0] === 'sep' ? '<div class="sep"></div>'
      : `<button data-act="go" data-arg="${n[0]}" ${V.screen === n[0] || (V.screen === 'play' && SES && SES.navKey === n[0]) ? 'aria-current="page"' : ''}>${n[1]}${n[0] === 'revision' && due ? `<span class="badge">${due}</span>` : ''}${n[0] === 'daily' && !eng.dailyStatus() ? '<span class="badge">new</span>' : ''}</button>`).join('');
    const th = storage.getItem('probquest.theme') || 'auto';
    $('#sidefoot').innerHTML = `<p>${persistent ? 'Progress is stored in <b>this browser on this device only</b>. There is no account and no sync.' : '<b>Browser storage is blocked</b>: progress will be lost when you close this page.'}</p><button class="btn sm ghost" data-act="theme">Theme: ${th}</button>`;
  }
  function go(screen, arg) {
    clearTick(); closeModal();
    V.screen = screen;
    render(); window.scrollTo(0, 0);
    const h = main.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  function render() {
    renderNav();
    guard(() => {
      switch (V.screen) {
        case 'home': return viewHome();
        case 'learn': return viewLearn();
        case 'challenge': return viewChallenge();
        case 'exam': return viewExam();
        case 'weakness': return viewWeakness();
        case 'revision': return viewRevision();
        case 'daily': return viewDaily();
        case 'library': return viewLibrary();
        case 'progress': return viewProgress();
        case 'about': return viewAbout();
        case 'play': return viewPlay();
        case 'result': return viewResult();
        case 'examrun': return viewExamRun();
        case 'examresult': return viewExamResult();
      }
    });
  }
  function header(title, sub, extra) {
    const r = eng.rank();
    return `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${extra === false ? '' : `<div class="rank" title="Experience points are earned from demonstrated understanding, not speed"><div><div class="kicker">Standing</div><b>${esc(r.name)}</b></div><div><div class="meter"><i style="width:${Math.round(r.pct * 100)}%"></i></div><div class="small mut">${r.xp} XP${r.next ? ' · ' + (r.need - r.xp) + ' to ' + esc(r.next) : ''}</div></div></div>`}</div>`;
  }
  function persistNote() {
    return persistent ? '' : '<div class="note warn" style="margin-bottom:16px">This browser is blocking local storage, so your progress cannot be saved. Use <b>Progress → Export</b> before closing the page.</div>';
  }

  /* ---------- recommendation ---------- */
  function recommend() {
    const o = eng.overall(); const rank = id => E_RANK[eng.mastery(id).label];
    if (o.n === 0) return { go: 'learn:space', label: 'Begin with Sample spaces and events', why: 'You have no attempts yet. The topic map starts with events and counting because every later topic depends on them.' };
    const wk = eng.weakTopics().filter(x => x.m.M < 0.5 && x.m.total >= 4);
    if (wk.length) { const t = wk[0]; return { go: 'weakness', label: 'Targeted practice: ' + TOPIC[t.id].name, why: `Your mastery index for this topic is ${t.m.M.toFixed(2)} out of 1 (${t.m.label}). Weakness practice mixes it with its prerequisites.` }; }
    const due = eng.dueList().length;
    if (due >= 3) return { go: 'revision', label: `Revise ${due} question${due > 1 ? 's' : ''}`, why: 'These were missed or are due for spaced review. Revisiting them after a gap is what makes understanding stick.' };
    const order = D.topics.map(t => t.id);
    const ready = order.filter(id => rank(id) < 3 && TOPIC[id].pre.every(p => rank(p) >= 2));
    if (ready.length) { ready.sort((a, b) => eng.mastery(a).M - eng.mastery(b).M); return { go: 'learn:' + ready[0], label: 'Continue with ' + TOPIC[ready[0]].name, why: 'Prerequisites are in place and this is your least secure topic that you are ready for.' }; }
    const need = order.find(id => rank(id) < 3);
    if (need) return { go: 'learn:' + need, label: 'Strengthen ' + TOPIC[need].name, why: 'Some prerequisite topics are still developing; this is the best place to build them.' };
    return { go: 'challenge', label: 'Mixed-topic challenge', why: 'All topics are proficient. A mixed challenge tests whether you can choose the right method without being told the topic.' };
  }
  const E_RANK = eng.LABEL_RANK;

  /* ---------- HOME ---------- */
  function viewHome() {
    const o = eng.overall(), rec = recommend(), due = eng.dueList().length, S = eng.state;
    const dstat = eng.dailyStatus();
    main.innerHTML = header('Probability for economics', 'Practice from counting and conditional probability to distributions, with hints, worked solutions and feedback on common errors.') + persistNote() + `
    <section class="card" style="margin-bottom:16px"><div class="kicker">Recommended next</div><h2 style="margin:4px 0">${esc(rec.label)}</h2><p class="mut">${esc(rec.why)}</p><button class="btn pri" data-act="go-rec" data-arg="${rec.go}">Start</button></section>
    <section class="grid g3" style="margin-bottom:16px">
      <div class="card stat"><span class="kicker">Questions attempted</span><b>${o.n}</b><span class="small mut">of ${D.questions.length} in the bank</span></div>
      <div class="card stat"><span class="kicker">Accuracy</span><b>${o.n ? pct(o.acc) : '–'}</b><span class="small mut">${o.independent} correct without hints</span></div>
      <div class="card stat"><span class="kicker">Reasoning streak</span><b>${S.rs}</b><span class="small mut">best ${S.rsBest}; resets on a miss or a rushed answer</span></div>
      <div class="card stat"><span class="kicker">Practice days in a row</span><b>${eng.practiceStreak()}</b><span class="small mut">${S.days.length} days practised in total</span></div>
      <div class="card stat"><span class="kicker">Due for revision</span><b>${due}</b><span class="small mut">${due ? 'ready now' : (eng.nextDue() ? 'next ' + ago(eng.nextDue()) : 'nothing scheduled')}</span></div>
      <div class="card stat"><span class="kicker">Daily challenge</span><b>${dstat ? dstat.score + '/' + dstat.total : 'Open'}</b><span class="small mut">${dstat ? 'completed today; streak ' + eng.dailyStreak() : 'five questions, same for everyone today'}</span></div>
    </section>
    <section class="card"><h2 style="margin-bottom:6px">Topic mastery</h2><p class="small mut">The mastery index weights advanced questions more, discounts answers that needed hints, and needs evidence across difficulty levels before any topic is called proficient.</p>${masteryRows()}</section>`;
  }
  function masteryRows() {
    return D.topics.map(t => {
      const m = eng.mastery(t.id), pre = eng.weakPrereqs(t.id);
      return `<div class="mrow"><div><b>${esc(t.name)}</b><div class="small mut">${m.total ? m.total + ' attempts' + (m.acc !== null ? ', ' + pct(m.acc) + ' correct' : '') : esc(t.blurb)}</div></div>
      <div class="mbar" role="img" aria-label="Mastery index ${Math.round(m.M * 100)} out of 100"><i style="width:${Math.round(m.M * 100)}%"></i></div>
      <div><span class="lvl ${levelClass(m.label)}">${m.label}</span>${m.total && pre.length && m.label !== 'Mastered' && m.M < 0.5 ? `<div class="small mut" style="text-align:right">revisit ${esc(topicShort(pre[0].id))}</div>` : ''}</div></div>`;
    }).join('');
  }

  /* ---------- LEARN ---------- */
  function viewLearn() {
    main.innerHTML = header('Learn', 'Adaptive practice by topic. Difficulty moves with your answers; hints are optional and never block you.') + persistNote() +
      '<div class="grid g2">' + D.topics.map(t => {
        const m = eng.mastery(t.id), n = eng.byTopic[t.id].length, lvl = eng.currentLevel(t.id), pre = eng.weakPrereqs(t.id);
        const adv = eng.unlockedAdvanced(t.id), seen = eng.byTopic[t.id].filter(q => eng.state.q[q.id]).length;
        const need = Math.max(0, 4 - (m.n[2] + m.n[3]));
        return `<article class="card"><div class="row"><h3 class="sp">${esc(t.name)}</h3><span class="lvl ${levelClass(m.label)}">${m.label}</span></div>
        <p class="small mut">${esc(t.blurb)}</p>
        <div class="mbar" style="margin:10px 0"><i style="width:${Math.round(m.M * 100)}%"></i></div>
        <p class="small mut">${seen} of ${n} questions seen · current level: <b>${E.DIFF_NAME[lvl]}</b> · advanced set: ${adv ? '<b>unlocked</b>' : 'locked (answer ' + (need || 'a few more') + ' intermediate questions at about 60% or better)'}</p>
        ${pre.length && m.total < 6 ? `<p class="note warn small">Recommended first: ${pre.map(p => esc(topicShort(p.id))).join(', ')} (${pre.map(p => p.label.toLowerCase()).join(', ')}).</p>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn pri sm" data-act="learn" data-arg="${t.id}">Adaptive practice</button>
        <button class="btn sm" data-act="learn" data-arg="${t.id}:1">Foundational</button><button class="btn sm" data-act="learn" data-arg="${t.id}:2">Intermediate</button>
        <button class="btn sm" data-act="learn" data-arg="${t.id}:3" ${adv ? '' : 'disabled title="Locked until you show intermediate-level understanding"'}>Advanced</button></div></article>`;
      }).join('') + '</div>';
  }

  /* ---------- session machinery ---------- */
  /* every session is one "game" in the shared question history; a cfg.plan() callback builds the question list
     after the game has begun so that the plan can see (and respect) what was served in earlier games */
  function startSession(cfg) {
    eng.beginGame(cfg.mode);
    let note = '';
    if (typeof cfg.plan === 'function') {
      const p = cfg.plan();
      cfg.ids = p.ids || p.picks || [];
      if (p.relaxed) note = 'Part of this set reuses questions you saw longest ago, because the bank for this request is close to used up.';
    }
    SES = Object.assign({ i: 0, res: [], seen: new Set(), start: Date.now(), xp0: eng.state.xp, ach0: Object.keys(eng.state.ach).length, hints: true, feedback: true, notice: note }, cfg);
    SES.xp0 = eng.state.xp; SES.achBefore = new Set(Object.keys(eng.state.ach));
    SES.navKey = cfg.navKey || cfg.mode;
    nextQuestion();
  }
  function nextQuestion() {
    let q = null, reason = 'fresh';
    if (SES.ids) { const id = SES.ids[SES.i]; q = id ? eng.Q[id] : null; if (SES.mode === 'revision' || SES.mode === 'review') reason = 'revisit'; }
    else {
      const r = eng.pickLearnEx(SES.topic, SES.seen, SES.level || undefined);
      if (r) { q = r.q; reason = r.reason; }
      if (r && (r.reason === 'exhausted' || r.reason === 'relaxed') && !SES.warned) {
        SES.warned = true;
        SES.notice = r.reason === 'exhausted' ? 'You have been through every question available here in this session; the ones you saw longest ago are being shown again.'
          : 'You have recently seen most of the questions at this level, so older ones are being reused.';
      }
    }
    if (!q) { finishSession(); return; }
    SES.seen.add(q.id);
    SES.reason = reason;
    presentQuestion(q);
    V.screen = 'play'; render(); window.scrollTo(0, 0);
    const first = main.querySelector('.stem'); if (first) { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
  }
  function presentQuestion(q, keepHints) {
    const rand = E.rng(E.hash(q.id + ':' + eng.state.att.length));
    const order = E.shuffle(q.options.map((_, i) => i), rand);
    const old = QS;
    if (!keepHints) eng.markServed(q.id);
    QS = { q, order, hints: keepHints && old && old.q === q ? old.hints : 0, sel: null, typed: '', answered: false, ok: null, t0: Date.now(), retry: !!keepHints, res: null, choiceWhy: '', timeout: false, err: '' };
    clearTick();
    if (SES && SES.timed && !QS.retry) {
      QS.limit = PER_Q_SECONDS[q.diff]; QS.left = QS.limit;
      tick = setInterval(() => {
        if (!QS || QS.answered) return;
        QS.left--; const t = $('#timer'); if (t) { t.textContent = fmtTime(QS.left); t.classList.toggle('low', QS.left <= 15); }
        if (QS.left <= 0) { QS.timeout = true; submitAnswer(true); }
      }, 1000);
    }
  }
  function viewPlay() {
    if (!QS || !SES) { go('home'); return; }
    const q = QS.q, n = SES.ids ? SES.ids.length : null;
    const hintsHTML = q.hints.slice(0, QS.hints).map((h, i) => `<div class="hint"><b>Hint ${i + 1} · ${HINT_LABEL[i]}</b>${T(h)}</div>`).join('');
    let ans;
    if (q.kind === 'mcq') {
      ans = '<div class="opts" role="radiogroup" aria-label="Answer options">' + QS.order.map((oi, k) => {
        const o = q.options[oi]; let cls = '';
        if (QS.answered) cls = o.correct ? 'right' : (QS.sel === k ? 'wrong' : 'fade'); else if (QS.sel === k) cls = 'sel';
        return `<button class="opt ${cls}" role="radio" aria-checked="${QS.sel === k}" data-act="pick" data-arg="${k}" ${QS.answered ? 'disabled' : ''}><span class="k">${LETTERS[k]}</span><span>${T(o.text)}</span></button>`;
      }).join('') + '</div>';
      if (!QS.answered) ans += `<div class="row" style="margin-top:16px"><button class="btn pri" data-act="submit" ${QS.sel === null ? 'disabled' : ''}>Check answer</button>${hintBtn()}</div>`;
    } else {
      ans = `<form class="numrow" data-form="num"><input id="numin" inputmode="decimal" autocomplete="off" aria-label="Your answer" placeholder="Number, fraction (3/8) or percentage" value="${esc(QS.typed)}" ${QS.answered ? 'disabled' : ''}>${QS.answered ? '' : '<button class="btn pri" type="submit">Check answer</button>'}</form>`
        + (QS.err ? `<p class="small" style="color:var(--bad)">${esc(QS.err)}</p>` : '') + (QS.answered ? '' : `<div class="row" style="margin-top:12px">${hintBtn()}</div>`);
    }
    const timer = QS.limit && !QS.retry ? `<span class="timer ${QS.left <= 15 ? 'low' : ''}" id="timer" aria-label="Time remaining">${fmtTime(QS.left)}</span>` : '';
    main.innerHTML = `<div class="qwrap">
      <div class="row" style="margin-bottom:10px"><span class="kicker">${esc(SES.title)}${n ? ` · question ${SES.i + 1} of ${n}` : ` · question ${SES.res.length + (QS.answered ? 0 : 1)}`}</span><span class="sp"></span>${timer}<button class="btn sm ghost" data-act="end">${n ? 'Leave' : 'End session'}</button></div>
      ${n ? `<div class="progress"><i style="width:${Math.round(SES.i / n * 100)}%"></i></div>` : ''}
      ${SES.notice ? `<div class="note info small" style="margin-bottom:12px" role="status">${esc(SES.notice)}</div>` : ''}
      <h1 class="sr" style="position:absolute;left:-999px">Question</h1>
      <div class="card qbox"><div class="qhead">${diffChip(q.diff)}<span class="chip">${esc(TOPIC[q.topic].name)}</span><span class="chip">${esc(q.sub)}</span>${SES.reason === 'revisit' && !QS.retry ? '<span class="chip">Revisiting a question you missed</span>' : ''}${QS.retry ? '<span class="chip">Retry: no XP</span>' : ''}</div>
      ${stemHTML(q)}${ans}<div class="hints" aria-live="polite">${hintsHTML}</div>
      ${QS.answered ? feedbackHTML() : ''}</div></div>`;
    const inp = $('#numin'); if (inp && !QS.answered) inp.focus();
    if (QS.answered) { const f = $('#fb'); if (f) f.focus({ preventScroll: false }); }
  }
  function hintBtn() {
    if (!SES.hints) return '';
    if (QS.hints >= 3) return '<span class="small mut">All three hints shown.</span>';
    return `<button class="btn ghost" data-act="hint">Hint ${QS.hints + 1} of 3: ${HINT_LABEL[QS.hints]}</button><span class="small mut">Hints lower the XP slightly. They never lock anything.</span>`;
  }
  function submitAnswer(timeout) {
    const q = QS.q; if (QS.answered) return;
    let ok = false, choice = null;
    if (!timeout) {
      if (q.kind === 'mcq') {
        if (QS.sel === null) return;
        const o = q.options[QS.order[QS.sel]]; ok = o.correct; choice = o.text; QS.choiceWhy = o.why;
      } else {
        const v = E.parseNumber(QS.typed);
        if (!isFinite(v)) { QS.err = 'Enter a number, a fraction such as 3/8, or a percentage such as 37.5%.'; viewPlay(); return; }
        QS.err = ''; choice = String(QS.typed).slice(0, 30);
        const tol = Math.max(E.toleranceOf(q), 1e-9); ok = Math.abs(v - q.answer.value) <= tol;
      }
    } else choice = 'timeout';
    const ms = Math.min(Date.now() - QS.t0, 15 * 60e3);
    const res = eng.recordAttempt({ qid: q.id, ok, ms, hints: QS.hints, mode: SES.mode, retry: QS.retry, choice });
    QS.answered = true; QS.ok = ok; QS.res = res; QS.timeout = !!timeout;
    if (!QS.retry) SES.res.push({ qid: q.id, ok, hints: QS.hints, xp: res.xp, ms, choice });
    clearTick(); notifyProgress(); viewPlay(); renderNav();
  }
  function notifyProgress() {
    const r = eng.rank().name; if (r !== lastRank) { toast('New standing: ' + r); lastRank = r; }
    for (const a of eng.ACH) if (eng.state.ach[a.id] && SES && !SES.achBefore.has(a.id)) { SES.achBefore.add(a.id); toast('Achievement: ' + a.n); }
  }
  function feedbackHTML() {
    const q = QS.q, ok = QS.ok, r = QS.res;
    let xpLine = '';
    if (QS.retry) xpLine = 'Retry: no XP awarded.';
    else if (ok) xpLine = `+${r.xp} XP` + (r.why === 'independent' ? ' (independent answer bonus)' : r.rapid ? ' (reduced: answered in a few seconds; the reasoning streak was reset)' : QS.hints ? ` (reduced for ${QS.hints} hint${QS.hints > 1 ? 's' : ''})` : '');
    else xpLine = r.xp ? `+${r.xp} XP for the attempt` : 'No XP lost. The question is queued for revision.';
    const correctOpt = q.kind === 'mcq' ? q.options.find(o => o.correct).text : q.answer.display;
    let head = ok ? 'Correct' : (QS.timeout ? 'Time expired' : 'Not quite');
    let why = '';
    if (!ok && !QS.timeout && q.kind === 'mcq' && QS.choiceWhy) why = `<p><b>Why that option is tempting but wrong.</b> ${T(QS.choiceWhy)}</p>`;
    if (!ok && !QS.timeout && q.kind === 'num') why = `<p>Your answer was <span class="mono">${esc(QS.typed)}</span>.</p>`;
    const pre = !ok && eng.struggling(q.topic) ? eng.weakPrereqs(q.topic) : [];
    const sol = `<ol class="sol">${q.solution.map(s => `<li>${T(s)}</li>`).join('')}</ol>`;
    return `<div class="fb ${ok ? 'ok' : 'no'}" id="fb" tabindex="-1" role="region" aria-label="Feedback"><h3>${head}${ok ? '' : ` · the answer is ${T(correctOpt)}`}</h3>
      <p class="small mut">${esc(xpLine)}</p>${why}
      ${ok ? `<details class="more"><summary>Worked solution</summary>${sol}</details>` : `<div style="margin-top:8px"><b>Worked solution</b>${sol}</div>`}
      <dl class="kv"><dt>Concept</dt><dd>${T(q.concept)}</dd><dt>Common error</dt><dd>${T(q.misconception)}</dd><dt>Why it works</dt><dd>${T(q.why)}</dd></dl>
      ${pre.length ? `<p class="note warn small" style="margin-top:12px">You have missed several recent ${esc(topicShort(q.topic))} questions. Consider revisiting ${pre.map(p => esc(TOPIC[p.id].name)).join(' and ')} first.</p>` : ''}
      <div class="row" style="margin-top:16px"><button class="btn pri" data-act="next">${SES.ids && SES.i + 1 >= SES.ids.length ? 'Finish' : 'Next question'}</button>
      ${!ok ? '<button class="btn" data-act="retry">Try again (no XP)</button>' : ''}</div></div>`;
  }
  function finishSession() {
    clearTick();
    const S = SES; S.end = Date.now(); S.gained = eng.state.xp - S.xp0;
    const correct = S.res.filter(r => r.ok).length;
    if (S.mode === 'daily' && S.dailyKey && S.res.length) {
      if (!eng.dailyStatus(S.dailyKey)) eng.recordDaily(S.dailyKey, correct, S.ids.length, S.ids);
    }
    if (S.mode === 'challenge' && S.res.length >= 5) { S.newBest = eng.setBest('challenge' + (S.timed ? 'T' : ''), correct / S.res.length); }
    notifyProgress(); eng.save();
    V.screen = 'result'; render(); window.scrollTo(0, 0);
  }
  function viewResult() {
    const S = SES; if (!S) { go('home'); return; }
    const n = S.res.length, c = S.res.filter(r => r.ok).length;
    const missed = S.res.filter(r => !r.ok);
    const byT = {}; S.res.forEach(r => { const t = eng.Q[r.qid].topic; (byT[t] = byT[t] || [0, 0]); byT[t][1]++; if (r.ok) byT[t][0]++; });
    main.innerHTML = header(S.title + ': summary', null, false) + `<div class="grid g3" style="margin-bottom:16px">
      <div class="card stat"><span class="kicker">Score</span><b>${c} / ${n}</b><span class="small mut">${n ? pct(c / n) : ''}${S.newBest ? ' · new personal best' : ''}</span></div>
      <div class="card stat"><span class="kicker">XP earned</span><b>${S.gained}</b><span class="small mut">${S.res.filter(r => r.hints > 0).length} question(s) used hints</span></div>
      <div class="card stat"><span class="kicker">Time</span><b>${fmtTime((S.end - S.start) / 1000)}</b><span class="small mut">${n ? Math.round((S.end - S.start) / 1000 / n) + ' s per question' : ''}</span></div></div>
      ${n ? `<section class="card" style="margin-bottom:16px"><h2>By topic</h2>${Object.entries(byT).map(([t, v]) => `<div class="mrow"><div><b>${esc(TOPIC[t].name)}</b></div><div class="mbar"><i style="width:${Math.round(v[0] / v[1] * 100)}%"></i></div><div class="small">${v[0]} / ${v[1]}</div></div>`).join('')}</section>` : '<div class="note">No questions were answered in this session.</div>'}
      ${missed.length ? `<section class="card" style="margin-bottom:16px"><h2>To revisit</h2><p class="small mut">These are queued for spaced revision. The concept behind each one:</p>${missed.map(r => { const q = eng.Q[r.qid]; return `<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="small mut">${esc(q.id)} · ${esc(topicShort(q.topic))}</div><div>${T(q.concept)}</div><div class="small mut">Common error: ${T(q.misconception)}</div></div>`; }).join('')}</section>` : ''}
      <div class="row">${missed.length ? '<button class="btn pri" data-act="review-missed">Practise the missed questions again</button>' : ''}<button class="btn" data-act="go" data-arg="progress">Progress</button><button class="btn ghost" data-act="go" data-arg="home">Home</button></div>`;
  }

  /* ---------- starters ---------- */
  function startLearn(tid, level) {
    startSession({ mode: 'learn', navKey: 'learn', title: 'Learn: ' + TOPIC[tid].name, topic: tid, level: level || 0, ids: null });
  }
  /* ---------- CHALLENGE ---------- */
  function viewChallenge() {
    const c = V.cfg, b = eng.state.bests;
    main.innerHTML = header('Challenge', 'A mixed set that tests whether you can identify the method yourself. Difficulty follows a 25/45/30 blueprint.') + `
    <section class="card qwrap"><div class="grid g2" style="margin-bottom:12px">
      <label>Questions<br><select data-cfg="chN">${[5, 10, 15].map(n => `<option ${c.chN === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Scope<br><select data-cfg="chScope"><option value="">All topics (multi-concept)</option>${D.topics.map(t => `<option value="${t.id}" ${c.chScope === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label></div>
      <label class="row"><input type="checkbox" data-cfg="chTimed" ${c.chTimed ? 'checked' : ''}> Timed (60 / 100 / 150 seconds per foundational / intermediate / advanced question)</label>
      <p class="small mut">Hints stay available. Timing never changes how many XP a correct answer earns; it only limits how long you may take. Personal best: untimed ${b.challenge != null ? pct(b.challenge) : '–'}, timed ${b.challengeT != null ? pct(b.challengeT) : '–'}.</p>
      <button class="btn pri" data-act="start-challenge">Start challenge</button></section>`;
  }

  /* ---------- WEAKNESS ---------- */
  function viewWeakness() {
    const plan = eng.weaknessPlan(10), wt = eng.weakTopics();
    let body;
    if (!plan.topics.length) {
      body = `<div class="card qwrap"><h2>Not enough evidence yet</h2><p>Weakness practice needs at least three attempts in a topic before it can tell a weak topic from an unfamiliar one. Answer more questions in Learn mode first.</p><button class="btn pri" data-act="go" data-arg="learn">Go to Learn</button></div>`;
    } else {
      body = `<section class="card qwrap"><h2>Your focus areas</h2>${plan.topics.map((t, i) => { const m = eng.mastery(t); return `<div class="mrow"><div><b>${esc(TOPIC[t].name)}</b><div class="small mut">${i < 2 && wt.some(x => x.id === t) ? 'lowest mastery index among topics you have attempted' : 'prerequisite of a weak topic'}</div></div><div class="mbar"><i style="width:${Math.round(m.M * 100)}%"></i></div><span class="lvl ${levelClass(m.label)}">${m.label}</span></div>`; }).join('')}
      <p class="small mut">Ten questions are drawn at a level where you can succeed with effort, rather than the hardest level in each topic.</p>
      <button class="btn pri" data-act="start-weak">Start ten questions</button></section>`;
    }
    main.innerHTML = header('Weakness practice', 'Targets the topics where your evidence shows the least secure understanding, and the prerequisites behind them.') + body;
  }

  /* ---------- REVISION ---------- */
  function viewRevision() {
    const due = eng.dueList(), nx = eng.nextDue();
    const byT = {}; due.forEach(d => { const t = eng.Q[d.id].topic; byT[t] = (byT[t] || 0) + 1; });
    main.innerHTML = header('Revision', 'Questions you missed, or answered correctly some time ago, return on a spaced schedule (1, 3, 7, 14 and 30 days).') + (due.length
      ? `<section class="card qwrap"><h2>${due.length} due now</h2><p class="small mut">${Object.entries(byT).map(([t, n]) => esc(topicShort(t)) + ' ' + n).join(' · ')}</p><button class="btn pri" data-act="start-rev">Revise ${Math.min(10, due.length)} question${Math.min(10, due.length) > 1 ? 's' : ''}</button></section>`
      : `<section class="card qwrap"><h2>Nothing is due</h2><p class="mut">${nx ? 'The next question comes due ' + ago(nx) + '.' : 'Questions appear here after you answer them in other modes.'}</p>${Object.keys(eng.state.q).length ? '<button class="btn" data-act="start-rev-early">Review early anyway</button>' : ''}</section>`);
  }

  /* ---------- DAILY ---------- */
  function viewDaily() {
    const key = E.dayKey(Date.now()), done = eng.dailyStatus(key), S = eng.state;
    main.innerHTML = header('Daily challenge', 'Five advanced-leaning questions on different topics. Everyone gets the same set on the same date.') + `<section class="card qwrap">
      <p>Date <b>${key}</b>. Current daily streak: <b>${eng.dailyStreak()}</b> (best ${S.daily.best}).</p>
      ${done ? `<div class="note info">Completed today with <b>${done.score} / ${done.total}</b>. A new set appears tomorrow. You can review today's questions in Library or practise them again below (no XP is added for repeats within a day).</div><div class="row" style="margin-top:12px"><button class="btn" data-act="start-daily">Practise today's set again</button></div>`
      : `<p class="mut">Hints are allowed; they reduce XP but do not affect completing the challenge.</p><button class="btn pri" data-act="start-daily">Start today's challenge</button>`}</section>`;
  }

  /* ---------- EXAM ---------- */
  function viewExam() {
    const c = V.cfg;
    main.innerHTML = header('Exam', 'A test under exam conditions: no hints, no feedback until you submit, free navigation between questions.') + `
    <section class="card qwrap"><div class="grid g2" style="margin-bottom:12px"><label>Questions<br><select data-cfg="exN">${[10, 15, 20].map(n => `<option ${c.exN === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="row" style="align-self:end"><input type="checkbox" data-cfg="exTimed" ${c.exTimed ? 'checked' : ''}> Timed (${2 * c.exN} minutes)</label></div>
      <p class="small mut">Questions follow a blueprint of 25% foundational, 45% intermediate and 30% advanced, spread across the nine topics. Personal best: ${eng.state.bests.exam != null ? pct(eng.state.bests.exam) : '–'}. Explanations appear after submission, and every attempt feeds the same mastery model as Learn mode.</p>
      <button class="btn pri" data-act="start-exam">Begin exam</button></section>`;
  }
  function startExam() {
    const n = V.cfg.exN;
    eng.beginGame('exam');
    const plan = eng.planMixed(n), ids = plan.ids;
    ids.forEach(id => eng.markServed(id));
    if (plan.relaxed) toast('Some exam questions reuse older material: the bank is close to used up for this blueprint.');
    const order = {}; ids.forEach(id => { const q = eng.Q[id]; order[id] = E.shuffle(q.options.map((_, i) => i), E.rng(E.hash(id + 'exam' + Date.now()))); });
    EX = { ids, i: 0, ans: {}, typed: {}, flag: {}, order, start: Date.now(), limit: V.cfg.exTimed ? n * 120 : 0, submitted: false };
    V.screen = 'examrun'; render(); window.scrollTo(0, 0);
    clearTick();
    if (EX.limit) tick = setInterval(() => {
      const left = EX.limit - (Date.now() - EX.start) / 1000, t = $('#timer');
      if (t) { t.textContent = fmtTime(left); t.classList.toggle('low', left <= 120); }
      if (left <= 0) submitExam(true);
    }, 1000);
  }
  function viewExamRun() {
    if (!EX) { go('exam'); return; }
    const id = EX.ids[EX.i], q = eng.Q[id], n = EX.ids.length;
    const answered = i => EX.ans[EX.ids[i]] != null || (EX.typed[EX.ids[i]] || '').trim() !== '';
    let ans;
    if (q.kind === 'mcq') ans = '<div class="opts" role="radiogroup">' + EX.order[id].map((oi, k) => `<button class="opt ${EX.ans[id] === k ? 'sel' : ''}" role="radio" aria-checked="${EX.ans[id] === k}" data-act="xpick" data-arg="${k}"><span class="k">${LETTERS[k]}</span><span>${T(q.options[oi].text)}</span></button>`).join('') + '</div>';
    else ans = `<div class="numrow"><input id="xnum" inputmode="decimal" autocomplete="off" aria-label="Your answer" placeholder="Number, fraction or percentage" value="${esc(EX.typed[id] || '')}"></div>`;
    main.innerHTML = `<div class="qwrap"><div class="row" style="margin-bottom:8px"><span class="kicker">Exam · question ${EX.i + 1} of ${n}</span><span class="sp"></span>${EX.limit ? `<span class="timer" id="timer">${fmtTime(EX.limit - (Date.now() - EX.start) / 1000)}</span>` : ''}</div>
      <div class="qnav" role="navigation" aria-label="Questions">${EX.ids.map((_, i) => `<button class="${answered(i) ? 'done' : ''} ${EX.flag[EX.ids[i]] ? 'flag' : ''}" ${i === EX.i ? 'aria-current="true"' : ''} data-act="xgo" data-arg="${i}" aria-label="Question ${i + 1}${answered(i) ? ', answered' : ''}${EX.flag[EX.ids[i]] ? ', flagged' : ''}">${i + 1}</button>`).join('')}</div>
      <h1 style="position:absolute;left:-999px">Exam question ${EX.i + 1}</h1>
      <div class="card qbox"><div class="qhead">${diffChip(q.diff)}<span class="chip">${esc(TOPIC[q.topic].name)}</span></div>${stemHTML(q)}${ans}
      <div class="row" style="margin-top:20px"><button class="btn" data-act="xprev" ${EX.i === 0 ? 'disabled' : ''}>Previous</button><button class="btn" data-act="xnext" ${EX.i === n - 1 ? 'disabled' : ''}>Next</button><button class="btn ghost" data-act="xflag">${EX.flag[id] ? 'Remove flag' : 'Flag for review'}</button><span class="sp"></span><button class="btn pri" data-act="xsubmit">Submit exam</button></div></div></div>`;
  }
  function submitExam(auto) {
    if (!EX || EX.submitted) return;
    clearTick(); closeModal();
    const elapsed = Math.min((Date.now() - EX.start) / 1000, EX.limit || 1e9), per = Math.max(5000, elapsed * 1000 / EX.ids.length);
    const rows = []; let c = 0; const before = new Set(Object.keys(eng.state.ach)); const xp0 = eng.state.xp;
    EX.ids.forEach(id => {
      const q = eng.Q[id]; let ok = false, shown = '(no answer)', choice = null;
      if (q.kind === 'mcq') { const k = EX.ans[id]; if (k != null) { const o = q.options[EX.order[id][k]]; ok = o.correct; shown = o.text; choice = o.text; } }
      else { const t = EX.typed[id]; if (t && t.trim()) { const v = E.parseNumber(t); shown = t; choice = t.slice(0, 30); ok = isFinite(v) && Math.abs(v - q.answer.value) <= Math.max(E.toleranceOf(q), 1e-9); } }
      const res = eng.recordAttempt({ qid: id, ok, ms: per, hints: 0, mode: 'exam', retry: false, choice });
      if (ok) c++; rows.push({ id, ok, shown, xp: res.xp, blank: choice == null });
    });
    EX.submitted = true; EX.rows = rows; EX.score = c; EX.xp = eng.state.xp - xp0; EX.auto = !!auto; EX.elapsed = elapsed;
    EX.newBest = eng.setBest('exam', c / EX.ids.length);
    for (const a of eng.ACH) if (eng.state.ach[a.id] && !before.has(a.id)) toast('Achievement: ' + a.n);
    lastRank = eng.rank().name; eng.save();
    V.screen = 'examresult'; render(); window.scrollTo(0, 0);
  }
  function viewExamResult() {
    if (!EX || !EX.submitted) { go('exam'); return; }
    const n = EX.ids.length;
    const byT = {}; EX.rows.forEach(r => { const t = eng.Q[r.id].topic; (byT[t] = byT[t] || [0, 0]); byT[t][1]++; if (r.ok) byT[t][0]++; });
    main.innerHTML = header('Exam results', EX.auto ? 'Time expired and the exam was submitted automatically.' : null, false) + `<div class="grid g3" style="margin-bottom:16px">
      <div class="card stat"><span class="kicker">Score</span><b>${EX.score} / ${n}</b><span class="small mut">${pct(EX.score / n)}${EX.newBest ? ' · new personal best' : ''}</span></div>
      <div class="card stat"><span class="kicker">XP earned</span><b>${EX.xp}</b></div><div class="card stat"><span class="kicker">Time used</span><b>${fmtTime(EX.elapsed)}</b></div></div>
      <section class="card" style="margin-bottom:16px"><h2>By topic</h2>${Object.entries(byT).map(([t, v]) => `<div class="mrow"><div><b>${esc(TOPIC[t].name)}</b></div><div class="mbar"><i style="width:${Math.round(v[0] / v[1] * 100)}%"></i></div><div class="small">${v[0]} / ${v[1]}</div></div>`).join('')}</section>
      <section class="card"><h2>Review</h2>${EX.rows.map((r, i) => { const q = eng.Q[r.id], corr = q.kind === 'mcq' ? q.options.find(o => o.correct).text : q.answer.display;
        const wrongOpt = q.kind === 'mcq' && !r.ok && !r.blank ? q.options.find(o => o.text === r.shown) : null;
        return `<details class="more" style="border-top:1px solid var(--line);padding-top:10px"><summary>${i + 1}. ${r.ok ? 'Correct' : r.blank ? 'Unanswered' : 'Incorrect'} · ${esc(topicShort(q.topic))} · ${esc(E.DIFF_NAME[q.diff])}</summary>
        ${stemHTML(q)}<p><b>Your answer:</b> ${T(r.shown)} &nbsp; <b>Correct:</b> ${T(corr)}</p>${wrongOpt && wrongOpt.why ? `<p><b>Why your option is wrong.</b> ${T(wrongOpt.why)}</p>` : ''}
        <ol class="sol">${q.solution.map(s => `<li>${T(s)}</li>`).join('')}</ol><dl class="kv"><dt>Concept</dt><dd>${T(q.concept)}</dd><dt>Common error</dt><dd>${T(q.misconception)}</dd></dl></details>`; }).join('')}</section>
      <div class="row" style="margin-top:16px"><button class="btn pri" data-act="go" data-arg="exam">New exam</button><button class="btn" data-act="go" data-arg="weakness">Weakness practice</button><button class="btn ghost" data-act="go" data-arg="home">Home</button></div>`;
  }

  /* ---------- LIBRARY ---------- */
  function libFiltered() {
    const f = V.lib, txt = f.text.trim().toLowerCase();
    return D.questions.filter(q => (!f.topic || q.topic === f.topic) && (!f.diff || q.diff === +f.diff)
      && (!txt || q.id.toLowerCase().includes(txt) || q.stem.toLowerCase().includes(txt) || q.sub.toLowerCase().includes(txt)));
  }
  function viewLibrary() {
    const f = V.lib;
    if (f.open && eng.Q[f.open]) { viewLibraryItem(eng.Q[f.open]); return; }
    const sel = (name, opts, cur, label) => `<label class="small">${label}<br><select data-lib="${name}"><option value="">All</option>${opts.map(o => `<option value="${o[0]}" ${String(cur) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
    main.innerHTML = header('Question library', 'Browse every question with its worked solution, hints and the common errors it targets.') + `
    <section class="card" style="margin-bottom:16px"><div class="row" style="align-items:flex-end">
      ${sel('topic', D.topics.map(t => [t.id, t.name]), f.topic, 'Topic')}${sel('diff', [[1, 'Foundational'], [2, 'Intermediate'], [3, 'Advanced']], f.diff, 'Difficulty')}
      <label class="small">Search<br><input data-lib="text" value="${esc(f.text)}" placeholder="ID or keyword" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel)"></label></div></section>
    <section class="card"><div id="libres"></div></section>`;
    renderLibList();
  }
  function renderLibList() {
    const el = $('#libres'); if (!el) return;
    const list = libFiltered(), shown = list.slice(0, V.lib.shown);
    el.innerHTML = `<p class="small mut">${list.length} question${list.length === 1 ? '' : 's'}</p><div class="scroll"><table class="t"><thead><tr><th>ID</th><th>Topic</th><th>Level</th><th></th></tr></thead><tbody>` +
      shown.map(q => `<tr><td class="mono">${esc(q.id)}</td><td>${esc(topicShort(q.topic))}<div class="small mut">${esc(q.sub)}</div></td><td>${diffChip(q.diff)}</td><td><button class="btn sm" data-act="libopen" data-arg="${esc(q.id)}">Open</button></td></tr>`).join('') +
      `</tbody></table></div>${list.length > shown.length ? `<div class="row" style="margin-top:12px"><button class="btn" data-act="libmore">Show more</button></div>` : ''}`;
  }
  function viewLibraryItem(q) {
    const st = eng.state.q[q.id];
    main.innerHTML = header(q.id, esc(TOPIC[q.topic].name) + ' · ' + esc(q.sub), false) + `<div class="qwrap"><div class="card qbox"><div class="qhead">${diffChip(q.diff)}${st ? `<span class="chip">attempted ${st.n}×</span>` : ''}</div>${stemHTML(q)}
      ${q.kind === 'mcq' ? '<div class="opts">' + q.options.map((o, i) => `<div class="opt ${o.correct ? 'right' : ''}"><span class="k">${LETTERS[i]}</span><span>${T(o.text)}${o.correct ? '' : `<div class="small mut">${T(o.why)}</div>`}</span></div>`).join('') + '</div>' : `<p><b>Answer:</b> ${esc(q.answer.display)}</p>`}
      <div style="margin-top:14px"><b>Worked solution</b><ol class="sol">${q.solution.map(s => `<li>${T(s)}</li>`).join('')}</ol></div>
      <div class="hints">${q.hints.map((h, i) => `<div class="hint"><b>Hint ${i + 1} · ${HINT_LABEL[i]}</b>${T(h)}</div>`).join('')}</div>
      <dl class="kv"><dt>Concept</dt><dd>${T(q.concept)}</dd><dt>Common error</dt><dd>${T(q.misconception)}</dd><dt>Why it works</dt><dd>${T(q.why)}</dd></dl>
      <div class="row" style="margin-top:16px"><button class="btn pri" data-act="libpractise" data-arg="${esc(q.id)}">Practise this question</button><button class="btn" data-act="libback">Back to list</button></div></div></div>`;
  }
  /* ---------- PROGRESS ---------- */
  function viewProgress() {
    const o = eng.overall(), S = eng.state, act = eng.activity(14), mx = Math.max(1, ...act.map(a => a.n));
    const W = 560, H = 120, bw = W / act.length;
    const chart = `<svg viewBox="0 0 ${W} ${H + 22}" width="100%" role="img" aria-label="Questions answered per day over the last 14 days" class="bars">${act.map((a, i) => {
      const h = a.n / mx * H, hc = a.ok / mx * H;
      return `<rect x="${i * bw + 4}" y="${H - h}" width="${bw - 8}" height="${h}" style="fill:var(--line)"></rect><rect x="${i * bw + 4}" y="${H - hc}" width="${bw - 8}" height="${hc}"></rect>${i % 2 === 0 ? `<text x="${i * bw + bw / 2}" y="${H + 14}" text-anchor="middle">${a.day.slice(8)}</text>` : ''}`;
    }).join('')}</svg>`;
    const errs = {}; S.att.filter(a => !a.ok && !a.r && a.c && a.c !== 'timeout').forEach(a => { const q = eng.Q[a.q]; if (!q || q.kind !== 'mcq') return; const op = q.options.find(x => x.text === a.c); if (op && op.why) { const k = op.why; errs[k] = errs[k] || { n: 0, q: q.id, last: 0 }; errs[k].n++; errs[k].last = Math.max(errs[k].last, a.t); } });
    const errList = Object.entries(errs).sort((a, b) => b[1].last - a[1].last).slice(0, 6);
    main.innerHTML = header('Progress', 'Everything here is computed from your own attempts, stored on this device.') + persistNote() + `
    <section class="grid g3" style="margin-bottom:16px">
      <div class="card stat"><span class="kicker">First attempts</span><b>${o.n}</b><span class="small mut">${o.n ? pct(o.acc) + ' correct' : ''}</span></div>
      <div class="card stat"><span class="kicker">Hint use</span><b>${o.n ? pct(o.hintRate) : '–'}</b><span class="small mut">share of questions where you opened a hint</span></div>
      <div class="card stat"><span class="kicker">Median time</span><b>${o.n ? fmtTime(o.medianMs / 1000) : '–'}</b><span class="small mut">per question</span></div></section>
    <section class="card" style="margin-bottom:16px"><h2>Accuracy by difficulty</h2>${[1, 2, 3].map(d => `<div class="mrow"><div><b>${E.DIFF_NAME[d]}</b></div><div class="mbar"><i style="width:${o.byD[d][1] ? Math.round(o.byD[d][0] / o.byD[d][1] * 100) : 0}%"></i></div><div class="small">${o.byD[d][1] ? o.byD[d][0] + ' / ' + o.byD[d][1] : 'not attempted'}</div></div>`).join('')}</section>
    <section class="card" style="margin-bottom:16px"><h2>Last 14 days</h2><p class="small mut">Questions answered (grey) and answered correctly (blue).</p>${chart}</section>
    <section class="card" style="margin-bottom:16px"><h2>Topic mastery</h2>${masteryRows()}</section>
    <section class="card" style="margin-bottom:16px"><h2>Reasoning errors to watch</h2>${errList.length ? errList.map(([why, v]) => `<div style="padding:8px 0;border-top:1px solid var(--line)">${T(why)}<div class="small mut">${v.n}× · e.g. ${esc(v.q)}</div></div>`).join('') : '<p class="mut">Once you make mistakes on multiple-choice questions, the specific misconceptions behind them are listed here.</p>'}</section>
    <section class="card" style="margin-bottom:16px"><h2>Achievements</h2><div class="grid g2">${eng.ACH.map(a => `<div class="note" style="${S.ach[a.id] ? '' : 'opacity:.6'}"><b>${esc(a.n)}</b>${S.ach[a.id] ? ' · earned' : ''}<div class="small">${esc(a.d)}</div></div>`).join('')}</div></section>
    <section class="card"><h2>Your data</h2><p class="small mut">${persistent ? 'Saved in this browser only. It is not uploaded anywhere and will not appear on another device or browser. To move it, export a file and import it elsewhere.' : 'Browser storage is unavailable; progress lives only until this page closes.'}</p>
    <div class="row"><button class="btn" data-act="export">Export progress</button><button class="btn" data-act="import">Import progress</button><input type="file" id="impfile" accept="application/json,.json" style="display:none"><button class="btn ghost" data-act="reset">Reset all progress</button></div></section>`;
  }

  /* ---------- ABOUT ---------- */
  function viewAbout() {
    const dc = d => D.questions.filter(q => q.diff === d).length, N = D.questions.length;
    const kinds = D.topics.map(t => `<li><b>${esc(t.name)}</b>: ${esc(t.blurb)} (${eng.byTopic[t.id].length} questions)</li>`).join('');
    main.innerHTML = header('How it works', null, false) + `
    <section class="card" style="margin-bottom:16px"><h2>What this is</h2>
      <p>A practice bank of <b>${N}</b> probability problems for undergraduate economics students, with hints, worked solutions and feedback on the specific errors that wrong options represent. Difficulty mix: ${pct(dc(1) / N)} foundational, ${pct(dc(2) / N)} intermediate, ${pct(dc(3) / N)} advanced, graded by reasoning demand rather than arithmetic length.</p>
      <ul>${kinds}</ul></section>
    <section class="card" style="margin-bottom:16px"><h2>How practice is scored</h2><ul>
      <li><b>XP</b>: 10, 20 or 35 for a correct foundational, intermediate or advanced answer. Hints multiply this by 0.75, 0.55 or 0.4. An answer with no hints earns a 25% bonus. A wrong answer earns almost nothing, and costs nothing.</li>
      <li><b>Speed is not rewarded.</b> Answering within a few seconds earns a quarter of the XP and resets the reasoning streak, so guessing does not pay.</li>
      <li><b>Repeats</b> of a question within a day earn a quarter of the XP; retrying straight after feedback earns none. After about 400 XP in one day, further XP is also reduced to a quarter, so long sessions cannot be used to climb the standings.</li>
      <li><b>Mastery index</b> per topic: recent answers at each difficulty (newer weigh more, hinted ones count less), weighted 20/35/45% and scaled by how much evidence exists at that level. “Proficient” needs at least three intermediate attempts; “Mastered” also needs advanced attempts on two different days.</li>
      <li><b>Adaptive level</b>: three clean answers in a row raise the level; two misses in three lower it. Advanced questions unlock after four intermediate or advanced attempts at roughly 60% or better.</li>
      <li><b>Revision</b> uses a Leitner schedule of 1, 3, 7, 14 and 30 days. A miss returns the question to the first box.</li></ul></section>
    <section class="card"><h2>Good to know</h2><ul>
      <li>Progress is saved in this browser on this device. There are no accounts and nothing is synchronised; use Progress → Export to move it.</li>
      <li>Difficulty levels and “mastery” are guides for practice, not a grade.</li>
      <li>Every answer key was computed in code and re-derived by a second method before the question was released.</li></ul></section>`;
  }
  /* ---------- events ---------- */
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    guard(() => handle(act, arg, el));
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault();
    if (f.dataset.form === 'num') { QS.typed = $('#numin').value; submitAnswer(false); }
  });
  document.addEventListener('input', ev => {
    const t = ev.target;
    if (t.id === 'numin' && QS) QS.typed = t.value;
    if (t.id === 'xnum' && EX) { EX.typed[EX.ids[EX.i]] = t.value; }
    if (t.dataset && t.dataset.lib === 'text') { V.lib.text = t.value; V.lib.shown = 40; renderLibList(); }
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset && t.dataset.cfg) { const k = t.dataset.cfg; V.cfg[k] = t.type === 'checkbox' ? t.checked : (k === 'chScope' ? t.value : +t.value); if (V.screen === 'exam') viewExam(); }
    if (t.dataset && t.dataset.lib && t.dataset.lib !== 'text') { V.lib[t.dataset.lib] = t.value; V.lib.shown = 40; renderLibList(); }
    if (t.id === 'impfile' && t.files[0]) {
      const r = new FileReader();
      r.onload = () => { try { eng.importJSON(String(r.result)); toast('Progress imported'); lastRank = eng.rank().name; render(); } catch (e) { toast('Import failed: ' + e.message); } };
      r.readAsText(t.files[0]);
    }
  });
  document.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if ($('#modal')) { if (ev.key === 'Escape') closeModal(); return; }
    if (V.screen === 'play' && QS) {
      const k = ev.key.toLowerCase();
      if (!QS.answered && QS.q.kind === 'mcq') {
        const i = '12345678'.indexOf(k) >= 0 ? '12345678'.indexOf(k) : 'abcdefgh'.indexOf(k);
        if (k.length === 1 && i >= 0 && i < QS.q.options.length) { QS.sel = i; viewPlay(); ev.preventDefault(); return; }
        if (k === 'enter' && QS.sel !== null) { submitAnswer(false); ev.preventDefault(); return; }
      }
      if (k === 'h' && !QS.answered && SES.hints && QS.hints < 3) { QS.hints++; viewPlay(); return; }
      if (k === 'enter' && QS.answered && ev.target.tagName !== 'BUTTON') { SES.i++; nextQuestion(); ev.preventDefault(); }
    }
    if (V.screen === 'examrun' && EX) {
      const q = eng.Q[EX.ids[EX.i]], k = ev.key.toLowerCase();
      if (q.kind === 'mcq') { const i = 'abcd1234'.indexOf(k); if (k.length === 1 && i >= 0 && i % 4 < q.options.length) { EX.ans[q.id] = i % 4; viewExamRun(); return; } }
      if (k === 'arrowright' && EX.i < EX.ids.length - 1) { EX.i++; viewExamRun(); }
      if (k === 'arrowleft' && EX.i > 0) { EX.i--; viewExamRun(); }
    }
  });

  function handle(act, arg, el) {
    switch (act) {
      case 'go': go(arg); break;
      case 'close': closeModal(); break;
      case 'go-rec': { const [a, b] = arg.split(':'); if (a === 'learn') startLearn(b); else if (a === 'weakness') { startSession({ mode: 'weakness', title: 'Weakness practice', plan: () => eng.weaknessPlan(10) }); } else if (a === 'revision') startRevision(false); else go(a); break; }
      case 'theme': { const cur = storage.getItem('probquest.theme') || 'auto', nx = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto'; try { storage.setItem('probquest.theme', nx); } catch (e) { /* ignore */ } applyTheme(); renderNav(); break; }
      case 'learn': { const [t, l] = arg.split(':'); startLearn(t, l ? +l : 0); break; }
      case 'pick': QS.sel = +arg; viewPlay(); { const b = main.querySelector('[data-act="submit"]'); if (b) b.focus(); } break;
      case 'submit': submitAnswer(false); break;
      case 'hint': if (QS.hints < 3) { QS.hints++; viewPlay(); } break;
      case 'next': SES.i++; nextQuestion(); break;
      case 'retry': presentQuestion(QS.q, true); viewPlay(); break;
      case 'end': confirmModal('Leave this session?', 'Answers already given are saved.', 'Leave', 'end-yes'); break;
      case 'end-yes': closeModal(); finishSession(); break;
      case 'review-missed': { const ids = SES.res.filter(r => !r.ok).map(r => r.qid); startSession({ mode: 'revision', navKey: 'revision', title: 'Review of missed questions', ids }); break; }
      case 'start-challenge': { const c = V.cfg; startSession({ mode: 'challenge', title: 'Challenge', plan: () => eng.planMixed(c.chN, { scope: c.chScope }), timed: c.chTimed }); break; }
      case 'start-weak': { if (eng.weaknessPlan(1).picks.length) startSession({ mode: 'weakness', title: 'Weakness practice', plan: () => eng.weaknessPlan(10) }); else toast('No questions available yet'); break; }
      case 'start-rev': startRevision(false); break;
      case 'start-rev-early': startRevision(true); break;
      case 'start-daily': { const key = E.dayKey(Date.now()); startSession({ mode: 'daily', title: 'Daily challenge', ids: eng.dailySet(key), dailyKey: key }); break; }
      case 'start-exam': startExam(); break;
      case 'xpick': EX.ans[EX.ids[EX.i]] = +arg; viewExamRun(); break;
      case 'xgo': EX.i = +arg; viewExamRun(); break;
      case 'xprev': EX.i--; viewExamRun(); break;
      case 'xnext': EX.i++; viewExamRun(); break;
      case 'xflag': EX.flag[EX.ids[EX.i]] = !EX.flag[EX.ids[EX.i]]; viewExamRun(); break;
      case 'xsubmit': {
        const un = EX.ids.filter(id => EX.ans[id] == null && !((EX.typed[id] || '').trim())).length;
        modal(`<h3>Submit the exam?</h3><p>${un ? un + ' question' + (un > 1 ? 's are' : ' is') + ' unanswered. ' : 'All questions are answered. '}You cannot change answers after submitting.</p><div class="row" style="margin-top:16px"><button class="btn ghost" data-act="close">Keep working</button><span class="sp"></span><button class="btn pri" data-act="xsubmit-yes">Submit</button></div>`); break;
      }
      case 'xsubmit-yes': submitExam(false); break;
      case 'libopen': V.lib.open = arg; render(); window.scrollTo(0, 0); break;
      case 'libback': V.lib.open = null; render(); break;
      case 'libmore': V.lib.shown += 40; renderLibList(); break;
      case 'libpractise': startSession({ mode: 'learn', navKey: 'library', title: 'Practice: ' + arg, ids: [arg] }); break;
      case 'export': {
        const blob = new Blob([eng.exportJSON()], { type: 'application/json' }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'probquest-progress-' + E.dayKey(Date.now()) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); break;
      }
      case 'import': $('#impfile').click(); break;
      case 'reset': confirmModal('Reset all progress?', 'This deletes every attempt, XP, mastery estimate and achievement stored in this browser. It cannot be undone; consider exporting first.', 'Reset everything', 'reset-yes'); break;
      case 'reset-yes': eng.reset(); lastRank = eng.rank().name; closeModal(); toast('Progress reset'); go('home'); break;
    }
  }
  function startRevision(early) {
    const list = eng.dueList(early).slice(0, 10).map(d => d.id);
    if (!list.length) { toast('Nothing to revise yet'); return; }
    startSession({ mode: 'revision', title: 'Revision', ids: list });
  }
  function applyTheme() {
    const th = storage.getItem('probquest.theme') || 'auto';
    if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
  }
  window.PQ_APP = { eng, V, go, startSession };   // exposed for the automated end-to-end tests
  applyTheme(); render();
})();

