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
    if (info) info.used = true;
    if (!modules.has(m)) modules.set(m, { desc, code: desc.code, info });
    return m;
  };
  const stages = (desc, map) => ({ ...desc, ...(desc.vertex ? { vertex: map(desc.vertex) } : {}), ...(desc.fragment ? { fragment: map(desc.fragment) } : {}), ...(desc.compute ? { compute: map(desc.compute) } : {}) });
  // A pipeline made after a swap, from a module the swap replaced, gets the new module.
  const latest = (s) => (remap.has(s.module) ? { ...s, module: remap.get(s.module) } : s);
  const record = (kind, desc, p) => { pipelines.push({ kind, desc, original: p, current: p }); return p; };
  device.createRenderPipeline = (desc) => record('render', desc, own.render(stages(desc, latest)));
  device.createComputePipeline = (desc) => record('compute', desc, own.compute(stages(desc, latest)));
  device.createRenderPipelineAsync = async (desc) => record('render', desc, await own.renderAsync(stages(desc, latest)));
  device.createComputePipelineAsync = async (desc) => record('compute', desc, await own.computeAsync(stages(desc, latest)));
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
        changed.set(orig, { code, info, module: own.createShaderModule({ ...rec.desc, code }) });
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
      for (const [orig, c] of changed) { const rec = modules.get(orig); rec.code = c.code; rec.info = c.info; remap.set(orig, c.module); }
      return { modules: changed.size, pipelines: targets.length, rebind, ms: performance.now() - t0 };
    },

    /** Forgets every module and pipeline (the renderers they belonged to are gone). */
    reset() { resolves.clear(); modules.clear(); pipelines.length = 0; swapTo.clear(); remap.clear(); bundled.clear(); },
  };
}
