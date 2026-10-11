#!/usr/bin/env node
/**
 * Renders tree-shots-style views through the render server (tools/render-server.mjs), starting it when none is running. See
 * tools/RENDER_SERVER.md.
 *
 *   node tools/shot-client.mjs --out .bench/trees/after [--quality high,ultra] [--width 1280 | --size 1280x720] [--views .bench/trees/views.json]
 *     [--view '{"name":{"eye":[..],"target":[..],"fov":75}}'] [--only bark-oak,edge] [--frames 90] [--timed 60] [--hour 9] [--seed 1337]
 *     [--no-clouds] [--atmos JSON] [--skip modules] [--no-scans] [--raw] [--fresh] [--no-start] [--port 47811]
 *
 * Writes <out>/<view>-<quality>.png (and .rgba with --raw) and <out>/timings.json. --fresh renders in this process from a new bundle and a
 * new device instead (the fallback when the server is suspect); the output is the same.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { offscreenSurface } from './native-bench/runtime.mjs';
import {
  ROOT, applyModuleSettings, bundleOnce, checkErrors, importBundle, installFetch, makeScene, openSharedGpu, parseArgs, renderViews, requestFromArgs,
  rendererOptions, sceneKey, settingsFor, viewsOf, waitForGpuLock,
} from './render-core.mjs';

const args = parseArgs(process.argv.slice(2));
const req = requestFromArgs(args);
req.raw = !!args.raw;
const t0 = performance.now();

async function fresh() {
  const stages = {};
  const dir = resolve(ROOT, '.bench/render-server', `fresh-${process.pid}`);
  let t = performance.now();
  const a = await importBundle(bundleOnce(dir, args.source ? resolve(args.source) : ROOT));
  stages.bundle = performance.now() - t;
  const views = await viewsOf(req);
  t = performance.now();
  const release = await waitForGpuLock(Number(args['lock-wait'] ?? 30));
  stages.lockWait = performance.now() - t;
  const gpu = await openSharedGpu({ backend: args.backend ?? 'd3d12' });
  const results = {};
  try {
    installFetch({ noScans: req.noScans });
    const scenes = new Map();
    for (const quality of req.qualities) {
      const key = sceneKey(req, quality);
      if (!scenes.has(key)) { const t1 = performance.now(); scenes.set(key, makeScene(a, req, quality)); stages[`scene ${quality}`] = performance.now() - t1; }
      const scene = scenes.get(key);
      t = performance.now();
      const out = offscreenSurface(req.width, req.height);
      const modules = a.createDefaultModules().filter((m) => !req.skip.includes(m.name));
      const renderer = await a.Renderer.create(out.surface, settingsFor(a, quality, req), modules, undefined, rendererOptions(req));
      stages[`create ${quality}`] = performance.now() - t;
      t = performance.now();
      renderer.device.pushErrorScope('validation');
      renderer.setScene(scene);
      applyModuleSettings(modules, req);
      stages[`setScene ${quality}`] = performance.now() - t;
      t = performance.now();
      try {
        results[quality] = await renderViews(a, renderer, out.read, req, quality, views, { raw: req.raw });
        await checkErrors(renderer);
      } finally { renderer.destroy(); }
      stages[`render ${quality}`] = performance.now() - t;
    }
  } finally { gpu.close(); await release(); rmSync(dir, { recursive: true, force: true }); }
  return { results, stages };
}

/** One HTTP exchange with the server, without keep-alive (a pooled socket still closing at process.exit trips a libuv assertion on Windows). */
function call(port, method, path, body) {
  return new Promise((done, fail) => {
    const rq = request({ host: '127.0.0.1', port, method, path, agent: false, headers: { 'content-type': 'application/json', connection: 'close' } }, (rs) => {
      let text = '';
      rs.setEncoding('utf8');
      rs.on('data', (c) => { text += c; });
      rs.on('end', () => { try { done({ status: rs.statusCode, body: JSON.parse(text) }); } catch (e) { fail(e); } });
    });
    rq.on('error', fail);
    rq.end(body);
  });
}

async function viaServer() {
  const state = resolve(ROOT, '.bench/render-server/server.json');
  const port = () => Number(args.port ?? (existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')).port : 47811));
  const alive = async () => { try { return (await call(port(), 'GET', '/status')).status === 200; } catch { return false; } };
  if (!(await alive())) {
    if (args['no-start']) throw new Error('no render server is running (start one with node tools/render-server.mjs)');
    mkdirSync(resolve(ROOT, '.bench/render-server'), { recursive: true });
    const logFile = openSync(resolve(ROOT, '.bench/render-server/server.log'), 'a');
    spawn(process.execPath, [resolve(ROOT, 'tools/render-server.mjs'), ...(args.port ? ['--port', args.port] : []), ...(args.source ? ['--source', resolve(args.source)] : [])], { detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true }).unref();
    for (let i = 0; !(await alive()); i++) { if (i > 100) throw new Error('the render server did not start: see .bench/render-server/server.log'); await new Promise((r) => setTimeout(r, 200)); }
  }
  const reply = (await call(port(), 'POST', '/shot', JSON.stringify(req))).body;
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

try {
  const result = args.fresh ? await fresh() : await viaServer();
  mkdirSync(req.out, { recursive: true });
  const timings = Object.fromEntries(Object.entries(result.results).map(([q, r]) => [q, r.timings]));
  const run = { mode: args.fresh ? 'fresh' : 'server', seconds: (performance.now() - t0) / 1000, stages: result.stages, actions: result.actions ?? null };
  await writeFile(resolve(req.out, 'timings.json'), JSON.stringify({ width: req.width, height: req.height, hour: req.hour, seed: req.seed, frames: req.frames, timed: req.timed, timings, run }, null, 2));
  for (const [q, r] of Object.entries(result.results)) Object.entries(r.timings).forEach(([name, t], i) => console.log(`${q} ${name}: ${t.medianMs?.toFixed(2)} ms median GPU -> ${r.files[i]}`));
  const stages = Object.entries(result.stages).map(([k, v]) => `${k} ${(v / 1000).toFixed(2)}`).join(', ');
  console.log(`${args.fresh ? 'fresh' : 'server'} shot in ${((performance.now() - t0) / 1000).toFixed(2)} s (${stages})`);
  process.exit(0);
} catch (error) {
  console.error(String(error?.stack ?? error));
  process.exit(1);
}
