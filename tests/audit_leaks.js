'use strict';
/* Scans everything that ships (app/) for textbook, author, publisher, edition, page or exercise information.
   node tests/audit_leaks.js */
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '../app');
const RX = /\b(ross|degroot|schervish|larsen|marx|devore|hogg|tanis|zimmerman|spiegel|schaum|pearson|cengage|wiley|prentice|addison|textbook|edition|chapter\s+\d|exercise\s+\d|problem\s+\d+\.\d|printed page|pp\.\s*\d)\b/i;
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(APP);
let hits = 0;
for (const f of files) {
  if (/qbank\.json$/.test(f)) continue;                       // identical content to qbank.js
  const txt = fs.readFileSync(f, 'utf8');
  txt.split(/\r?\n|(?<=\},)/).forEach((line, i) => { const m = RX.exec(line); if (m) { hits++; console.log(`${path.relative(APP, f)}:${i + 1}: "${m[0]}" in ...${line.slice(Math.max(0, m.index - 40), m.index + 60)}...`); } });
}
global.window = {}; require(path.join(APP, 'data/qbank.js'));
const bad = window.PQ_DATA.questions.filter(q => /^(ORIG|ROSS|DEG|LM|DEV|HTZ|CLS)/i.test(q.id) || 'src' in q || 'legacyId' in q);
bad.forEach(q => { hits++; console.log('source-like id or field: ' + q.id); });
console.log(`files scanned: ${files.length}, questions: ${window.PQ_DATA.questions.length}, hits: ${hits}`);
process.exit(hits ? 1 : 0);
