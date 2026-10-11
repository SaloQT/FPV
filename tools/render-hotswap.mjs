// WGSL hot swap for the render server: records every shader module and pipeline made on the shared device, and after a WGSL edit
// recreates only the shader modules whose code included an edited file, and the pipelines built on them. Encoders' setPipeline is patched
// to draw with the newest pipeline, so the render modules keep the pipeline objects they hold. Render bundles recorded with an old
// pipeline are recorded again (Renderer.rebind).
//
// It refuses (returns { fallback }) where a swap could leave something stale: a pipeline with layout 'auto' (its bind group layouts belong
// to it alone), or a resolve that included an edited file whose code never became a shader module as it was (a module that combines or
// rewrites shader text). The worker then swaps the owning render modules instead.

/** Wraps `device`; `globals` are the webgpu package's globals (the encoder classes whose setPipeline is patched). */
export function trackPipelines(device, globals) {
  const stats = {};
  const resolves = new Map(); // code -> { path, defines, included: Set of paths under shaders/, used }
  const modules = new Map(); // original GPUShaderModule -> { desc, code (current), info }
  const pipelines = []; // { kind, desc, original, current }
  const swapTo = new Map(); // original pipeline -> current pipeline
  const remap = new Map(); // original shader module -> current one
  const bundled = new Set(); // original pipelines recorded into a render bundle

  const own = {
    createShaderModule: device.createShaderModule.bind(device),
    render: device.createRenderPipeline.bind(device), compute: device.createComputePipeline.bind(device),
    renderAsync: device.createRenderPipelineAsync.bind(device), computeAsync: device.createComputePipelineAsync.bind(device),
  };
  device.createShaderModule = (desc) => {
    const m = own.createShaderModule(desc), info = resolves.get(desc.code) ?? null;
    codeOf.set(m, desc.code);
    if (info) info.used = true;
    if (!modules.has(m)) modules.set(m, { desc, code: desc.code, info });
    return m;
  };
  const stages = (desc, map) => ({ ...desc, ...(desc.vertex ? { vertex: map(desc.vertex) } : {}), ...(desc.fragment ? { fragment: map(desc.fragment) } : {}), ...(desc.compute ? { compute: map(desc.compute) } : {}) });
  // A pipeline made after a swap, from a module the swap replaced, gets the new module.
  const latest = (s) => (remap.has(s.module) ? { ...s, module: remap.get(s.module) } : s);
  // One record per pipeline object: a module made again gets the cached object back, and the swap must compile it once.
  const record = (kind, desc, p) => { if (!recorded.has(p)) { recorded.add(p); pipelines.push({ kind, desc, original: p, current: p }); } return p; };
  let recorded = new WeakSet();

  // Pipeline cache. Dawn compiles every pipeline again (here a 'auto'-layout one each time, and the driver cache only saves part of it),
  // so a module that is initialised again (a swap, a new renderer) would pay for compiles of code that did not change. Each pipeline is
  // kept under its descriptor's content: shader code, entry points, constants, fixed state, and the layout's content (bind group layouts
  // with equal entries are interchangeable in WebGPU), or the pipeline itself for 'auto' (its layouts belong to it, and a module that gets
  // the same pipeline back reads them with getBindGroupLayout, as it would have).
  const codeOf = new WeakMap(); // shader module -> code
  const layoutKey = new WeakMap(); // bind group / pipeline layout -> content key
  const cache = new Map(); // descriptor key -> pipeline (or its promise)
  const createBindGroupLayout = device.createBindGroupLayout.bind(device), createPipelineLayout = device.createPipelineLayout.bind(device);
  device.createBindGroupLayout = (desc) => { const l = createBindGroupLayout(desc); layoutKey.set(l, JSON.stringify(desc.entries)); return l; };
  device.createPipelineLayout = (desc) => {
    const l = createPipelineLayout(desc), keys = desc.bindGroupLayouts.map((b) => layoutKey.get(b));
    if (keys.every((k) => k !== undefined)) layoutKey.set(l, JSON.stringify(keys));
    return l;
  };
  /** The content key of a (remapped) descriptor, or null when some part has no known content (then it is not cached). */
  const keyOf = (kind, desc) => {
    const layout = desc.layout === 'auto' ? 'auto' : layoutKey.get(desc.layout);
    if (layout === undefined) return null;
    let unknown = false;
    const text = JSON.stringify({ ...desc, label: undefined, layout }, (k, v) => {
      if (v && typeof v === 'object' && 'module' in v && v.module && typeof v.module === 'object') {
        const code = codeOf.get(v.module);
        if (code === undefined) unknown = true;
        return { ...v, module: code };
      }
      return v;
    });
    return unknown ? null : `${kind}\n${text}`;
  };
  const cached = (kind, desc, make) => {
    const real = stages(desc, latest), key = keyOf(kind, real);
    if (key === null) return make(real);
    if (!cache.has(key)) {
      const made = make(real);
      cache.set(key, made);
      if (made instanceof Promise) made.catch(() => cache.delete(key));
    }
    return cache.get(key);
  };
  stats.cacheHits = 0;
  const counting = (kind, desc, make) => { const n = cache.size, p = cached(kind, desc, make); if (cache.size === n) stats.cacheHits++; return p; };
  device.createRenderPipeline = (desc) => record('render', desc, counting('render', desc, own.render));
  device.createComputePipeline = (desc) => record('compute', desc, counting('compute', desc, own.compute));
  device.createRenderPipelineAsync = async (desc) => record('render', desc, await counting('render', desc, own.renderAsync));
  device.createComputePipelineAsync = async (desc) => record('compute', desc, await counting('compute', desc, own.computeAsync));
  for (const cls of ['GPURenderPassEncoder', 'GPUComputePassEncoder', 'GPURenderBundleEncoder']) {
    const proto = globals[cls]?.prototype;
    if (!proto?.setPipeline) throw new Error(`hot swap: no ${cls}.prototype.setPipeline to patch`);
    if (proto.setPipeline.fpvSwap) { proto.setPipeline.fpvSwap.table = swapTo; proto.setPipeline.fpvSwap.bundled = bundled; continue; }
    const set = proto.setPipeline, state = { table: swapTo, bundled };
    const patched = function setPipeline(p) {
      if (cls === 'GPURenderBundleEncoder') state.bundled.add(p);
      return set.call(this, state.table.get(p) ?? p);
    };
    patched.fpvSwap = state;
    proto.setPipeline = patched;
  }

  return {
    /** cacheHits: pipelines handed back from the cache instead of compiled. */
    stats,
    /** shaderLib's resolve listener feeds this: which code came from which files. */
    noteResolve(path, included, defines, code) {
      if (!resolves.has(code)) resolves.set(code, { path, defines: { ...defines }, included: new Set(included), used: false });
    },

    /**
     * Recreates what the edited files (paths under shaders/) reach, with `resolve` (shaderLib's resolveShader, already reading the new
     * text). Returns { modules, pipelines, rebind, ms } or { fallback: reason }; WGSL compile and pipeline errors throw.
     */
    async swap(edited, resolve) {
      const t0 = performance.now();
      const hit = (info) => [...edited].some((f) => info.included.has(f));
      for (const info of resolves.values()) if (hit(info) && !info.used) return { fallback: `${info.path} was resolved but not made into a shader module as is` };
      const changed = new Map(); // original module -> { code, info, module }
      for (const [orig, rec] of modules) {
        if (!rec.info || !hit(rec.info)) continue;
        const code = resolve(rec.info.path, rec.info.defines);
        if (code === rec.code) continue;
        const info = resolves.get(code) ?? { path: rec.info.path, defines: rec.info.defines, included: rec.info.included };
        info.used = true;
        resolves.set(code, info);
        const module = own.createShaderModule({ ...rec.desc, code });
        codeOf.set(module, code);
        changed.set(orig, { code, info, module });
      }
      if (!changed.size) return { modules: 0, pipelines: 0, rebind: false, ms: performance.now() - t0 };
      const errors = [];
      for (const c of changed.values()) for (const m of (await c.module.getCompilationInfo()).messages) if (m.type === 'error') errors.push(`WGSL ${c.info.path}:${m.lineNum}:${m.linePos} ${m.message}`);
      if (errors.length) throw new Error(`hot swap: WGSL compile errors\n${errors.join('\n')}`);
      const uses = (p) => [p.desc.vertex, p.desc.fragment, p.desc.compute].some((s) => s?.module && changed.has(s.module));
      const targets = pipelines.filter(uses);
      for (const p of targets) if (p.desc.layout === 'auto') return { fallback: `pipeline ${p.desc.label ?? '?'} has layout 'auto'` };
      const next = (s) => (changed.has(s.module) ? { ...s, module: changed.get(s.module).module } : latest(s));
      device.pushErrorScope('validation');
      // Compiled side by side: Dawn can spread async pipeline compiles over threads.
      const made = await Promise.all(targets.map((p) => (p.kind === 'render' ? own.renderAsync : own.computeAsync)(stages(p.desc, next))));
      const error = await device.popErrorScope();
      if (error) throw new Error(`hot swap: pipeline error: ${error.message}`);
      let rebind = false;
      targets.forEach((p, i) => { p.current = made[i]; swapTo.set(p.original, made[i]); if (bundled.has(p.original)) rebind = true; });
      // A module made again from the new text gets these back instead of compiling them a second time.
      targets.forEach((p, i) => { const key = keyOf(p.kind, stages(p.desc, next)); if (key !== null) cache.set(key, made[i]); });
      for (const [orig, c] of changed) { const rec = modules.get(orig); rec.code = c.code; rec.info = c.info; remap.set(orig, c.module); }
      return { modules: changed.size, pipelines: targets.length, rebind, ms: performance.now() - t0 };
    },

    /** Forgets every module and pipeline (the renderers they belonged to are gone). */
    reset() { resolves.clear(); modules.clear(); pipelines.length = 0; recorded = new WeakSet(); swapTo.clear(); remap.clear(); bundled.clear(); },
  };
}
