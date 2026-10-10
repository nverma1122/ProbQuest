'use strict';
/* Minimal static server for local testing:  node tests/serve.js   then open http://localhost:8765 */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../app');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8765, () => console.log('ProbQuest at http://localhost:8765'));
