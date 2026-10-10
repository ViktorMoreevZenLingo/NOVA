// Exposes ONLY `POST /functions/v1/coach-tools` of the local Supabase stack, so a temporary
// tunnel (cloudflared) can give Vapi a public URL without exposing the rest of the local API
// (whose keys are the public defaults).
//   node demo/coach-proxy.mjs            # listens on 127.0.0.1:8787
//   cloudflared tunnel --url http://127.0.0.1:8787
import http from 'node:http';
const port = Number(process.env.PORT || 8787);
http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/functions/v1/coach-tools') { res.writeHead(404).end(); return; }
  const up = http.request({ host: '127.0.0.1', port: 54321, path: req.url, method: 'POST', headers: { ...req.headers, host: '127.0.0.1:54321' } }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on('error', () => res.writeHead(502).end());
  req.pipe(up);
}).listen(port, '127.0.0.1', () => console.log(`coach-tools proxy on 127.0.0.1:${port}`));
