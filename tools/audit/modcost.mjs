#!/usr/bin/env node
/**
 * Per-module start-up and GPU cost of the production renderer (Dawn in Node), for any copy of src/: each module's init and setScene wall
 * time, then the frame's GPU time with every render hook of one module at a time switched off (its cost is the difference), and the
 * renderer's own pass and RT-detail timings. Track 210-t2, the gate-3 view, 12:00, default sky, one quality.
 *
 *   node tools/audit/modcost.mjs --tag work [--source .] [--quality ultra] [--width 1280] [--frames 90] [--detail 1]
 * Writes .bench/audit/modcost/<tag>.json and prints a table.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((o, v, i, all) => v.startsWith('--') ? [...o, [v.slice(2), all[i + 1]]] : o, []));
const tag = args.tag ?? 'run', source = resolve(ROOT, args.source ?? '.'), quality = args.quality ?? 'ultra';
const width = Number(args.width ?? 1280), height = Math.round(width * 9 / 16), frames = Number(args.frames ?? 90);
const out = resolve(ROOT, '.bench/audit/modcost');
mkdirSync(out, { recursive: true });
const bdir = resolve(out, `bundle-${tag}`);
execFileSync(process.execPath, [resolve(ROOT, 'tools/lightcast/measure.mjs'), '--build', source, bdir], { stdio: 'inherit' });
const a = await import(pathToFileURL(resolve(bdir, 'bundle.mjs')).href);
const { acquireGpuLock } = await import(pathToFileURL(resolve(ROOT, 'tools/native-bench/lock.mjs')).href);
const { offscreenSurface, openRuntime } = await import(pathToFileURL(resolve(ROOT, 'tools/native-bench/runtime.mjs')).href);
const trackFile = JSON.parse(await readFile(resolve(ROOT, 'tools/views/hard-210-t2.json'), 'utf8'));
const HOOKS = ['encodePre', 'encodeGBuffer', 'encodeRT', 'encodeSky', 'encodeForward'];

let release;
for (let tries = 0; !release; tries++) {
  try { release = await acquireGpuLock(); } catch (e) { if (tries > 2000 || !/locked/.test(e.message)) throw e; await new Promise(d => setTimeout(d, 3000)); }
}
const result = { tag, quality, width, height, init: {}, gpu: {} };
let runtime;
try {
  runtime = await openRuntime({ backend: 'd3d12' });
  globalThis.fetch = async (url) => { const m = /(?:^|\/)((?:data|textures)\/.+)$/.exec(String(url)); if (!m) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve(ROOT, 'public', m[1])); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const terrain = a.generateTerrain({ seed: trackFile.terrainSeed, quality: trackFile.quality ?? 'ultra' });
  const sampler = a.createTerrainSampler(terrain);
  const track = trackFile.track;
  const modules = a.createDefaultModules();
  // Wall time of every module's init and setScene, measured the same way in any copy of the source.
  for (const m of modules) for (const k of ['init', 'setScene']) {
    const f = m[k]; if (typeof f !== 'function') continue;
    m[k] = function (...p) {
      const t0 = performance.now(), r = f.apply(this, p);
      const done = () => { result.init[`${m.name} ${k}`] = +((performance.now() - t0) / 1000).toFixed(2); };
      if (r && typeof r.then === 'function') return r.then(v => { done(); return v; });
      done(); return r;
    };
  }
  const settings = { ...a.DEFAULT_SETTINGS, quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: 0, frameCap: 0 };
  const surf = offscreenSurface(width, height);
  const t0 = performance.now();
  const renderer = await a.Renderer.create(surf.surface, settings, modules, undefined, { gpuProfile: !!args.detail });
  result.init.rendererCreate = +((performance.now() - t0) / 1000).toFixed(2);
  const t1 = performance.now();
  renderer.setScene({ terrain, sampler, track });
  result.init.setSceneTotal = +((performance.now() - t1) / 1000).toFixed(2);
  const g = track.gates[3], f = [-Math.sin(g.yaw), 0, -Math.cos(g.yaw)];
  const eye = [g.pos[0] - f[0] * 12, g.pos[1] + 0.6, g.pos[2] - f[2] * 12], target = [g.pos[0] + f[0] * 20, g.pos[1], g.pos[2] + f[2] * 20];
  const camera = { pos: eye, quat: [0, 0, 0, 1], fovY: 80 * Math.PI / 180, aspect: width / height, near: 0.03, far: 20000 };
  a.quatLookAlong(...target.map((x, k) => x - eye[k]), camera.quat);
  const astro = a.computeAstro(Date.UTC(2026, 5, 21, 12, 0), settings.observer);
  let time = 10;
  const run = async (n) => {
    const gpu = [], passes = [];
    for (let i = 0; i < n; i++) {
      renderer.render({ dt: 1 / 60, time: time += 1 / 60, camera, astro, quad: null });
      if (i % 4 === 3) await renderer.device.queue.onSubmittedWorkDone();
      const s = renderer.stats;
      if (i >= n / 3 && s.gpuMs) { gpu.push(s.gpuMs); if (s.passMs) passes.push([...s.passMs]); }
    }
    await renderer.device.queue.onSubmittedWorkDone();
    gpu.sort((p, q) => p - q);
    const med = gpu[gpu.length >> 1] ?? NaN;
    const pm = passes.length ? passes[0].map((_, j) => { const v = passes.map(p => p[j]).filter(Number.isFinite).sort((p, q) => p - q); return v[v.length >> 1]; }) : [];
    return { med, pm };
  };
  await run(frames * 2); // warm-up: probes, TAA, exposure, streaming
  const base = await run(frames);
  result.gpu.full = +base.med.toFixed(3);
  result.gpu.passMs = base.pm.map(v => +(+v).toFixed(3));
  // --detail: the renderer's detailed timestamps (RT sub-passes, clouds), median over a run.
  if (args.detail && renderer.timer?.listen) {
    const samples = [];
    const stop = renderer.timer.listen((t) => { if (t.detailMs) samples.push(t.detailMs); });
    await run(frames);
    stop();
    result.gpu.detailMs = Object.fromEntries(Object.keys(samples[0] ?? {}).map((k) => { const v = samples.map((x) => x[k]).filter(Number.isFinite).sort((p, q) => p - q); return [k, v.length ? +v[v.length >> 1].toFixed(3) : null]; }));
  }
  for (const m of modules) {
    const saved = {};
    for (const h of HOOKS) if (typeof m[h] === 'function') { saved[h] = m[h]; m[h] = () => {}; }
    if (!Object.keys(saved).length) continue;
    const off = await run(frames);
    Object.assign(m, saved);
    result.gpu[m.name] = +(base.med - off.med).toFixed(3);
  }
  renderer.destroy();
} finally { runtime?.close(); await release(); }
writeFileSync(resolve(out, `${tag}.json`), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
