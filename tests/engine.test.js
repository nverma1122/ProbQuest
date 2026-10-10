'use strict';
/* Unit tests for the progress/adaptive/repetition engine and structural tests of the shipped bank.
   Run:  node tests/engine.test.js        (from the ProbQuest folder) */
const path = require('path');
global.window = {};
require(path.join(__dirname, '../app/data/qbank.js'));
const E = require('../app/js/engine.js');
const D = window.PQ_DATA;

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL  ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function near(a, b, name, t) { ok(Math.abs(a - b) <= (t || 1e-9), name + ` (got ${a}, want ${b})`); }
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; }, m }; }
function mk(clock) { const c = clock || { t: Date.UTC(2026, 0, 5, 12) }; return { c, eng: E.create(D, mem(), () => c.t) }; }
const SLOW = 20000;   // ms: not "rapid"
const byTD = (t, d) => D.questions.filter(q => q.topic === t && q.diff === d);

/* ---- parsing of typed answers ---- */
near(E.parseNumber('0.25'), 0.25, 'decimal');
near(E.parseNumber('3/8'), 0.375, 'fraction');
near(E.parseNumber(' 37.5% '), 0.375, 'percent');
near(E.parseNumber('1,234'), 1234, 'thousands separator');
near(E.parseNumber('−0.5'), -0.5, 'unicode minus');
ok(isNaN(E.parseNumber('abc')), 'garbage rejected');
ok(isNaN(E.parseNumber('1/0')), 'division by zero rejected');
ok(isNaN(E.parseNumber('')), 'empty rejected');
ok(isNaN(E.parseNumber('3/8/2')), 'double fraction rejected');

/* ---- shipped bank structure ---- */
{
  const ids = new Set(), topics = new Set(D.topics.map(t => t.id));
  let dup = 0; D.questions.forEach(q => { if (ids.has(q.id)) dup++; ids.add(q.id); });
  eq(dup, 0, 'unique ids');
  ok(D.questions.length >= 300, `at least 300 questions (${D.questions.length})`);
  eq(D.questions.filter(q => E.validateQuestion(q, topics, new Set())).map(q => q.id), [], 'every shipped question passes the runtime validator');
  D.topics.forEach(t => ok(byTD(t.id, 1).length && byTD(t.id, 2).length && byTD(t.id, 3).length, `topic ${t.id} has all three difficulty levels`));
  ok(D.questions.every(q => q.hints.length === 3 && q.solution.length >= 1), 'three hints and a worked solution for every question');
  ok(D.questions.every(q => !('src' in q) && !('legacyId' in q)), 'no source fields shipped');
  const n = D.questions.length, mix = [1, 2, 3].map(d => D.questions.filter(q => q.diff === d).length / n);
  ok(Math.abs(mix[0] - 0.25) < 0.07 && Math.abs(mix[1] - 0.45) < 0.07 && Math.abs(mix[2] - 0.30) < 0.07, 'difficulty mix near 25/45/30 (' + mix.map(m => m.toFixed(2)).join('/') + ')');
}

/* ---- XP cannot be farmed by clicking through the bank ---- */
{
  const { eng, c } = mk();
  for (const q of D.questions) { eng.recordAttempt({ qid: q.id, ok: true, ms: 400, hints: 0, mode: 'learn' }); c.t += 500; }
  ok(eng.state.xp < 3 * D.questions.length, 'rapid-fire correct answers earn under 3 XP per question (got ' + eng.state.xp + ' for ' + D.questions.length + ' questions)');
  const { eng: e2, c: c2 } = mk();
  for (const q of D.questions) { e2.recordAttempt({ qid: q.id, ok: true, ms: SLOW, hints: 0, mode: 'learn' }); c2.t += 20000; }
  ok(e2.state.xp > eng.state.xp * 2, 'unhurried correct answers earn clearly more than rapid ones');
}

/* ---- hints reduce credit; a miss resets the streak ---- */
{
  const { eng } = mk();
  const q = byTD('axioms', 2)[0], r = byTD('axioms', 2)[1];
  eng.recordAttempt({ qid: q.id, ok: true, ms: SLOW, hints: 0, mode: 'learn' });
  eq(eng.state.rs, 1, 'unhurried correct answer extends streak');
  eng.recordAttempt({ qid: r.id, ok: false, ms: SLOW, hints: 0, mode: 'learn' });
  eq(eng.state.rs, 0, 'miss resets streak');
  eq(eng.state.rsBest, 1, 'best streak retained');
}

/* ---- history: games, cooldown, no repeats, one history for every mode ---- */
{
  const { eng } = mk();
  eng.beginGame('learn');
  const seen = new Set(), ids = [];
  for (let i = 0; i < 10; i++) { const r = eng.pickLearnEx('cond', seen); seen.add(r.q.id); eng.markServed(r.q.id); ids.push(r.q.id); }
  eq(new Set(ids).size, 10, 'a learn game never repeats a question');
  eng.beginGame('challenge');
  const p = eng.planMixed(10);
  ok(p.ids.every(id => !ids.includes(id)), 'a mixed set right after a learn game avoids the questions just served (shared history)');
  eq(new Set(p.ids).size, p.ids.length, 'a mixed set has no repeats');
  ok(ids.every(id => eng.ageOf(id) >= 1 && eng.ageOf(id) < 5), 'served questions are inside the cooldown window');
}

/* ---- history survives a restart ---- */
{
  const st = mem(), clock = { t: Date.UTC(2026, 0, 5, 12) };
  const a = E.create(D, st, () => clock.t); a.beginGame('learn'); const r = a.pickLearnEx('indep', new Set()); a.markServed(r.q.id);
  a.recordAttempt({ qid: r.q.id, ok: true, ms: SLOW, hints: 0, mode: 'learn' });
  const b = E.create(D, st, () => clock.t);
  ok(b.ageOf(r.q.id) < 5, 'after a restart the served question is still in cooldown');
}

/* ---- daily challenge: same for everyone on a date, five different topics, no near-term repeats ---- */
{
  const { eng } = mk();
  const a = eng.dailySet('2026-03-02'), b = eng.dailySet('2026-03-02');
  eq(a, b, 'daily set is deterministic for a date');
  eq(new Set(a.map(id => D.questions.find(q => q.id === id).topic)).size, 5, 'daily set covers five topics');
  const last = {}; let bad = 0;
  for (let d = 0; d < 40; d++) { const key = new Date(Date.UTC(2026, 2, 1 + d)).toISOString().slice(0, 10); eng.dailySet(key).forEach(id => { if (last[id] !== undefined && d - last[id] < 6) bad++; last[id] = d; }); }
  eq(bad, 0, 'no daily question returns within six days');
}

/* ---- additional question packs are validated ---- */
{
  const data = { topics: [{ id: 'cond' }], questions: [{ id: 'CND-01' }] };
  const good = { id: 'CND-900', topic: 'cond', diff: 2, kind: 'num', stem: 'A well formed question stem here.', answer: { value: 0.5, display: '0.5' },
    hints: ['First hint of real length.', 'Second hint of real length.', 'Third hint of real length.'], solution: ['Step one.'], options: [] };
  const mcq = { ...good, id: 'CND-901', kind: 'mcq', answer: { value: 'a', display: 'a' },
    options: [{ text: 'a', correct: true }, { text: 'b', correct: false, why: 'This option is wrong because of a reason.' }, { text: 'c', correct: false, why: 'This option is wrong because of another reason.' }] };
  const bad = [
    { ...good, id: 'CND-01' }, { ...good, id: 'CND-902', topic: 'nope' }, { ...good, id: 'CND-903', diff: 5 }, { ...good, id: 'CND-904', hints: ['short'] },
    { ...good, id: 'CND-905', answer: { value: NaN, display: 'x' } }, { ...good, id: 'CND-906', src: { book: 'x' } },
    { ...mcq, id: 'CND-907', options: mcq.options.map(o => ({ ...o, correct: true })) }, { ...good, id: 'CND-908', solution: [] }
  ];
  const r = E.mergePacks(data, [good, mcq, ...bad]);
  eq(r.added, 2, 'valid extra questions are added');
  eq(r.rejected.length, bad.length, 'every malformed extra question is rejected with a reason');
  ok(r.rejected.every(x => x.why), 'rejections carry a reason');
  eq(data.questions.length, 3, 'only valid extras reach the bank');
}

console.log(`\nengine tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
