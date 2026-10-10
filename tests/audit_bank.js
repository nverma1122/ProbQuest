'use strict';
/* Bank audit: totals, unique and duplicate counts, topic / difficulty / kind distribution.
   node tests/audit_bank.js */
const path = require('path');
global.window = {}; require(path.join(__dirname, '../app/data/qbank.js'));
const D = window.PQ_DATA, Q = D.questions;
const norm = s => String(s).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/[^a-z0-9$]+/g, ' ').trim();
const stems = {}; Q.forEach(q => { (stems[norm(q.stem)] = stems[norm(q.stem)] || []).push(q.id); });
const dups = Object.values(stems).filter(a => a.length > 1);
const toks = s => new Set(norm(s).split(' ').filter(w => w.length > 2));
const T = Q.map(q => toks(q.stem)); let near = 0;
for (let i = 0; i < Q.length; i++) for (let j = i + 1; j < Q.length; j++) {
  if (Q[i].topic !== Q[j].topic) continue;
  let n = 0; T[i].forEach(w => { if (T[j].has(w)) n++; });
  if (n / (T[i].size + T[j].size - n) >= 0.8 && Q[i].answer.display === Q[j].answer.display) near++;
}
const count = f => Q.reduce((m, q) => { const k = f(q); m[k] = (m[k] || 0) + 1; return m; }, {});
const out = { built: D.built, total: Q.length, unique: Object.keys(stems).length, exactDuplicateGroups: dups.length, nearDuplicatePairs: near,
  byTopic: count(q => q.topic), byDifficulty: count(q => q.diff), byKind: count(q => q.kind), diagnostics: Q.filter(q => q.diag).length };
console.log(JSON.stringify(out, null, 1));
process.exit(dups.length ? 1 : 0);
