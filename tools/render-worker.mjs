// The render server's worker process (tools/render-server.mjs forks it): keeps the Dawn device, the shot bundle, the scenes and the
// renderers between shot requests, and after an edit rebuilds only what the edit reaches. Messages: { id, req } -> { id, ok, result | error }.
//
// What an edit to a source file costs, by where the file sits in the import graph (read from the sources with the bundle's importClosure):
// - outside the bundle (UI, tests): nothing;
// - in the renderer core (renderer.ts and what it imports, less the render modules): a new renderer on the same device (Dawn's pipeline
//   cache keeps unchanged pipelines);
// - in render modules only: those modules are swapped for new instances (Renderer.replaceModules), the rest of the renderer is kept;
// - in the world generators: the scene is generated again and set on the renderer.
// WGSL edits go the same way, by which shaders each module and the core resolved (shaderLib's resolve listener). Anything the closures do
// not account for rebuilds everything.
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { offscreenSurface } from './native-bench/runtime.mjs';
import { trackPipelines } from './render-hotswap.mjs';
import {
  ROOT, applyModuleSettings, checkErrors, checkRequest, installFetch, makeScene, openSharedGpu, rendererOptions, renderViews, sceneKey, settingsFor, viewsOf,
  waitForGpuLock,
} from './render-core.mjs';

const BUNDLES = resolve(ROOT, '.bench/render-server', `bundles-${process.pid}`);
/** The checkout whose src/ is rendered: this one, or FPV_RENDER_SOURCE (render-server.mjs --source, for a scratch copy). */
const SOURCE = resolve(process.env.FPV_RENDER_SOURCE || ROOT);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[render-worker]', ...a);
const FULL = process.env.FPV_RENDER_SERVER_FULL === '1'; // every edit rebuilds the renderer (to rule the partial paths out)
/** Renderers kept resident (one per quality and size); render-server.mjs --keep. */
const KEEP = Math.max(1, Number(process.env.FPV_RENDER_SERVER_KEEP ?? 2));

/** The entry file of each default render module, by module name; a module missing here is rebuilt with the whole renderer. */
const MODULE_ENTRIES = {
  atmosphere: 'src/render/atmosphere/index.ts', terrain: 'src/render/terrain/index.ts', vegetation: 'src/render/vegetation/index.ts',
  objects: 'src/render/objects/index.ts', park: 'src/render/park/index.ts', rt: 'src/render/rt/index.ts',
};
const STAGE_ENTRIES = { lighting: 'src/render/lighting.ts', post: 'src/render/post/index.ts' };
const SCENE_ENTRIES = ['src/world/terrain/generate.ts', 'src/world/terrain/sampler.ts', 'src/world/track/generator.ts'];

/** Every file under src/ (posix path from the repo root) with its size and mtime, to tell which files an edit touched. */
function snapshot() {
  const out = new Map();
  const walk = (dir, rel) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, d.name), r = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(p, r);
      else if (/\.(ts|wgsl|json|css)$/.test(d.name) && !d.name.endsWith('.test.ts')) { const s = statSync(p); out.set(r, `${s.size}:${s.mtimeMs}`); }
    }
  };
  walk(resolve(SOURCE, 'src'), 'src');
  return out;
}

const hashes = new Map();
function contentHash(rel) { try { return createHash('sha1').update(readFileSync(resolve(SOURCE, rel))).digest('hex'); } catch { return 'gone'; } }
/** Files whose content differs between two snapshots (a touched file with the same bytes does not count). */
function changedFiles(before, after) {
  const out = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(k) === after.get(k)) continue;
    const h = contentHash(k);
    if (hashes.get(k) !== h) out.push(k);
    hashes.set(k, h);
  }
  return out;
}

const bundler = fork(resolve(ROOT, 'tools/render-bundler.mjs'), [], { stdio: 'inherit' });
let bundleSeq = 0;
function bundle() {
  // Every build goes to one folder: a file whose name (its content hash) is already there is the same module, and stays one instance.
  const id = ++bundleSeq, dir = resolve(BUNDLES, 'modules');
  return new Promise((done, fail) => {
    const on = (m) => { if (m.id !== id) return; bundler.off('message', on); m.ok ? done(m) : fail(new Error(m.error)); };
    bundler.on('message', on);
    bundler.send({ id, dir, source: SOURCE });
  });
}

/** The .ts sources under src/ (tests left out), path -> text, for the import closures. */
function tsSources(snap) {
  const out = {};
  for (const k of snap.keys()) if (k.endsWith('.ts')) out[k] = readFileSync(resolve(SOURCE, k), 'utf8');
  return out;
}

/**
 * The import closures the decisions need: the core (renderer.ts with the module list cut off), each module, the scene generators. A
 * closure with an import it cannot follow is marked open: any edit reaches it. (WGSL globs select no .ts file; the shader log covers them.)
 */
function closures(a, snap) {
  const sources = tsSources(snap);
  // The core less what it hands out: the module list, and the two stages the renderer can swap on its own (Renderer.replaceStages).
  const cut = { ...sources, 'src/render/modules.ts': '', [STAGE_ENTRIES.lighting]: '', [STAGE_ENTRIES.post]: '' };
  const make = (entries, src = sources) => {
    const c = a.importClosure(src, entries);
    if (c.missing.length) log(`closure of ${entries.join(', ')} is open: ${c.missing.join('; ')}`);
    return { files: new Set(c.files), open: c.missing.length ? c.missing : null };
  };
  return {
    // The stage files themselves are reached from the core, with their imports cut: they belong to their stage.
    core: ((c) => { for (const e of Object.values(STAGE_ENTRIES)) c.files.delete(e); return c; })(make(['src/render/renderer.ts'], cut)),
    modules: Object.fromEntries(Object.entries(MODULE_ENTRIES).map(([name, entry]) => [name, make([entry])])),
    scene: make(SCENE_ENTRIES),
    stages: Object.fromEntries(Object.entries(STAGE_ENTRIES).map(([name, entry]) => [name, make([entry])])),
  };
}

/** Records the device's shader modules and pipelines for WGSL hot swaps (render-hotswap.mjs); made with the device. */
let tracker = null;
const gpu = await openSharedGpu({ backend: process.env.FPV_GPU_BACKEND ?? 'd3d12', onDevice: (device) => { tracker = trackPipelines(device, globalThis); } });
/** The current code: the bundle's exports, its source snapshot, serial number, closures, and the files changed since each older serial. */
let code = null;
const changesBySerial = new Map(); // serial -> files changed to reach it from serial - 1
const scenes = new Map(); // seed -> { scene, serial it was checked at, gen (a new number each time one is generated) }
let sceneGens = 0;
const renderers = new Map(); // config key -> { renderer, read, modules, serial, shaders }

/** WGSL text by path under src/render/shaders/, which the per-module bundle's shader modules read (render-bundler.mjs wgslFromGlobal). */
globalThis.__FPV_WGSL__ = {};
const loadWgsl = (rel) => { globalThis.__FPV_WGSL__[rel.replace(/^src\/render\/shaders\//, '')] = readFileSync(resolve(SOURCE, rel), 'utf8'); };

/**
 * Brings the code up to the sources on disk. A WGSL edit goes straight into the live shaderLib (setShaderSource); a TypeScript edit
 * rebuilds the bundle, and counts only where a module's own code changed (a comment does not). Each serial records what it changed.
 */
async function refreshCode(stages) {
  const t0 = performance.now();
  const snap = snapshot();
  if (!code) {
    for (const k of snap.keys()) { hashes.set(k, contentHash(k)); if (k.endsWith('.wgsl')) loadWgsl(k); }
    stages.scan = performance.now() - t0;
    const built = await timed(stages, 'bundle', bundle);
    const a = await timed(stages, 'import', () => import(pathToFileURL(built.file).href));
    listenShaders(a);
    code = { a, snap, serial: 0, entry: built.file, bundled: new Set(built.modules), closures: timed(stages, 'closures', () => closures(a, snap)) };
    log(`bundle: ${built.ms.toFixed(0)} ms, ${built.written} module files`);
    return;
  }
  const prev = code.snap, changed = changedFiles(prev, snap);
  stages.scan = performance.now() - t0;
  code.snap = snap;
  if (!changed.length) return;
  const wgsl = changed.filter((f) => f.endsWith('.wgsl')), other = changed.filter((f) => !f.endsWith('.wgsl'));
  for (const f of wgsl) { if (snap.has(f)) { loadWgsl(f); code.a.setShaderSource(f.replace(/^src\/render\/shaders\//, ''), globalThis.__FPV_WGSL__[f.replace(/^src\/render\/shaders\//, '')]); } }
  let ts = [];
  if (other.length) {
    let built;
    try { built = await timed(stages, 'bundle', bundle); }
    catch (error) {
      // A file saved half-way (or with an error): forget these edits were seen, so the next shot tries them again.
      for (const f of other) { hashes.delete(f); code.snap.set(f, 'unread'); }
      if (wgsl.length) { code.serial++; changesBySerial.set(code.serial, wgsl); }
      throw error;
    }
    // A new or deleted file, or a non-TS one the bundle reads, counts as it is; TS files count where their own code changed.
    ts = [...new Set([...built.codeChanged, ...other.filter((f) => !f.endsWith('.ts') || !snap.has(f) || !prev.has(f))])];
    // A new entry file means new code; written can be 0 when an edit was undone (its files are on disk from before).
    if (built.file !== code.entry) {
      code.entry = built.file;
      // No cache-busting query: file names are content hashes, and unchanged module files must resolve to the instances already loaded.
      const a = await timed(stages, 'import', () => import(pathToFileURL(built.file).href));
      listenShaders(a);
      code.a = a;
      code.bundled = new Set(built.modules);
      code.closures = timed(stages, 'closures', () => closures(a, snap));
    }
    log(`bundle: ${built.ms.toFixed(0)} ms, ${built.written} new module files; edited ${other.join(', ')}; code changed in ${ts.join(', ') || 'none'}`);
  }
  if (!wgsl.length && !ts.length) return;
  code.serial++;
  changesBySerial.set(code.serial, [...wgsl, ...ts]);
  if (wgsl.length) log(`shaders edited: ${wgsl.join(', ')}`);
}

function timed(stages, name, fn) {
  const t = performance.now(), v = fn();
  if (v instanceof Promise) return v.then((x) => { stages[name] = performance.now() - t; return x; });
  stages[name] = performance.now() - t;
  return v;
}

/** Files changed between serial `from` and the current code, or null when that history is gone. */
function changedSince(from) {
  const out = new Set();
  for (let s = from + 1; s <= code.serial; s++) {
    const c = changesBySerial.get(s);
    if (!c) return null;
    for (const f of c) out.add(f);
  }
  return [...out];
}

/**
 * What the edits since `serial` need done to a renderer built then: { full } (new renderer), or { modules: names to swap, scene: bool }.
 * `shaders` maps 'core' and each module name to the WGSL files it resolved.
 */
function plan(files, shaders, { skipWgsl = false } = {}) {
  if (files === null || FULL) return { full: 'history' };
  const { core, modules, scene, stages } = code.closures;
  const stageSwap = new Set();
  const swap = new Set();
  let newScene = false;
  for (const f of files) {
    if (f.endsWith('.wgsl')) {
      if (skipWgsl) continue;
      // The log hears every resolve for the renderer's life, so a file it never heard of is in none of its pipelines.
      if (shaders.core.has(f)) return { full: f };
      for (const [name, set] of Object.entries(shaders)) if (name !== 'core' && name !== 'all' && set.has(f)) swap.add(name);
      continue;
    }
    if (!f.endsWith('.ts')) { if (code.bundled.has(f)) return { full: f }; continue; }
    if (core.open || core.files.has(f)) return { full: f };
    // Only the lighting or post-processing code: the renderer swaps that stage alone. Shared with a module, the two would disagree.
    const inStages = Object.entries(stages).filter(([, c]) => c.open || c.files.has(f)).map(([name]) => name);
    if (inStages.length) {
      if (Object.values(modules).some((c) => c.open || c.files.has(f))) return { full: f };
      for (const name of inStages) stageSwap.add(name);
      continue;
    }
    let hit = false;
    for (const [name, c] of Object.entries(modules)) if (c.open || c.files.has(f)) { swap.add(name); hit = true; }
    if (scene.open || scene.files.has(f)) { newScene = true; hit = true; }
    // In the bundle but in no closure: the closures missed a path to it.
    if (!hit && code.bundled.has(f)) return { full: f };
  }
  return { modules: [...swap], scene: newScene, stages: [...stageSwap] };
}

/**
 * Which WGSL files the resident renderer resolved, by owner: a module's name while its init runs, else 'core' (the core's own shaders,
 * and anything resolved later, which then rebuilds the renderer when edited). Every imported bundle reports here through shaderLib's
 * resolve listener.
 */
const shaderLog = { sets: null, owner: 'core' };
function listenShaders(a) {
  a.setShaderListener((path, included, defines, code) => {
    tracker?.noteResolve(path, included, defines, code);
    const sets = shaderLog.sets;
    if (!sets) return;
    const set = (sets[shaderLog.owner] ??= new Set());
    for (const f of included) { set.add(`src/render/shaders/${f}`); sets.all.add(`src/render/shaders/${f}`); }
  });
}
/** Wraps each module's init so the shaders it resolves are logged under its name. */
function attributeShaders(modules) {
  for (const m of modules) {
    const init = m.init.bind(m);
    m.init = async (rc) => { shaderLog.owner = m.name; try { return await init(rc); } finally { shaderLog.owner = 'core'; } };
  }
}

function dropRenderers() {
  for (const r of renderers.values()) r.renderer.destroy();
  renderers.clear();
  tracker?.reset();
}

/** A renderer of `quality` for `req`, built from the current code, on `scene`, with its shader log. */
async function buildRenderer(req, quality, scene, sceneGen) {
  const a = code.a;
  const out = offscreenSurface(req.width, req.height);
  const modules = a.createDefaultModules().filter((m) => !req.skip.includes(m.name));
  const shaders = { core: new Set(), all: new Set() };
  shaderLog.sets = shaders;
  attributeShaders(modules);
  const renderer = await a.Renderer.create(out.surface, settingsFor(a, quality, req), modules, undefined, rendererOptions(req));
  renderer.setScene(scene);
  applyModuleSettings(modules, req);
  return { renderer, read: out.read, modules, serial: code.serial, sceneGen, shaders };
}

async function shot(req) {
  checkRequest(req);
  const stages = {}, t0 = performance.now();
  const views = await viewsOf(req);
  await refreshCode(stages);
  const a = code.a;
  installFetch({ noScans: req.noScans });
  const results = {}, actions = {};
  for (const quality of req.qualities) {
    // The scene, generated again only when an edit reached the world generators.
    let t = performance.now();
    const sk = sceneKey(req, quality), prevScene = scenes.get(sk);
    if (!prevScene || (prevScene.serial !== code.serial && (() => { const f = changedSince(prevScene.serial); return f === null || code.closures.scene.open || f.some((x) => code.closures.scene.files.has(x)); })())) {
      scenes.delete(sk);
      scenes.set(sk, { scene: makeScene(a, req, quality), serial: code.serial, gen: ++sceneGens });
      while (scenes.size > 3) scenes.delete(scenes.keys().next().value); // terrains are big: keep the last three
    } else prevScene.serial = code.serial;
    const { scene, gen: sceneGen } = scenes.get(sk);
    stages[`scene ${quality}`] = performance.now() - t;
    const key = JSON.stringify([req.mode, quality, req.width, req.height, req.skip, req.noScans, req.noClouds, req.atmos, req.settings, req.wind]);
    t = performance.now();
    let entry = renderers.get(key), action = 'reuse';
    if (entry && entry.serial !== code.serial) {
      const files = changedSince(entry.serial), wgsl = files?.filter((f) => f.endsWith('.wgsl')) ?? [];
      let p = plan(files, entry.shaders, { skipWgsl: true }), rebind = false;
      // Shader edits: swap just the pipelines when the TS edits leave the renderer standing; else what the shader log says.
      if (!p.full && wgsl.length && !FULL) {
        try {
          const r = await tracker.swap(new Set(wgsl.map((f) => f.replace(/^src\/render\/shaders\//, ''))), a.resolveShader);
          if (r.fallback) { log(`pipeline swap refused (${r.fallback}), swapping modules`); p = plan(files, entry.shaders); }
          // Always rebind: another resident renderer may have made the swap already, and its bundles still hold the old pipelines.
          else { rebind = true; action = `pipelines ${r.pipelines} (${r.ms.toFixed(0)} ms)`; }
        } catch (error) {
          // A shader that does not compile fails the shot, as it would a fresh renderer; the renderer is rebuilt next time.
          entry.renderer.destroy(); renderers.delete(key);
          throw error;
        }
      }
      if (p.full) { action = `rebuild (${p.full})`; entry.renderer.destroy(); renderers.delete(key); entry = null; }
      else {
        if (p.modules.length) action = `${action === 'reuse' ? '' : `${action}, `}swap ${p.modules.join(',')}`;
        try {
          if (p.modules.length) {
            const fresh = a.createDefaultModules().filter((m) => p.modules.includes(m.name) && entry.modules.some((o) => o.name === m.name));
            for (const m of fresh) entry.shaders[m.name] = new Set();
            attributeShaders(fresh);
            const before = entry.renderer.initTimings.length;
            await entry.renderer.replaceModules(fresh, a.resolveShader);
            log(`swapped: ${entry.renderer.initTimings.slice(before).map((s) => `${s.stage} ${(s.ms / 1000).toFixed(2)} s`).join(', ')}`);
            entry.modules = entry.modules.map((o) => fresh.find((m) => m.name === o.name) ?? o);
            applyModuleSettings(fresh, req);
          }
          if (p.stages?.length) {
            await entry.renderer.replaceStages({ ...(p.stages.includes('lighting') ? { lighting: a.DeferredLighting } : {}), ...(p.stages.includes('post') ? { post: a.createPostProcessor() } : {}) });
            action = `${action === 'reuse' ? '' : `${action}, `}swap ${p.stages.join(',')} stage`;
          }
          // Render bundles still hold the old pipelines: have them recorded again.
          if (rebind) entry.renderer.rebind();
          entry.serial = code.serial;
        } catch (error) {
          log(`module swap failed, rebuilding: ${error?.message ?? error}`);
          action = 'rebuild (swap failed)'; entry.renderer.destroy(); renderers.delete(key); entry = null;
        }
      }
    }
    if (entry && entry.sceneGen !== sceneGen) {
      entry.renderer.setScene(scene); applyModuleSettings(entry.modules, req); entry.sceneGen = sceneGen; action += ' + scene';
    }
    if (!entry) {
      if (!action.startsWith('rebuild')) action = 'build';
      // At most KEEP renderers resident (the oldest goes first): other agents need the GPU memory too.
      while (renderers.size >= KEEP) { const [k, old] = renderers.entries().next().value; old.renderer.destroy(); renderers.delete(k); }
      if (!renderers.size) tracker?.reset();
      entry = await buildRenderer(req, quality, scene, sceneGen);
      renderers.set(key, entry);
    } else {
      entry.renderer.resetHistory();
      renderers.delete(key); renderers.set(key, entry); // most recently used last
    }
    actions[quality] = action;
    stages[`prepare ${quality}`] = performance.now() - t;
    t = performance.now();
    entry.renderer.device.pushErrorScope('validation');
    try {
      results[quality] = await renderViews(a, entry.renderer, entry.read, req, quality, views, { raw: !!req.raw });
      await checkErrors(entry.renderer);
    } catch (error) {
      // A renderer that failed is not trusted again.
      entry.renderer.destroy(); renderers.delete(key);
      throw error;
    }
    stages[`render ${quality}`] = performance.now() - t;
  }
  stages.total = performance.now() - t0;
  log(`shot ${Object.entries(actions).map(([q, x]) => `${q}: ${x}`).join('; ')} in ${(stages.total / 1000).toFixed(2)} s`);
  return { results, stages, actions, serial: code.serial };
}

/** Renderers idle this long are dropped (their GPU memory freed for the other agents); the device, bundle and scenes stay. */
const IDLE_MS = Number(process.env.FPV_RENDER_SERVER_IDLE_MIN ?? 10) * 60000;
let idleTimer = null;

process.on('message', async ({ id, req }) => {
  let release;
  const t0 = performance.now();
  clearTimeout(idleTimer);

  try {
    release = await waitForGpuLock(Number(req.lockWait ?? 30));
    const lockWait = performance.now() - t0;
    const result = await serially(() => shot(req));
    result.stages.lockWait = lockWait;
    process.send({ id, ok: true, result, rss: process.memoryUsage().rss });
  } catch (error) {
    process.send({ id, ok: false, error: String(error?.stack ?? error), rss: process.memoryUsage().rss });
  } finally {
    await release?.();
    idleTimer = setTimeout(() => { if (renderers.size) { log('idle: dropping renderers'); dropRenderers(); } }, IDLE_MS);
  }
});
/** Shots and the watcher's pre-bundling run one at a time: the code must not change under a render. */
let chain = Promise.resolve();
function serially(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// Bundle as soon as a file is saved, so the shot that follows finds the new code imported and its closures read (WGSL waits for the
// shot: its pipelines compile on the GPU, under the lock).
let pending = null;
try {
  watch(resolve(SOURCE, 'src'), { recursive: true }, (_, file) => {
    if (!code || !file || !/\.ts$/.test(file) || /\.test\.ts$/.test(file)) return;
    clearTimeout(pending);
    pending = setTimeout(() => serially(() => refreshCode({})).catch((e) => log(`pre-bundle failed: ${e?.message ?? e}`)), 150);
  });
} catch (e) { log(`no file watcher (${e?.message ?? e}); edits are picked up at the next shot`); }

process.on('disconnect', () => { dropRenderers(); gpu.close(); bundler.disconnect(); rmSync(BUNDLES, { recursive: true, force: true }); process.exit(0); });
process.send({ ready: true });
