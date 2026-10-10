'use strict';
/* Repetition-prevention simulations and assertions.   node tests/sim_repeat.js [--json]
   Plays many games in every mode against the real engine (the same functions the application calls) and measures
   within-game repeats, repeats inside the cooldown window, coverage, topic/difficulty balance and structure adjacency. */
const path = require('path');
global.window = {}; require(path.join(__dirname, '../app/data/qbank.js'));
const E = require('../app/js/engine.js');
const D = window.PQ_DATA;
let pass = 0, fail = 0; const report = {};
const ok = (c, name) => { if (c) pass++; else { fail++; console.log('FAIL  ' + name); } };
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, size: () => Object.values(m).reduce((s, x) => s + x.length, 0) }; }
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const Q = {}; D.questions.forEach(q => { Q[q.id] = q; });
const CD = 5;
Math.random = seeded(20260110);                       // the engine draws from Math.random: fix it so the run is reproducible

/* one game in a given mode, as the application does it: begin the game, plan, then serve and answer */
function play(eng, mode, clock, arg, rnd) {
  const gid = eng.beginGame(mode); let ids = [], flags = { relaxed: 0, exhausted: 0, revisit: 0 };
  if (mode === 'learn') {
    const seen = new Set();
    for (let i = 0; i < (arg.n || 10); i++) {
      const r = eng.pickLearnEx(arg.topic, seen, arg.level); if (!r) break;
      if (r.reason === 'relaxed') flags.relaxed++; if (r.reason === 'exhausted') flags.exhausted++; if (r.reason === 'revisit') flags.revisit++;
      seen.add(r.q.id); ids.push(r.q.id); eng.markServed(r.q.id);
      eng.recordAttempt({ qid: r.q.id, ok: rnd() < 0.62, ms: 20000, hints: 0, mode });
    }
    return { gid, ids, flags };
  }
  if (mode === 'challenge') { const p = eng.planMixed(arg.n || 10, { scope: arg.scope || '' }); ids = p.ids; flags.relaxed = p.relaxed; }
  else if (mode === 'exam') { const p = eng.planMixed(arg.n || 10); ids = p.ids; flags.relaxed = p.relaxed; }
  else if (mode === 'weakness') { const p = eng.weaknessPlan(10); ids = p.picks; flags.relaxed = p.relaxed || 0; }
  else if (mode === 'daily') ids = eng.dailySet(E.dayKey(clock.t));
  else if (mode === 'revision') ids = eng.dueList(true).slice(0, 10).map(x => x.id);
  for (const id of ids) { eng.markServed(id); eng.recordAttempt({ qid: id, ok: rnd() < 0.62, ms: 20000, hints: 0, mode }); }
  return { gid, ids, flags };
}
function metrics(games, window_) {
  let total = 0, within = 0, inWindow = 0, famAdj = 0, pairs = 0;
  const last = {}, used = new Set(), counts = {};
  games.forEach((g, gi) => {
    within += g.ids.length - new Set(g.ids).size;
    g.ids.forEach((id, k) => {
      total++; used.add(id); counts[id] = (counts[id] || 0) + 1;
      if (last[id] !== undefined && gi - last[id] <= window_) inWindow++;
      last[id] = gi;
      if (k > 0) { pairs++; if (Q[id].fam === Q[g.ids[k - 1]].fam) famAdj++; }
    });
  });
  // exposure relative to the question's own topic: a small topic is legitimately revisited more often per question
  const tServed = {}, tSize = {}; D.questions.forEach(q => { tSize[q.topic] = (tSize[q.topic] || 0) + 1; });
  Object.entries(counts).forEach(([id, c]) => { tServed[Q[id].topic] = (tServed[Q[id].topic] || 0) + c; });
  const maxRel = Math.max(...Object.entries(counts).map(([id, c]) => c / Math.max(1, tServed[Q[id].topic] / tSize[Q[id].topic])));
  return { maxRel: +maxRel.toFixed(2), games: games.length, served: total, distinct: used.size, coverage: +(used.size / D.questions.length).toFixed(3), withinGame: within,
    repeatWithinCooldown: +(inWindow / Math.max(1, total)).toFixed(3), familyAdjacency: +(famAdj / Math.max(1, pairs)).toFixed(3), maxTimes: Math.max(...Object.values(counts)) };
}

/* 1. every mode on its own, 60 games, with an application restart half-way */
for (const mode of ['learn', 'challenge', 'exam', 'weakness', 'daily']) {
  const clock = { t: Date.UTC(2026, 0, 5, 9) }, st = mem(), rnd = seeded(7);
  let eng = E.create(D, st, () => clock.t); const games = [];
  for (let g = 0; g < 60; g++) {
    if (g === 30) eng = E.create(D, st, () => clock.t);                 // restart: history reloaded from storage
    let r;
    if (mode === 'learn') r = play(eng, 'learn', clock, { topic: D.topics[g % D.topics.length].id, n: 10 }, rnd);
    else if (mode === 'weakness') { r = play(eng, 'weakness', clock, {}, rnd); if (!r.ids.length) r = play(eng, 'learn', clock, { topic: D.topics[g % D.topics.length].id, n: 10 }, rnd); }
    else r = play(eng, mode, clock, { n: 10 }, rnd);
    games.push(r); clock.t += (mode === 'daily' ? 24 : 1) * 36e5;
  }
  const m = metrics(games, mode === 'daily' ? 6 : CD); report[mode] = m;
  ok(m.withinGame === 0, `${mode}: no question repeats inside a game`);
  if (mode === 'daily') ok(m.repeatWithinCooldown === 0, `${mode}: no daily question repeats within 6 days`);
  else ok(m.repeatWithinCooldown <= (mode === 'weakness' ? 0.1 : 0.02), `${mode}: repeats within the ${CD}-game cooldown are rare (${m.repeatWithinCooldown})`);
  ok(m.coverage >= (mode === 'daily' ? 0.2 : mode === 'weakness' ? 0.3 : 0.55), `${mode}: broad coverage of the bank (${m.coverage})`);
  const avg = m.served / D.questions.length;
  ok(m.maxTimes <= 3 || m.maxRel <= (mode === 'weakness' ? 5 : 4.5), `${mode}: exposure is even, no question is over-served (max ${m.maxTimes} times, ${m.maxRel}x its topic average, bank average ${avg.toFixed(1)})`);
}

/* 2. all modes interleaved on one history (cross-mode prevention) */
{
  const clock = { t: Date.UTC(2026, 0, 5, 9) }, st = mem(), rnd = seeded(11); const eng = E.create(D, st, () => clock.t);
  const modes = ['learn', 'challenge', 'exam', 'weakness', 'learn', 'daily'], games = [];
  for (let g = 0; g < 72; g++) {
    const mode = modes[g % modes.length]; let r;
    if (mode === 'learn') r = play(eng, 'learn', clock, { topic: D.topics[g % D.topics.length].id, n: 10 }, rnd);
    else if (mode === 'weakness') { r = play(eng, 'weakness', clock, {}, rnd); if (!r.ids.length) r = play(eng, 'challenge', clock, { n: 10 }, rnd); }
    else r = play(eng, mode, clock, { n: mode === 'daily' ? 5 : 10 }, rnd);
    games.push(r); clock.t += 3 * 36e5;
  }
  // the daily set is date-seeded and deliberately identical for everyone, so it is excluded from the cooldown claim
  const plain = games.filter((g, i) => modes[i % modes.length] !== 'daily');
  const m = metrics(plain, CD - 1); report.interleaved = m;
  ok(m.withinGame === 0, 'interleaved: no repeats inside a game');
  ok(m.repeatWithinCooldown <= 0.03, `interleaved: repeats across modes inside the cooldown are rare (${m.repeatWithinCooldown})`);
}

/* 3. large history: 600 games, state stays bounded and selection stays correct */
{
  const clock = { t: Date.UTC(2026, 0, 5, 9) }, st = mem(), rnd = seeded(3); const eng = E.create(D, st, () => clock.t);
  const games = []; const t0 = Date.now();
  for (let g = 0; g < 600; g++) { games.push(play(eng, g % 2 ? 'challenge' : 'exam', clock, { n: 10 }, rnd)); clock.t += 36e5; }
  const ms = Date.now() - t0, m = metrics(games, CD); report.largeHistory = { ...m, seconds: +(ms / 1000).toFixed(1), storedChars: st.size(), historyEntries: Object.keys(eng.state.srv).length };
  ok(m.withinGame === 0, 'large history: no repeats inside a game');
  ok(Object.keys(eng.state.srv).length <= D.questions.length, 'large history: history map is bounded by the bank size');
  ok(m.repeatWithinCooldown <= 0.03, `large history: cooldown still respected after 600 games (${m.repeatWithinCooldown})`);
  ok(m.coverage >= 0.97, `large history: the whole bank is eventually used (${m.coverage})`);
}

/* 4. balance: topic and difficulty distribution of mixed sets */
{
  const clock = { t: Date.UTC(2026, 0, 5, 9) }, eng = E.create(D, mem(), () => clock.t), rnd = seeded(5);
  const topic = {}, diff = { 1: 0, 2: 0, 3: 0 }; let n = 0;
  for (let g = 0; g < 80; g++) { const r = play(eng, 'challenge', clock, { n: 10 }, rnd); r.ids.forEach(id => { topic[Q[id].topic] = (topic[Q[id].topic] || 0) + 1; diff[Q[id].diff]++; n++; }); clock.t += 36e5; }
  const shares = D.topics.map(t => (topic[t.id] || 0) / n), spread = Math.max(...shares) - Math.min(...shares);
  report.balance = { topicShares: Object.fromEntries(D.topics.map(t => [t.id, +((topic[t.id] || 0) / n).toFixed(3)])), difficulty: { 1: +(diff[1] / n).toFixed(3), 2: +(diff[2] / n).toFixed(3), 3: +(diff[3] / n).toFixed(3) } };
  ok(spread < 0.06, `balance: every topic is represented evenly in mixed sets (spread ${spread.toFixed(3)})`);
  ok(Math.abs(diff[1] / n - 0.25) < 0.04 && Math.abs(diff[2] / n - 0.45) < 0.04 && Math.abs(diff[3] / n - 0.30) < 0.04, 'balance: difficulty follows the 25/45/30 blueprint');
}

/* 5. a topic smaller than a session: no repeat inside one game; the next game reuses the least recently served, flagged */
{
  const clock = { t: Date.UTC(2026, 0, 5, 9) }, eng = E.create(D, mem(), () => clock.t), rnd = seeded(9);
  const size = t => D.questions.filter(q => q.topic === t).length;
  const tid = D.topics.slice().sort((a, b) => size(a.id) - size(b.id))[0].id, n = size(tid);
  const a = play(eng, 'learn', clock, { topic: tid, n: n + 5 }, rnd);
  ok(a.ids.length === n && new Set(a.ids).size === n, 'small topic: a game uses each question once and then ends instead of repeating');
  const b = play(eng, 'learn', clock, { topic: tid, n }, rnd);
  ok(b.ids.length === n && new Set(b.ids).size === n, 'small topic: the next game is again free of repeats');
  ok(b.flags.relaxed + b.flags.exhausted === n, 'small topic: reuse across games is flagged so the interface can say so');
  const c = eng.planMixed(10, { scope: tid }); ok(c.ids.length === Math.min(10, n) && new Set(c.ids).size === c.ids.length, 'small topic: a scoped mixed set returns fewer questions rather than repeats');
}

/* 6. recently wrong questions return deliberately: only via Revision or a labelled revisit */
{
  const clock = { t: Date.UTC(2026, 0, 5, 9) }, eng = E.create(D, mem(), () => clock.t), rnd = seeded(13);
  play(eng, 'learn', clock, { topic: 'cond', n: 8 }, () => 0.99);          // answer everything wrong
  let sameGameRepeat = 0, revisits = 0;
  for (let g = 0; g < 12; g++) {
    clock.t += 30 * 36e5;                                                    // a day passes: the misses become due
    const r = play(eng, 'learn', clock, { topic: 'cond', n: 10 }, rnd);
    sameGameRepeat += r.ids.length - new Set(r.ids).size; revisits += r.flags.revisit;
  }
  ok(sameGameRepeat === 0, 'revisit: no duplicates inside a game');
  ok(revisits > 0, `revisit: missed questions do come back through labelled revisits (${revisits})`);
  ok(eng.dueList(true).length > 0, 'revisit: Revision mode has the missed questions queued');
}

report.pass = pass; report.fail = fail;
console.log(JSON.stringify(report, null, 1));
console.log(`\nrepetition tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
