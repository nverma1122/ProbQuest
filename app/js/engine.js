/* ProbQuest engine: progress store, scoring, mastery model, adaptive selection, spaced revision.
   Pure logic (no DOM) so it can be unit-tested in Node.  Usage: PQ_ENGINE.create(data, storage) */
(function (root) {
  'use strict';
  const DAY = 864e5;
  const DIFF_NAME = ['', 'Foundational', 'Intermediate', 'Advanced'];
  const HINT_FACTOR = [1, 0.75, 0.55, 0.4];            // credit kept when 0..3 hints were used
  const BASE_XP = [0, 10, 20, 35];
  const BOX_DAYS = [1, 1, 3, 7, 14, 30];              // Leitner intervals (days) for boxes 0..5
  const RANKS = [[0, 'Apprentice'], [250, 'Associate'], [700, 'Analyst'], [1500, 'Senior analyst'], [3000, 'Fellow'], [5000, 'Laureate']];
  const NEED = [0, 3, 4, 3];                          // evidence required per difficulty before it counts fully
  const WTS = [0, 0.20, 0.35, 0.45];                  // contribution of each difficulty to the mastery index
  const RAPID_MS = 4000;
  const DAY_SOFT_CAP = 400;                           // XP per calendar day before returns diminish

  const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(arr, rand) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function parseNumber(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/,/g, '').replace(/\s+/g, '').replace(/−/g, '-');
    if (!s) return NaN;
    if (/^-?(\d+\.?\d*|\.\d+)%$/.test(s)) return parseFloat(s) / 100;
    const m = s.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (m) return +m[2] === 0 ? NaN : +m[1] / +m[2];
    if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return parseFloat(s);
    return NaN;
  }
  function toleranceOf(q) {
    if (q.tol != null) return q.tol;
    if (q.fmt === 'i') return 1e-9;
    const a = Math.abs(q.answer.value);
    return a <= 1 ? Math.min(0.0006, a * 0.02) : a * 0.005 + 0.01;
  }

  /* ---------- optional additional question packs (window.PQ_EXTRA) ----------
     A pack is an array of questions in the shipped schema.  Each one is validated before it is accepted; a bad question
     is rejected with a reason and never reaches a student, and the rest of the pack still loads. */
  function validateQuestion(q, topics, ids) {
    if (!q || typeof q !== 'object') return 'not an object';
    if (typeof q.id !== 'string' || !/^[A-Za-z0-9_-]{3,24}$/.test(q.id)) return 'missing or malformed id';
    if (ids.has(q.id)) return 'duplicate id';
    if (!topics.has(q.topic)) return 'unknown topic';
    if (![1, 2, 3].includes(q.diff)) return 'difficulty must be 1, 2 or 3';
    if (q.kind !== 'mcq' && q.kind !== 'num') return 'unsupported question kind';
    if (typeof q.stem !== 'string' || q.stem.trim().length < 12) return 'stem is missing or too short';
    if ('src' in q || 'source' in q || 'book' in q || 'attribution' in q) return 'carries source information';
    if (!q.answer || q.answer.display == null || String(q.answer.display).trim() === '') return 'no answer';
    if (!Array.isArray(q.hints) || q.hints.length !== 3 || q.hints.some(h => typeof h !== 'string' || h.trim().length < 15)) return 'needs exactly three real hints';
    if (!Array.isArray(q.solution) || !q.solution.length || q.solution.some(s => typeof s !== 'string' || !s.trim())) return 'no worked solution';
    if (q.kind === 'num') { if (typeof q.answer.value !== 'number' || !isFinite(q.answer.value)) return 'numeric answer is not a finite number'; }
    else {
      const o = q.options;
      if (!Array.isArray(o) || o.length < 3 || o.length > 6) return 'multiple choice needs 3 to 6 options';
      if (o.filter(x => x && x.correct).length !== 1) return 'exactly one option must be marked correct';
      if (new Set(o.map(x => String(x.text).trim())).size !== o.length) return 'duplicate option text';
      if (o.some(x => !x.correct && (!x.why || String(x.why).length < 20))) return 'each wrong option needs an explanation';
    }
    return '';
  }
  function mergePacks(data, pack) {
    const list = Array.isArray(pack) ? pack : (pack && Array.isArray(pack.questions) ? pack.questions : []);
    const topics = new Set(data.topics.map(t => t.id)), ids = new Set(data.questions.map(q => q.id));
    const rejected = []; let added = 0;
    list.forEach(q => {
      const why = validateQuestion(q, topics, ids);
      if (why) { rejected.push({ id: q && q.id, why }); return; }
      if (!q.fam) q.fam = q.topic;
      data.questions.push(q); ids.add(q.id); added++;
    });
    return { added, rejected };
  }

  function create(data, storage, nowFn) {
    const now = nowFn || (() => Date.now());
    const KEY = 'probquest.v2';
    const Q = {}; data.questions.forEach(q => { Q[q.id] = q; });
    const TOP = {}; data.topics.forEach(t => { TOP[t.id] = t; });
    const byTopic = {}; data.topics.forEach(t => { byTopic[t.id] = []; });
    data.questions.forEach(q => byTopic[q.topic].push(q));

    let S = fresh();
    function fresh() { return { v: 2, created: now(), att: [], q: {}, lvl: {}, xp: 0, rs: 0, rsBest: 0, days: [], daily: { done: {}, streak: 0, best: 0 }, ach: {}, bests: {}, set: {}, adv: {}, sess: 0, games: 0, srv: {} }; }
    function load() {
      try { const raw = storage.getItem(KEY); if (raw) { const o = JSON.parse(raw); if (o && o.v === 2) S = Object.assign(fresh(), o); } } catch (e) { /* ignore */ }
      return S;
    }
    let lastSaveError = null;
    function save() { try { storage.setItem(KEY, JSON.stringify(S)); lastSaveError = null; return true; } catch (e) { lastSaveError = e; return false; } }
    function reset() { S = fresh(); save(); }
    function exportJSON() { return JSON.stringify(S); }
    function importJSON(txt) { const o = JSON.parse(txt); if (!o || o.v !== 2 || !Array.isArray(o.att)) throw new Error('Not a ProbQuest progress file'); S = Object.assign(fresh(), o); prune(); save(); }

    /* ---------- attempts & scoring ---------- */
    function seenState(qid) { return S.q[qid] || null; }
    function attemptScore(a) { return a.ok ? HINT_FACTOR[Math.min(a.h, 3)] : 0; }
    function award(q, ok, hints, ms, retry, mode) {
      if (retry) return { xp: 0, why: 'retry' };
      const st = S.q[q.id], t = now();
      const rapid = ms < RAPID_MS * (q.diff === 1 ? 0.6 : 1);
      let xp = BASE_XP[q.diff];
      let why = '';
      if (ok) {
        xp *= HINT_FACTOR[Math.min(hints, 3)];
        if (hints === 0) { xp *= 1.25; why = 'independent'; }
        if (rapid) { xp *= 0.25; why = 'rapid'; }
        else if (S.rs >= 3) xp *= 1 + Math.min(0.2, 0.02 * S.rs);
      } else {
        xp = (!st || t - st.last > DAY) ? 2 : 0; why = 'effort';
      }
      if (st && t - st.last < DAY && mode !== 'exam') xp *= 0.25;   // limits farming a single question
      const dk = dayKey(t), today = S.xpDay && S.xpDay.k === dk ? S.xpDay.v : 0;
      if (today >= DAY_SOFT_CAP) { xp *= 0.25; why = why || 'cap'; }   // diminishing returns after a long day
      return { xp: Math.round(xp), why, rapid };
    }

    function recordAttempt(o) {
      // o: {qid, ok, ms, hints, mode, retry, choice}
      const q = Q[o.qid]; if (!q) throw new Error('unknown question ' + o.qid);
      const t = now(), hints = Math.min(o.hints || 0, 3), ms = Math.max(0, o.ms || 0);
      const res = award(q, !!o.ok, hints, ms, !!o.retry, o.mode);
      const rapid = !!res.rapid;
      S.att.push({ q: q.id, t, ok: o.ok ? 1 : 0, ms: Math.round(ms), h: hints, m: o.mode || 'learn', r: o.retry ? 1 : 0, rp: rapid ? 1 : 0, c: o.choice == null ? null : String(o.choice).slice(0, 40) });
      if (S.att.length > 4000) S.att.splice(0, S.att.length - 4000);
      if (!o.retry) {
        const st = S.q[q.id] || (S.q[q.id] = { n: 0, ok: 0, miss: 0, box: 0, due: t, last: 0 });
        st.n++; st.last = t;
        if (o.ok) {
          st.ok++;
          if (hints === 0 && !rapid) st.box = Math.min(5, Math.max(st.box, 1) + (st.n === 1 ? 1 : 1));
          else if (hints <= 1) st.box = Math.max(st.box, 1);
          st.due = t + BOX_DAYS[st.box] * DAY;
          st.corrected = 1;
        } else { st.miss++; st.box = 0; st.due = t + DAY; st.corrected = 0; }
        // reasoning streak: consecutive correct, unhurried, answers on first attempts
        if (o.ok && !rapid && hints <= 1) { S.rs++; S.rsBest = Math.max(S.rsBest, S.rs); } else if (!o.ok || rapid) S.rs = 0;
        updateLevel(q.topic);
        if (!S.days.includes(dayKey(t))) { S.days.push(dayKey(t)); if (S.days.length > 400) S.days.shift(); }
      }
      S.xp += res.xp;
      { const dk = dayKey(t); if (!S.xpDay || S.xpDay.k !== dk) S.xpDay = { k: dk, v: 0 }; S.xpDay.v += res.xp; }
      checkAchievements();
      save();
      return res;
    }

    /* ---------- mastery model ---------- */
    function topicAttempts(tid) { const ids = new Set(byTopic[tid].map(q => q.id)); return S.att.filter(a => !a.r && ids.has(a.q)); }
    function mastery(tid) {
      const atts = topicAttempts(tid);
      const per = [null, [], [], []];
      for (const a of atts) per[Q[a.q].diff].push(a);
      const s = [0, 0, 0, 0], n = [0, 0, 0, 0], dayset = new Set();
      for (let d = 1; d <= 3; d++) {
        const last = per[d].slice(-10).reverse();      // newest first
        let num = 0, den = 0;
        last.forEach((a, age) => { const r = Math.pow(0.9, age), w = (a.rp ? 0.5 : 1) * r; num += w * attemptScore(a); den += w; });
        const prior = 1.5;
        s[d] = (num + prior * 0.5) / (den + prior);
        n[d] = per[d].length;
      }
      atts.forEach(a => dayset.add(dayKey(a.t)));
      let M = 0; for (let d = 1; d <= 3; d++) M += WTS[d] * s[d] * Math.min(1, n[d] / NEED[d]);
      const total = n[1] + n[2] + n[3];
      let label = 'Not started';
      if (total > 0) label = 'Beginning';
      if (M >= 0.35 && total >= 3) label = 'Developing';
      if (M >= 0.6 && n[2] >= 3) label = 'Proficient';
      if (M >= 0.8 && n[2] >= 3 && n[3] >= 3 && dayset.size >= 2) label = 'Mastered';
      const ok = atts.filter(a => a.ok).length;
      return { M, label, n, s, total, acc: total ? ok / total : null, days: dayset.size };
    }
    const LABEL_RANK = { 'Not started': 0, Beginning: 1, Developing: 2, Proficient: 3, Mastered: 4 };

    /* ---------- adaptive level per topic ---------- */
    function unlockedAdvanced(tid) {
      if (S.adv[tid]) return true;
      const m = mastery(tid);
      return (m.n[2] + m.n[3]) >= 4 && m.s[2] >= 0.6;
    }
    function currentLevel(tid) { let l = S.lvl[tid] || 1; if (l === 3 && !unlockedAdvanced(tid)) l = 2; return l; }
    function updateLevel(tid) {
      const recent = topicAttempts(tid).filter(a => !a.rp).slice(-3);
      let l = S.lvl[tid] || 1;
      if (recent.length === 3 && recent.every(a => a.ok && a.h <= 1)) l = Math.min(3, l + 1);
      else if (recent.length >= 3 && recent.filter(a => !a.ok).length >= 2) l = Math.max(1, l - 1);
      if (l === 3 && !unlockedAdvanced(tid)) l = 2;
      S.lvl[tid] = l;
    }
    function weakPrereqs(tid) {
      const out = [];
      (TOP[tid].pre || []).forEach(p => { const m = mastery(p); if (LABEL_RANK[m.label] < 3) out.push({ id: p, label: m.label, M: m.M }); });
      return out;
    }
    function struggling(tid) {
      const r = topicAttempts(tid).slice(-6);
      return r.length >= 4 && r.filter(a => a.ok).length / r.length < 0.5;
    }

    /* ---------- repetition control ----------
       One history (S.srv: question id -> last game, time, count) is shared by every mode, so a question served by
       Learn is also held back from Challenge, Exam, Weakness practice and the daily set.  A "game" is one session or exam.
       Rules, in order of priority:
         1. never repeat a question inside a game;
         2. keep a question out of the eligible pool for `cooldownGames` games after it was served;
         3. avoid the problem-structure family of the last few questions served;
         4. when the eligible pool is too small, widen it (other difficulties/topics) before reusing anything;
         5. only if the whole bank for the request is exhausted, reuse the least recently served questions and say so.
       Questions you got wrong come back deliberately (Revision mode, or a labelled revisit in Learn), not by accident. */
    const CFG = { cooldownGames: 5, familyWindow: 2, revisitMinGames: 2, revisitEvery: 5 };
    let G = null;                                   // the game in progress (memory only; the history persists)
    function beginGame(mode) {
      S.games = (S.games || 0) + 1;
      G = { g: S.games, mode: mode || 'learn', served: new Set(), fams: [] };
      save();
      return G.g;
    }
    function game() { if (!G) beginGame('learn'); return G; }
    function markServed(qid) {
      const q = Q[qid]; if (!q) return;
      const g = game();
      const st = S.srv[qid] || (S.srv[qid] = { g: 0, t: 0, n: 0 });
      st.g = g.g; st.t = now(); st.n++;
      g.served.add(qid); g.fams.push(q.fam || q.topic);
    }
    function ageOf(qid) { const s = S.srv[qid]; return s ? S.games - s.g : Infinity; }   // games since last served

    /* choose one question from `cands`; returns {q, reason} with reason fresh | relaxed | exhausted */
    function chooseOne(cands, o) {
      o = o || {};
      const g = game(), rand = o.rand || Math.random;
      const ex = o.exclude;
      let pool = cands.filter(q => !g.served.has(q.id) && !(ex && ex.has(q.id)));
      let reason = 'fresh';
      if (!pool.length) {                           // nothing unused in this game: reuse the least recently served
        pool = cands.filter(q => !(ex && ex.has(q.id)));
        if (!pool.length) return null;
        reason = 'exhausted';
      }
      const cool = pool.filter(q => ageOf(q.id) > CFG.cooldownGames);
      if (cool.length) pool = cool;
      else {
        if (reason === 'fresh') reason = 'relaxed';
        pool = pool.slice().sort((a, b) => ageOf(b.id) - ageOf(a.id));
        pool = pool.slice(0, Math.max(3, Math.ceil(pool.length * 0.25)));
      }
      const recent = (o.recentFams || g.fams).slice(-CFG.familyWindow);
      const varied = pool.filter(q => !recent.includes(q.fam));
      if (varied.length) pool = varied;
      /* weight: favour questions never served, served fewest times, and unseen for longest (even exposure across the bank) */
      const w = pool.map(q => {
        const a = ageOf(q.id), st = S.srv[q.id], n = st ? st.n : 0;
        let x = (a === Infinity ? 3 : 1 + Math.min(a, 40) / 20) / Math.pow(1 + n, 1.5);
        if (o.level) x /= 1 + Math.abs(q.diff - o.level);
        if (o.weight) x *= o.weight(q);
        return x;
      });
      let r = rand() * w.reduce((s, v) => s + v, 0), i = 0;
      while (i < pool.length - 1 && (r -= w[i]) > 0) i++;
      return { q: pool[i], reason };
    }

    /* ---------- selection ---------- */
    function pool(tid, excl) { return (tid ? byTopic[tid] : data.questions).filter(q => !(excl && excl.has(q.id))); }
    function pickLearnEx(tid, excl, level) {
      const lvl = level || currentLevel(tid);
      const all = pool(tid, excl);
      if (!all.length) return null;
      S.sess = (S.sess || 0) + 1;
      if (S.sess % CFG.revisitEvery === 0) {        // a deliberate, labelled revisit of a missed question that is due
        const t = now(), g = game();
        const due = all.filter(q => { const st = S.q[q.id]; return st && st.corrected !== 1 && st.due <= t && ageOf(q.id) >= CFG.revisitMinGames && !g.served.has(q.id); });
        if (due.length) { const r = chooseOne(due, { level: lvl }); if (r) return { q: r.q, reason: 'revisit' }; }
      }
      let cands = all.filter(q => q.diff <= lvl); if (!cands.length) cands = all;
      /* a small level pool would be replayed every session: allow one level of stretch.  chooseOne weights by distance from
         the current level and by how often a question was served, so stretch questions are mixed in as the easier ones wear out */
      if (lvl < 3 && (lvl + 1 < 3 || level || unlockedAdvanced(tid))) {
        const up = all.filter(q => q.diff <= lvl + 1); if (up.length > cands.length) cands = up;
      }
      return chooseOne(cands, { level: lvl });
    }
    function pickLearn(tid, excl, level) { const r = pickLearnEx(tid, excl, level); return r ? r.q : null; }

    /* 25 / 45 / 30 difficulty blueprint with largest-remainder rounding and random tie-breaks, so the long-run mix is exact */
    function blueprint(n, rand) {
      rand = rand || Math.random;
      const share = [0.25, 0.45, 0.30], base = share.map(s => Math.floor(s * n + 1e-9)), rem = share.map((s, i) => s * n - base[i] + rand() * 1e-6);
      let left = n - base.reduce((x, y) => x + y, 0);
      while (left-- > 0) { let k = 0; for (let i = 1; i < 3; i++) if (rem[i] > rem[k]) k = i; base[k]++; rem[k] = -1; }
      const plan = []; base.forEach((c, i) => { for (let j = 0; j < c; j++) plan.push(i + 1); });
      return plan;
    }
    /* a mixed set (Challenge, Exam): 25/45/30 difficulty blueprint, topics balanced and rotated, history-aware */
    function planMixed(n, o) {
      o = o || {};
      const rand = o.seed != null ? rng(hash('pq-mix-' + o.seed)) : Math.random;
      const topics = o.scope ? [o.scope] : data.topics.map(t => t.id);
      const use = {}; topics.forEach(t => { use[t] = 0; });
      const topicAge = t => Math.min(...byTopic[t].map(q => ageOf(q.id)));
      const used = new Set(), ids = []; let relaxed = 0;
      for (const d of shuffle(blueprint(n, rand), rand)) {
        // every question of the required difficulty competes; topics already used in this set are down-weighted so
        // the set spreads across topics, and topics not served for the longest are favoured
        const fams = ids.map(id => Q[id].fam);
        const tw = t => Math.pow(1 + use[t], -2) * (1 + Math.min(topicAge(t), 12) / 6);
        // topic first (weighted towards topics used least in this set and served longest ago), among topics that still
        // have a question of this difficulty outside the cooldown; then the question, favouring low exposure
        const fresh = t => byTopic[t].filter(q => q.diff === d && !used.has(q.id) && !game().served.has(q.id) && ageOf(q.id) > CFG.cooldownGames);
        let avail = topics.filter(t => fresh(t).length);
        if (!avail.length) avail = topics.filter(t => byTopic[t].some(q => q.diff === d && !used.has(q.id)));
        let pick = null;
        if (avail.length) {
          const wts = avail.map(tw); let r = rand() * wts.reduce((s, v) => s + v, 0), k = 0;
          while (k < avail.length - 1 && (r -= wts[k]) > 0) k++;
          pick = chooseOne(byTopic[avail[k]].filter(q => q.diff === d), { rand, exclude: used, recentFams: fams });
        }
        if (!pick || pick.reason !== 'fresh') {       // widen to neighbouring difficulties before reusing anything
          const wide = chooseOne(pool(o.scope, used).filter(q => Math.abs(q.diff - d) <= 1 && q.diff !== d), { rand, exclude: used, recentFams: fams, weight: q => tw(q.topic), level: d });
          if (wide && (wide.reason === 'fresh' || !pick)) pick = wide;
        }
        if (!pick) pick = chooseOne(pool(o.scope, used), { rand, exclude: used, recentFams: fams, level: d });
        if (pick) { used.add(pick.q.id); ids.push(pick.q.id); use[pick.q.topic]++; if (pick.reason !== 'fresh') relaxed++; }
      }
      return { ids, relaxed };
    }
    function weakTopics() {
      const list = data.topics.map(t => ({ id: t.id, m: mastery(t.id) })).filter(x => x.m.total >= 3);
      list.sort((a, b) => a.m.M - b.m.M);
      return list;
    }
    function weaknessPlan(count, excl) {
      const wt = weakTopics().filter(x => LABEL_RANK[x.m.label] < 4).slice(0, 2);
      const topics = [];
      wt.forEach(x => { topics.push(x.id); const pr = weakPrereqs(x.id).filter(p => mastery(p.id).total < 6)[0]; if (pr && !topics.includes(pr.id)) topics.push(pr.id); });
      if (!topics.length) return { topics: [], picks: [], relaxed: 0 };
      const used = new Set(excl || []), ids = []; let relaxed = 0;
      // replenishment order: the next weakest attempted topics, then everything else, weakest first
      const extra = weakTopics().map(x => x.id).concat(data.topics.map(t => t.id)).filter((id, i, a) => !topics.includes(id) && a.indexOf(id) === i);
      for (let i = 0; ids.length < count && i < count * 4; i++) {
        const tid = topics[i % topics.length];
        const lvl = Math.max(1, currentLevel(tid) - (struggling(tid) ? 1 : 0));
        const fams = ids.map(id => Q[id].fam);
        let c = byTopic[tid].filter(q => q.diff <= lvl && !used.has(q.id)); if (!c.length) c = byTopic[tid].filter(q => !used.has(q.id));
        let r = c.length ? chooseOne(c, { level: lvl, exclude: used, recentFams: fams }) : null;
        if (!r || r.reason !== 'fresh') {
          for (const e of extra) {
            const ce = byTopic[e].filter(q => q.diff <= lvl && !used.has(q.id));
            const r2 = ce.length ? chooseOne(ce, { level: lvl, exclude: used, recentFams: fams }) : null;
            if (r2 && r2.reason === 'fresh') { r = r2; break; }
          }
        }
        if (r) { used.add(r.q.id); ids.push(r.q.id); if (r.reason !== 'fresh') relaxed++; }
      }
      return { topics, picks: ids, relaxed };
    }
    function dueList(includeEarly) {
      const t = now();
      const arr = Object.entries(S.q).filter(([id, st]) => Q[id] && (includeEarly || st.due <= t)).map(([id, st]) => ({ id, due: st.due, box: st.box, miss: st.miss }));
      arr.sort((a, b) => a.box - b.box || a.due - b.due);
      return arr;
    }
    function nextDue() {
      const t = now();
      const fut = Object.values(S.q).filter(st => st.due > t).map(st => st.due);
      return fut.length ? Math.min(...fut) : null;
    }
    /* Daily challenge: identical for everyone on a date, five different topics, and each topic walks through its own
       seeded permutation of advanced-leaning questions, so a question does not return until its topic's list is used up. */
    function dailySet(key) {
      const day = Math.floor(Date.parse(key + 'T00:00:00Z') / DAY), T = data.topics.length, ids = [];
      for (let j = 0; j < 5; j++) {
        const idx = day * 5 + j, tid = data.topics[idx % T].id;
        let list = byTopic[tid].filter(q => q.diff >= 2).sort((a, b) => (a.id < b.id ? -1 : 1));
        if (!list.length) list = byTopic[tid].slice().sort((a, b) => (a.id < b.id ? -1 : 1));
        const nth = Math.floor(idx / T), cycle = Math.floor(nth / list.length);
        const perm = shuffle(list, rng(hash('pq-daily-' + tid + ':' + cycle)));
        if (cycle > 0 && list.length > 1) {          // the closing questions of one cycle must not open the next
          const prev = shuffle(list, rng(hash('pq-daily-' + tid + ':' + (cycle - 1))));
          if (list.length >= 8) {
            // swap any of the first three that also closed the previous cycle with a middle entry (the last three are never moved)
            const bad = new Set(prev.slice(-3).map(x => x.id)), lo = Math.floor(list.length / 2), hi = list.length - 3;
            for (let i = 0; i < 3; i++) {
              if (!bad.has(perm[i].id)) continue;
              for (let k = lo; k < hi; k++) if (!bad.has(perm[k].id) && k !== i) { const x = perm[i]; perm[i] = perm[k]; perm[k] = x; break; }
            }
          } else if (perm[0].id === prev[prev.length - 1].id) { const x = perm[0]; perm[0] = perm[1]; perm[1] = x; }
        }
        ids.push(perm[nth % list.length].id);
      }
      return ids;
    }
    function examSet(n, key) { return planMixed(n, { seed: key }).ids; }

    /* ---------- daily practice and achievements ---------- */
    function dailyStatus(key) {
      const k = key || dayKey(now());
      return S.daily.done[k] || null;
    }
    function recordDaily(key, score, total, ids) {
      S.daily.done[key] = { score, total, ids, t: now() };
      const streak = runEndingAt(Object.keys(S.daily.done).sort().pop());
      S.daily.streak = streak; S.daily.best = Math.max(S.daily.best, streak);
      checkAchievements(); save();
      return streak;
    }
    function runEndingAt(key) {
      let n = 0, d = new Date(key + 'T12:00:00');
      while (S.daily.done[dayKey(d.getTime())]) { n++; d = new Date(d.getTime() - DAY); }
      return n;
    }
    function dailyStreak() {   // current streak: zero once a whole day has been missed
      const last = Object.keys(S.daily.done).sort().pop();
      if (!last || last < dayKey(now() - DAY)) return 0;
      return runEndingAt(last);
    }
    function practiceStreak() {
      const days = new Set(S.days); let d = now(), n = 0;
      if (!days.has(dayKey(d))) d -= DAY;
      while (days.has(dayKey(d))) { n++; d -= DAY; }
      return n;
    }
    const ACH = [
      { id: 'first', n: 'First steps', d: 'Answer your first question.', f: s => s.att.some(a => !a.r) },
      { id: 'indep10', n: 'Independent thinker', d: 'Ten correct answers with no hints.', f: s => s.att.filter(a => a.ok && !a.h && !a.r).length >= 10 },
      { id: 'breadth', n: 'Broad foundations', d: 'Attempt questions in all nine topics.', f: s => new Set(s.att.map(a => Q[a.q] && Q[a.q].topic)).size >= data.topics.length },
      { id: 'rs8', n: 'Careful reasoner', d: 'Eight correct first attempts in a row without rushing.', f: s => s.rsBest >= 8 },
      { id: 'adv5', n: 'Advanced practitioner', d: 'Five correct advanced questions without hints.', f: s => s.att.filter(a => a.ok && !a.h && !a.r && Q[a.q] && Q[a.q].diff === 3).length >= 5 },
      { id: 'diag5', n: 'Diagnostician', d: 'Correctly diagnose five flawed-reasoning questions.', f: s => new Set(s.att.filter(a => a.ok && !a.r && Q[a.q] && Q[a.q].diag).map(a => a.q)).size >= 5 },
      { id: 'bayes', n: 'Bayesian reasoning', d: 'Reach Proficient in Total probability and Bayes.', f: s => LABEL_RANK[masteryOf(s, 'bayes').label] >= 3 },
      { id: 'cond', n: 'Conditioning mastered', d: 'Reach Proficient in Conditional probability.', f: s => LABEL_RANK[masteryOf(s, 'cond').label] >= 3 },
      { id: 'revision', n: 'Turned around', d: 'Correct five questions you had previously missed.', f: s => Object.values(s.q).filter(x => x.miss > 0 && x.corrected === 1 && x.ok > 0).length >= 5 },
      { id: 'exam70', n: 'Exam ready', d: 'Score at least 70% in an exam-mode test.', f: s => (s.bests.exam || 0) >= 0.7 },
      { id: 'week', n: 'Consistency', d: 'Practise on seven different days.', f: s => s.days.length >= 7 },
      { id: 'daily3', n: 'Daily discipline', d: 'Complete three Daily Challenges.', f: s => Object.keys(s.daily.done).length >= 3 }
    ];
    function masteryOf(s, tid) { const keep = S; S = s; try { return mastery(tid); } finally { S = keep; } }
    function checkAchievements() {
      const got = [];
      for (const a of ACH) if (!S.ach[a.id] && a.f(S)) { S.ach[a.id] = now(); got.push(a); }
      return got;
    }
    function rank() {
      let i = 0; for (let k = 0; k < RANKS.length; k++) if (S.xp >= RANKS[k][0]) i = k;
      const cur = RANKS[i], nxt = RANKS[i + 1] || null;
      return { name: cur[1], xp: S.xp, next: nxt ? nxt[1] : null, need: nxt ? nxt[0] : null, pct: nxt ? (S.xp - cur[0]) / (nxt[0] - cur[0]) : 1 };
    }
    function overall() {
      const att = S.att.filter(a => !a.r);
      const first = att.length;
      const ok = att.filter(a => a.ok).length;
      const byD = [null, [0, 0], [0, 0], [0, 0]];
      att.forEach(a => { const d = Q[a.q] ? Q[a.q].diff : 1; byD[d][1]++; if (a.ok) byD[d][0]++; });
      const hintRate = first ? att.filter(a => a.h > 0).length / first : 0;
      const ms = att.map(a => a.ms).sort((x, y) => x - y);
      const med = ms.length ? ms[Math.floor(ms.length / 2)] : 0;
      return { n: first, ok, acc: first ? ok / first : 0, byD, hintRate, medianMs: med, independent: att.filter(a => a.ok && !a.h).length };
    }
    function activity(daysBack) {
      const out = []; const t = now();
      for (let i = daysBack - 1; i >= 0; i--) {
        const k = dayKey(t - i * DAY);
        const a = S.att.filter(x => !x.r && dayKey(x.t) === k);
        out.push({ day: k, n: a.length, ok: a.filter(x => x.ok).length });
      }
      return out;
    }

    /* attempts recorded against questions that are no longer in the bank (for example after a revision of the bank) are dropped */
    function prune() {
      const before = S.att.length;
      S.att = S.att.filter(a => Q[a.q]);
      Object.keys(S.q).forEach(id => { if (!Q[id]) delete S.q[id]; });
      Object.keys(S.srv || {}).forEach(id => { if (!Q[id]) delete S.srv[id]; });
      Object.keys(S.daily.done).forEach(k => { S.daily.done[k].ids = (S.daily.done[k].ids || []).filter(id => Q[id]); });
      return before - S.att.length;
    }

    load(); if (prune()) save();
    return {
      data, Q, TOP, byTopic, get state() { return S; }, save, reset, exportJSON, importJSON, load, get saveError() { return lastSaveError; },
      recordAttempt, mastery, topicAttempts, currentLevel, updateLevel, unlockedAdvanced, weakPrereqs, struggling,
      pickLearn, pickLearnEx, planMixed, weakTopics, weaknessPlan, dueList, nextDue, dailySet, examSet,
      beginGame, markServed, ageOf, chooseOne, CFG, get game() { return G; }, dailyStatus, recordDaily, dailyStreak, practiceStreak,
      ACH, checkAchievements, rank, overall, activity, award, LABEL_RANK,
      setAdvanced(tid, v) { S.adv[tid] = !!v; save(); },
      setBest(k, v) { if (!(S.bests[k] >= v)) { S.bests[k] = v; save(); return true; } return false; }
    };
  }

  root.PQ_ENGINE = { create, validateQuestion, mergePacks, parseNumber, toleranceOf, DIFF_NAME, HINT_FACTOR, BASE_XP, BOX_DAYS, RANKS, dayKey, hash, rng, shuffle };
  if (typeof module !== 'undefined') module.exports = root.PQ_ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
