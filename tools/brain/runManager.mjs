// Persistent run launcher. It owns only the trainer it starts; opening this server never starts training.
import { fork } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDashboard } from './dashServer.mjs';
import { validateTrainingConfig, TRAINING_STYLES } from './dashboard/js/trainingSettings.js';
import { RUN_DEFAULTS, normaliseParks, templateById } from './dashboard/js/templates.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;
const DATA_ROUTE = /^\/(meta|worlds|history|traces|events|trace\/\d+)$/;
const send = (res, code, value) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
async function jsonBody(req) {
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw Object.assign(Error('Cross-origin request'), { code: 403 });
  if (!/application\/json/.test(req.headers['content-type'] || '')) throw Object.assign(Error('Send JSON'), { code: 415 });
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Object.assign(Error('Request too large'), { code: 413 }); }
  try { return JSON.parse(body); } catch { throw Error('Invalid JSON'); }
}
async function files(dir, suffix) {
  try { return (await readdir(dir)).filter(name => name.endsWith(suffix)); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
async function smallRunSummary(path) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat(), n = Math.min(stat.size, 65536), head = Buffer.alloc(n), tail = Buffer.alloc(n);
    await file.read(head, 0, n, 0); await file.read(tail, 0, n, stat.size - n);
    const meta = JSON.parse(head.toString().split('\n')[0]);
    if (meta.kind !== 'meta') return null;
    const records = tail.toString().split('\n').reverse().flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    return { name: meta.name, startedAt: meta.startedAt, ended: records.some(r => r.kind === 'end'), last: records.find(r => r.kind === 'iter') };
  } finally { await file.close(); }
}

export async function startRunManager({ port = 8787, host = '127.0.0.1', root = ROOT,
  runsDir = resolve(root, '.bench/brain/runs'), brainsDir = resolve(root, 'public/brains'),
  launch = (args) => fork(resolve(root, 'tools/brain/train.mjs'), args, { cwd: root, windowsHide: true, execArgv: [], stdio: ['ignore','pipe','pipe','ipc'] }),
  log = console.log, game = {} } = {}) {
  let active = null, closing = false;
  const replayServers = new Map();
  const meta = { name: 'Training', managed: true, mode: 'idle', status: 'idle', config: {}, policyHz: 50 };
  const source = { meta, worldsJson: '[]', history: { iters: [], lines: [] }, traces: { list: () => [], get: () => null, has: () => false } };
  const brainFiles = async () => (await files(brainsDir, '.json')).filter(f => f !== 'index.json').sort();
  const writeInfo = run => {
    const snapshot = JSON.stringify(run.info, null, 2);
    run.writeQueue = (run.writeQueue || Promise.resolve()).catch(() => {}).then(() => writeFile(resolve(runsDir, `${run.id}.run.json`), snapshot));
    return run.writeQueue;
  };
  async function previousRuns() {
    const names = new Set([...(await files(runsDir, '.train.ndjson')).map(f => f.replace(/\.train\.ndjson$/, '')),
      ...(await files(runsDir, '.run.json')).map(f => f.replace(/\.run\.json$/, ''))]);
    // The brain index carries each saved brain's best training lap.
    let brainStats = new Map();
    try { brainStats = new Map(JSON.parse(await readFile(resolve(brainsDir, 'index.json'), 'utf8')).brains.map(b => [b.file, b.stats ?? {}])); } catch { /* no index yet */ }
    const rows = [];
    for (const id of names) {
      if (!RUN_ID.test(id) || id === active?.id) continue;
      let summary = null, info = null;
      try { summary = await smallRunSummary(resolve(runsDir, `${id}.train.ndjson`)); } catch { /* a setup failure may not write a log */ }
      try { info = JSON.parse(await readFile(resolve(runsDir, `${id}.run.json`), 'utf8')); } catch { /* legacy run */ }
      if (!summary && !info) continue;
      const brain = `${id}.json`, saved = existsSync(resolve(brainsDir, brain));
      const m = summary?.last?.metrics;
      rows.push({ id, name: info?.name || summary?.name || id, startedAt: info?.startedAt || summary?.startedAt,
        endedAt: info?.endedAt, status: ['starting','running','stopping'].includes(info?.status) ? 'interrupted' : info?.status || (summary?.ended ? 'finished' : 'interrupted'),
        iterations: summary?.last?.iteration || 0, elapsed: summary?.last?.elapsed || 0,
        template: info?.options?.template ?? null, resumed: info?.options?.resume ?? null, gpuErrors: info?.gpuErrors || 0,
        crashRate: m?.episodes > 0 ? (100 * m.crashes) / m.episodes : null, meanReturn: m?.episodes > 0 ? m.meanReturn : null,
        bestLap: (saved && brainStats.get(brain)?.bestLap) || null,
        error: info?.error, canView: !!summary, brain: saved ? brain : null });
    }
    return rows.sort((a,b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  }
  async function options(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid run settings.');
    const generated = `run-${new Date().toISOString().replace(/[-:]/g, '').slice(0,15)}-${Math.random().toString(36).slice(2,6)}`;
    // A template fills in whatever the request leaves out; the dashboard sends every value, so its form wins.
    const template = input.template ? templateById(input.template) : null;
    if (input.template && !template) throw Error('Choose an existing template.');
    const ppoInput = { ...template?.ppo, ...(input.ppo || {}) };
    for (const key of ['envs','steps','seed','lr']) if (input[key] !== undefined) ppoInput[key] = input[key];
    const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const config = validateTrainingConfig(ppoInput, isObject(input.env) ? { ...template?.env, ...input.env } : input.env ?? { ...template?.env });
    const run = { ...RUN_DEFAULTS, ...template?.run };
    const o = { name: input.name?.trim() || generated, minutes: input.minutes ?? run.minutes, worlds: input.worlds ?? run.worlds,
      iters: input.iters ?? run.iters, every: input.every ?? run.every, recipes: input.recipes === undefined ? run.recipes : input.recipes,
      parks: normaliseParks(input.parks ?? run.parks), styles: input.styles ?? [...run.styles], ...config, resume: input.resume || null, template: template?.id ?? null };
    if (!NAME.test(o.name)) throw Error('Use a run name with letters, numbers, hyphens or underscores (up to 48 characters).');
    const range = (key, min, max, integer = false) => {
      if (!Number.isFinite(o[key]) || o[key] < min || o[key] > max || (integer && !Number.isInteger(o[key]))) throw Error(`Invalid ${key}`);
    };
    range('minutes', .1, 1440); range('worlds', 1, 192, true); range('iters',0,2147483647,true); range('every',.01,1440);
    if (o.recipes !== null) range('recipes',0,o.worlds,true);
    if (o.parks === null) throw Error('List theme park worlds as seed[:size][:route], such as 1337, 7:compact:coaster0, 31415:mega:tour (each once, up to 8).');
    if (!Array.isArray(o.styles) || !o.styles.length || o.styles.some(s=>!TRAINING_STYLES.includes(s))) throw Error('Choose at least one valid world style');
    if (o.resume && (!(await brainFiles()).includes(o.resume) || /[\\/]/.test(o.resume))) throw Error('Choose an existing saved brain.');
    if (o.resume) {
      const brain = JSON.parse(await readFile(resolve(brainsDir,o.resume),'utf8'));
      if (Object.hasOwn(ppoInput,'hidden') && JSON.stringify(brain.hidden) !== JSON.stringify(o.ppo.hidden)) throw Error('A continued brain keeps its saved network architecture. Choose New brain to change hidden layers.');
      if (Array.isArray(brain.hidden)) o.ppo.hidden=[...brain.hidden];
    }
    if (existsSync(resolve(brainsDir, `${o.name}.json`)) || existsSync(resolve(runsDir, `${o.name}.train.ndjson`)) || existsSync(resolve(runsDir, `${o.name}.run.json`))) throw Error('That name is already used. Choose a new name; existing runs and brains are preserved.');
    return o;
  }
  async function start(input) {
    if (closing || active) throw Object.assign(Error('A run is already starting, running or stopping.'), { code: 409 });
    const o = await options(input);
    if (closing || active) throw Object.assign(Error('A run is already starting, running or stopping.'), { code: 409 });
    const run = { id: o.name, options: o, info: { id: o.name, name: o.name, status: 'starting', startedAt: new Date().toISOString(), options: o }, url: null, stopRequested: false, child: null };
    active = run;
    Object.assign(meta, { name: run.id, status: 'starting', mode: 'live', activeRunId: run.id, template: o.template, gpuErrors: null });
    try {
      await mkdir(runsDir, { recursive: true }); await writeInfo(run);
      const args = ['--managed','true','--name',o.name,'--minutes',String(o.minutes),'--worlds',String(o.worlds),'--seed',String(o.ppo.seed),
        '--iters',String(o.iters),'--every',String(o.every),'--styles',o.styles.join(','),'--ppo',JSON.stringify(o.ppo),
        '--env',Object.entries(o.env).map(([key,value])=>`${key}=${value}`).join(','),'--out',brainsDir,'--runs',runsDir];
      if (o.recipes !== null) args.push('--recipes',String(o.recipes));
      if (o.parks) args.push('--parks',o.parks);
      if (o.resume) args.push('--resume', resolve(brainsDir, o.resume));
      if (o.template) args.push('--template', o.template);
      run.child = launch(args);
      const stdout = createWriteStream(resolve(runsDir, `${o.name}.stdout.log`)), stderr = createWriteStream(resolve(runsDir, `${o.name}.stderr.log`));
      run.child.stdout?.pipe(stdout); run.child.stderr?.pipe(stderr);
      let diagnostic = '';
      run.child.stderr?.on('data', chunk => {
        diagnostic = (diagnostic + chunk).slice(-2500);
        // Dawn reports invalid dispatches on stderr while the iterations carry on with empty metrics: count them for the page.
        const text = String(chunk), errors = text.match(/GPU error: [^\n]*/g);
        if (errors && active === run) meta.gpuErrors = { count: (meta.gpuErrors?.count || 0) + errors.length, last: errors.at(-1).slice(11).trim() };
      });
      run.child.on('message', message => {
        if (active !== run) return;
        if (message.kind === 'dashboard' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(message.url)) run.url = message.url;
        if (message.kind === 'training-ready' && !run.stopRequested) { run.info.status = meta.status = 'running'; void writeInfo(run).catch(e => log?.(e.message)); }
      });
      run.done = new Promise(done => {
        let ended = false;
        const finish = async (code, error) => {
          if (ended) return; ended = true;
          run.info.status = error || code !== 0 ? 'failed' : run.stopRequested ? 'stopped' : 'finished';
          run.info.endedAt = new Date().toISOString(); if (run.info.status === 'failed') run.info.error = error?.message || diagnostic || `Trainer exited with code ${code}`;
          if (active === run && meta.gpuErrors) run.info.gpuErrors = meta.gpuErrors.count;
          await writeInfo(run).catch(e => log?.(e.message)); stdout.end(); stderr.end();
          if (active === run) { active = null; Object.assign(meta, { name: 'Training', status: 'idle', mode: 'idle', activeRunId: null, template: null, gpuErrors: null }); }
          done();
        };
        run.child.once('error', error => void finish(null, error));
        run.child.once('exit', code => void finish(code));
      });
      return { ok: true, id: run.id, status: meta.status };
    } catch (e) {
      run.info.status = 'failed'; run.info.error = e.message; run.info.endedAt = new Date().toISOString();
      await writeInfo(run).catch(() => {}); active = null; Object.assign(meta, { status: 'idle', mode: 'idle', activeRunId: null, template: null, gpuErrors: null }); throw e;
    }
  }
  function command(cmd) {
    if (!active?.child || !['starting','running'].includes(meta.status)) throw Object.assign(Error('No run is ready for that command.'), { code: 409 });
    if (cmd !== 'stop' && cmd !== 'save') throw Error('Choose save or stop.');
    if (cmd === 'save' && meta.status !== 'running') throw Object.assign(Error('Wait until training starts to save a checkpoint.'), { code: 409 });
    if (active.child.connected === false) throw Object.assign(Error('Trainer is finishing. Please wait.'), { code: 409 });
    active.child.send({ cmd });
    if (cmd === 'stop') { active.stopRequested = true; active.info.status = meta.status = 'stopping'; void writeInfo(active).catch(e => log?.(e.message)); }
    return { ok: true, cmd, status: meta.status };
  }
  async function replay(id) {
    if (!RUN_ID.test(id) || !(await files(runsDir, '.train.ndjson')).includes(`${id}.train.ndjson`) || id === active?.id) throw Object.assign(Error('Previous run not found.'), { code: 404 });
    if (!replayServers.has(id)) {
      while (replayServers.size >= 2) { const first = replayServers.keys().next().value; await (await replayServers.get(first)).close(); replayServers.delete(first); }
      const pending = import('./dashboard.mjs').then(({ replayRun }) => replayRun(resolve(runsDir,id), { port: 0, log: null }));
      replayServers.set(id,pending); pending.catch(() => replayServers.delete(id));
    }
    return replayServers.get(id);
  }
  function proxy(req, res, base, path) {
    const url = new URL(path,base);
    const upstream = request(url, { method: req.method, headers: { host: url.host, ...(req.headers['last-event-id'] ? { 'last-event-id': req.headers['last-event-id'] } : {}), ...(req.headers['accept-encoding'] ? { 'accept-encoding': req.headers['accept-encoding'] } : {}) } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) send(res,503,{error:'Run data is not available yet.'}); else res.destroy(); });
    res.on('close', () => upstream.destroy()); upstream.end();
  }
  source.handleRequest = async (req,res,url) => {
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/api/runs') { send(res,200,{active: active ? { id:active.id,name:active.id,status:meta.status } : null, previous:await previousRuns(), brains:await brainFiles()}); return true; }
      if (req.method === 'POST' && path === '/api/runs/start') { send(res,202,await start(await jsonBody(req))); return true; }
      if (req.method === 'POST' && path === '/api/command') { const body = await jsonBody(req); send(res,200,command(body.cmd)); return true; }
      const settings = /^\/api\/runs\/([^/]+)\/settings$/.exec(path);
      if (settings && req.method === 'GET') {
        const id = decodeURIComponent(settings[1]);
        if (!RUN_ID.test(id)) throw Object.assign(Error('Run not found'),{code:404});
        let options;
        if (active?.id === id) options = active.options;
        else {
          try { options = JSON.parse(await readFile(resolve(runsDir,`${id}.run.json`),'utf8')).options; } catch { /* legacy log */ }
          if (!options) {
            const file = await open(resolve(runsDir,`${id}.train.ndjson`),'r').catch(()=>null);
            if (!file) throw Object.assign(Error('Run not found'),{code:404});
            try {
              const buffer = Buffer.alloc(65536); const {bytesRead} = await file.read(buffer,0,buffer.length,0);
              const saved = JSON.parse(buffer.subarray(0,bytesRead).toString().split('\n')[0]);
              options = { ...saved.config?.run, ppo:saved.config?.ppo, env:saved.config?.env };
            } finally { await file.close(); }
          }
        }
        send(res,200,options); return true;
      }
      if (req.method === 'GET' && path === '/api/meta') {
        let current = {};
        if (active?.url) try { const response = await fetch(new URL('/api/meta',active.url), {signal:AbortSignal.timeout(3000)}); current = await response.json(); } catch { /* still starting or exiting */ }
        send(res,200,{...current,...meta,config:current.config||{},managerUrl:'/',iterations:current.iterations||0}); return true;
      }
      const previous = /^\/api\/runs\/([^/]+)(\/.*)$/.exec(path);
      if (previous && (req.method === 'GET' || req.method === 'HEAD') && DATA_ROUTE.test(previous[2])) { const server = await replay(decodeURIComponent(previous[1])); proxy(req,res,server.url,'/api'+previous[2]+url.search); return true; }
      const live = path.startsWith('/api/') ? path.slice(4) : '';
      if ((req.method === 'GET' || req.method === 'HEAD') && DATA_ROUTE.test(live) && live !== '/meta' && active?.url) { proxy(req,res,active.url,path+url.search); return true; }
      if (path === '/api/runs/start' || path === '/api/runs') { send(res,405,{error:'Method not allowed'}); return true; }
    } catch (e) { send(res,Number.isInteger(e.code) ? e.code : 400,{ok:false,error:e.message}); return true; }
    return false;
  };
  const http = await serveDashboard(source,{port,host,log,portTries:1,game:{brainsDir,...game}});
  return { ...http, async close() {
    closing = true;
    if (active) { if (!active.stopRequested) command('stop'); await active.done; }
    for (const server of replayServers.values()) await (await server).close();
    replayServers.clear(); await http.close();
  } };
}
