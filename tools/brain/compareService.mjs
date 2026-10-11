import { fork } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const brainsDir = new URL('../../public/brains/', import.meta.url);
export function comparisonService() {
  let child = null, state = { status: 'idle' };
  return {
    async handle(req, res, path) {
      if (!path.startsWith('/api/compare')) return false;
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
      if (req.method === 'GET' && path === '/api/compare/brains') {
        send(200, (await readdir(brainsDir)).filter(f => f.endsWith('.json') && f !== 'index.json')); return true;
      }
      if (req.method === 'GET' && path === '/api/compare') { send(200, state); return true; }
      if (req.method !== 'POST' || path !== '/api/compare') { send(405, {error:'Method not allowed'}); return true; }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { send(403, {error:'Cross-origin request'}); return true; }
      if (child) { send(409, {error:'A comparison is already running'}); return true; }
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Error('Request too large'); }
        const o = JSON.parse(body);
        const range = (key, min, max) => { if (!Number.isFinite(o[key]) || o[key] < min || o[key] > max) throw Error(`Invalid ${key}`); };
        range('seed', 0, 2147483647); range('gateCount', 4, 80); range('difficulty', 0, 1); range('laps', 1, 10); range('runs', 1, 10); range('seconds', 10, 600); range('wind', 0, 20);
        for (const k of ['seed','gateCount','laps','runs']) if (!Number.isInteger(o[k])) throw Error(`Invalid ${k}`);
        if (!['race','freestyle','mountain','sprint','technical','acro','industrial'].includes(o.style)) throw Error('Invalid style');
        const available = await readdir(brainsDir);
        if (!o.preview && (!Array.isArray(o.brains) || !o.brains.length || o.brains.length > 16 || o.brains.some(f => typeof f !== 'string' || f === 'index.json' || !f.endsWith('.json') || !available.includes(f) || /[\\/]/.test(f)))) throw Error('Choose saved brains');
        state = { status:'running', message:'Building test course…', results:[] };
        child = fork(new URL('./compareWorker.mjs', import.meta.url), [], { cwd: root, stdio:['ignore','ignore','pipe','ipc'] });
        let errors = ''; child.stderr.on('data', b => { errors = (errors + b).slice(-2000); });
        child.on('message', m => { state = m; });
        child.on('error', e => { state = {status:'failed', error:e.message}; });
        child.on('exit', code => { if (state.status === 'running') state = {status:'failed', error:errors || `Worker exited (${code})`}; child = null; });
        child.send(o); send(202, state);
      } catch (e) { send(400, {error:e.message}); }
      return true;
    },
    close() { child?.kill(); }
  };
}


