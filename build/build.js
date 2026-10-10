'use strict';
/* ProbQuest build:  node build/build.js
   Reads bank/topics.json and bank/questions/<topic>.json, validates every question, and writes
   app/data/qbank.js and app/data/qbank.json.  Any error stops the build and leaves the shipped data untouched. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
global.window = {}; require(path.join(ROOT, 'app/js/tex.js'));
const TEX = window.PQ_TEX;

const topics = read('bank/topics.json');
const TID = new Set(topics.map(t => t.id));
const errors = [], warnings = [];
const err = (id, m) => errors.push(`${id}: ${m}`), warn = (id, m) => warnings.push(`${id}: ${m}`);

let questions = [];
for (const t of topics) {
  const f = `bank/questions/${t.id}.json`;
  if (!fs.existsSync(path.join(ROOT, f))) { err(t.id, `missing ${f}`); continue; }
  try { questions.push(...read(f)); } catch (e) { err(f, 'not valid JSON: ' + e.message); }
}
// optional additional pack(s): bank/extra/*.json, same schema
const extraDir = path.join(ROOT, 'bank/extra');
if (fs.existsSync(extraDir)) for (const f of fs.readdirSync(extraDir).filter(x => x.endsWith('.json'))) {
  try { const a = JSON.parse(fs.readFileSync(path.join(extraDir, f), 'utf8')); questions.push(...(Array.isArray(a) ? a : a.questions || [])); }
  catch (e) { err('bank/extra/' + f, 'not valid JSON: ' + e.message); }
}

const LEAK = /\b(ross|degroot|schervish|larsen|marx|devore|hogg|tanis|zimmerman|spiegel|schaum|pearson|cengage|wiley|textbook|edition|chapter\s+\d|exercise\s+\d|problem\s+\d+\.\d|page\s+\d+|pp\.\s*\d)/i;
const texOK = s => {
  s = String(s).replace(/\\\$/g, '');
  if ((s.match(/\$/g) || []).length % 2) return false;
  let d = 0; for (const c of s) { if (c === '{') d++; if (c === '}') d--; if (d < 0) return false; }
  return d === 0;
};
const norm = s => String(s).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/\$[^$]*\$/g, m => m.replace(/\s+/g, '')).replace(/[^a-z0-9$\\^_{}=<>.+\-*/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = s => new Set(norm(s).split(' ').filter(w => w.length > 2));
const jacc = (a, b) => { let i = 0; a.forEach(x => { if (b.has(x)) i++; }); return i / (a.size + b.size - i || 1); };

const seen = new Set(), stems = new Map();
for (const q of questions) {
  const id = q.id || '(no id)';
  if (!/^[A-Z]{3}-\d{2,3}$/.test(q.id || '')) err(id, 'id must look like AAA-NN (neutral, no source information)');
  if (seen.has(q.id)) err(id, 'duplicate id'); seen.add(q.id);
  if (!TID.has(q.topic)) err(id, 'unknown topic');
  if (![1, 2, 3].includes(q.diff)) err(id, 'difficulty must be 1, 2 or 3');
  if (q.kind !== 'mcq' && q.kind !== 'num') err(id, 'kind must be mcq or num');
  for (const k of ['sub', 'stem', 'concept', 'misconception', 'why']) if (typeof q[k] !== 'string' || q[k].trim().length < (k === 'sub' ? 4 : 12)) err(id, `field "${k}" is missing or too short`);
  if (!Array.isArray(q.hints) || q.hints.length !== 3 || new Set(q.hints).size !== 3 || q.hints.some(h => typeof h !== 'string' || h.trim().length < 15)) err(id, 'needs exactly 3 distinct hints of real content');
  if (!Array.isArray(q.solution) || !q.solution.length) err(id, 'no worked solution');
  if (!q.answer || q.answer.display == null) err(id, 'no answer');
  if (q.kind === 'num' && !(q.answer && typeof q.answer.value === 'number' && isFinite(q.answer.value))) err(id, 'numeric answer must be a finite number');
  if (q.kind === 'mcq') {
    const o = q.options || [];
    if (o.length < 3 || o.length > 6) err(id, 'multiple choice needs 3 to 6 options');
    if (o.filter(x => x.correct).length !== 1) err(id, 'exactly one option must be correct');
    if (new Set(o.map(x => String(x.text).trim())).size !== o.length) err(id, 'duplicate option text');
    o.forEach(x => { if (!x.correct && (!x.why || x.why.length < 20)) err(id, 'each wrong option needs an explanation'); });
    const c = o.find(x => x.correct);
    if (c && q.answer && String(c.text).trim() !== String(q.answer.display).trim()) err(id, `answer "${q.answer.display}" differs from the correct option "${c.text}"`);
  }
  const all = [q.stem, q.data, q.concept, q.misconception, q.why, ...(q.hints || []), ...(q.solution || []), ...((q.options || []).flatMap(o => [o.text, o.why]))].filter(Boolean);
  all.forEach(s => { if (!texOK(s)) err(id, 'unbalanced $ or braces in: ' + String(s).slice(0, 50)); });
  all.forEach(s => { if (LEAK.test(s)) err(id, 'looks like source information: ' + String(s).slice(0, 60)); });
  for (const k of ['src', 'source', 'book', 'attribution', 'legacyId']) if (k in q) err(id, `field "${k}" must not be shipped`);
  try { all.forEach(s => TEX.tex(s)); } catch (e) { err(id, 'does not render: ' + e.message); }
  if (/\\[A-Za-z]+/.test(all.map(s => TEX.tex(s).replace(/<[^>]+>/g, '')).join(' '))) warn(id, 'contains an unrendered TeX command');
  if (q.kind === 'num' && q.tol != null && !(q.tol >= 0)) err(id, 'tol must be a non-negative number');
  const n = norm(q.stem);
  if (stems.has(n)) err(id, `exact duplicate of ${stems.get(n)}`); else stems.set(n, id);
}
// near-duplicates: very similar wording and the same answer (pairs reviewed and accepted are listed in bank/dup_allow.json)
const allow = new Set((fs.existsSync(path.join(ROOT, 'bank/dup_allow.json')) ? read('bank/dup_allow.json') : []).map(p => [p[0], p[1]].sort().join('|')));
const T = questions.map(q => toks(q.stem));
for (let i = 0; i < questions.length; i++) for (let j = i + 1; j < questions.length; j++) {
  const a = questions[i], b = questions[j];
  if (a.topic !== b.topic) continue;
  const s = jacc(T[i], T[j]);
  if (s >= 0.8 && String(a.answer && a.answer.display) === String(b.answer && b.answer.display) && !allow.has([a.id, b.id].sort().join('|')))
    err(a.id, `near-duplicate of ${b.id} (similarity ${s.toFixed(2)}); retire one or list the pair in bank/dup_allow.json`);
}

const byTopic = {}, byDiff = { 1: 0, 2: 0, 3: 0 };
questions.forEach(q => { byTopic[q.topic] = (byTopic[q.topic] || 0) + 1; byDiff[q.diff]++; });
const N = questions.length, mix = [1, 2, 3].map(d => byDiff[d] / N), target = [0.25, 0.45, 0.30];
if (mix.some((m, i) => Math.abs(m - target[i]) > 0.07)) warnings.push(`difficulty mix ${mix.map(m => Math.round(m * 100)).join('/')} is more than 7 points from 25/45/30`);
topics.forEach(t => { if ((byTopic[t.id] || 0) < 15) warnings.push(`topic ${t.id} has only ${byTopic[t.id] || 0} questions`); });

console.log(`questions: ${N}  errors: ${errors.length}  warnings: ${warnings.length}`);
console.log('topics:', JSON.stringify(byTopic));
console.log('difficulty:', JSON.stringify(byDiff));
warnings.forEach(w => console.log('WARN   ' + w));
if (errors.length) { errors.slice(0, 80).forEach(e => console.log('ERROR  ' + e)); process.exit(1); }

const order = new Map(topics.map((t, i) => [t.id, i]));
questions.sort((a, b) => order.get(a.topic) - order.get(b.topic) || (a.id < b.id ? -1 : 1));
const data = { built: new Date().toISOString().slice(0, 10), questions, topics };
fs.mkdirSync(path.join(ROOT, 'app/data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'app/data/qbank.js'), 'window.PQ_DATA=' + JSON.stringify(data) + ';', 'utf8');
fs.writeFileSync(path.join(ROOT, 'app/data/qbank.json'), JSON.stringify(data, null, 1), 'utf8');
console.log('wrote app/data/qbank.js and qbank.json');

