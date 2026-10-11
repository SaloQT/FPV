#!/usr/bin/env node
/**
 * Long-lived render server: one worker process (tools/render-worker.mjs) keeps the Dawn device, the bundle, the scenes and the renderers
 * alive between shots, so a shot after an edit pays only for what the edit reaches. Listens on 127.0.0.1 only. See tools/RENDER_SERVER.md.
 *
 *   node tools/render-server.mjs [--port 47811] [--max-rss-gb 12] [--idle-exit 120] [--source <checkout root>]
 *
 * POST /shot (a request from render-core.mjs requestFromArgs, as JSON) renders and answers { ok, result | error }. GET /status, POST /stop.
 * Requests run one at a time; each takes the machine-wide GPU lock for its own render and releases it after. The worker is restarted when
 * it dies or grows past --max-rss-gb (old bundles cannot be unloaded from a Node process). --idle-exit stops the server after that many
 * idle minutes (0 never).
 */
import { fork } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { ROOT, parseArgs } from './render-core.mjs';

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 47811), maxRss = Number(args['max-rss-gb'] ?? 12) * 2 ** 30, idleExit = Number(args['idle-exit'] ?? 120);
// --source <checkout> renders another copy of src/ (the speed bench edits a scratch copy); its state file is kept apart.
const source = args.source ? resolve(args.source) : null;
const STATE = resolve(ROOT, '.bench/render-server', source ? `server-${port}.json` : 'server.json');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[render-server]', ...a);

let worker = null, ready = null, seq = 0, served = 0, lastUse = Date.now();
const pending = new Map();
function startWorker() {
  worker = fork(resolve(ROOT, 'tools/render-worker.mjs'), [], { stdio: 'inherit', env: { ...process.env, ...(source ? { FPV_RENDER_SOURCE: source } : {}) } });
  const w = worker;
  ready = new Promise((done, fail) => {
    w.on('message', (m) => {
      if (m.ready) { done(); return; }
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p(m); }
    });
    w.on('exit', (code) => {
      log(`worker exited (${code})`);
      if (worker === w) worker = null;
      fail(new Error(`worker exited (${code}) before it was ready`));
      for (const [id, p] of pending) { pending.delete(id); p({ ok: false, error: `render worker exited (${code}) mid-request` }); }
    });
  });
  ready.catch(() => {});
}
function stopWorker() { if (worker) { const w = worker; worker = null; w.disconnect(); setTimeout(() => w.kill(), 10000).unref(); } }

let queue = Promise.resolve();
function shot(req) {
  const run = async () => {
    if (!worker) startWorker();
    await ready;
    const id = ++seq;
    const reply = await new Promise((done) => { pending.set(id, done); worker.send({ id, req }); });
    served++; lastUse = Date.now();
    if (reply.rss > maxRss) { log(`worker at ${(reply.rss / 2 ** 30).toFixed(1)} GB, restarting it`); stopWorker(); }
    return reply;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

const server = createServer(async (rq, rs) => {
  const send = (code, body) => { rs.writeHead(code, { 'content-type': 'application/json' }); rs.end(JSON.stringify(body)); };
  try {
    if (rq.method === 'GET' && rq.url === '/status') return send(200, { ok: true, pid: process.pid, worker: worker?.pid ?? null, served, queued: pending.size });
    if (rq.method === 'POST' && rq.url === '/stop') { send(200, { ok: true }); shutdown(); return; }
    if (rq.method === 'POST' && rq.url === '/shot') {
      let body = '';
      for await (const c of rq) body += c;
      const reply = await shot(JSON.parse(body));
      return send(reply.ok ? 200 : 500, reply);
    }
    send(404, { ok: false, error: 'not found' });
  } catch (error) { send(500, { ok: false, error: String(error?.stack ?? error) }); }
});
function shutdown() {
  stopWorker();
  server.close();
  rmSync(STATE, { force: true });
  setTimeout(() => process.exit(0), 500).unref();
}
server.on('error', (e) => { console.error(e.message); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  mkdirSync(resolve(ROOT, '.bench/render-server'), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ port, pid: process.pid }));
  log(`listening on 127.0.0.1:${port}`);
  startWorker();
});
if (idleExit > 0) setInterval(() => { if (!pending.size && Date.now() - lastUse > idleExit * 60000) { log('idle, stopping'); shutdown(); } }, 60000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
