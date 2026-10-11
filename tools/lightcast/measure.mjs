#!/usr/bin/env node
/**
 * Light-colour probe for the forest-shade colour cast. Renders the tree-shots views with the production renderer (Dawn in Node) from a
 * patched copy of src/, where every surface is a grey card (albedo 0.18, no metal) and the lighting pass writes one term only. Reads back
 * the pre-exposed HDR target and the G-buffer, and reports the mean colour of the light on cards in shade and in the open.
 *
 *   node tools/lightcast/measure.mjs --tag before --views bark-spruce,interior --hours 12,7.5 --quality ultra,extreme --terms all,sun,gi,spec
 *     [--gi sky,terrain,canopyLit,canopySky,prim] [--source <dir with src/>] [--width 960] [--frames 120] [--seed 1337]
 *     [--track tools/views/hard-210-t2.json] [--views-file tools/audit/views/vista.json] [--clouds] [--dump] [--camera game]
 *
 * Terms: real (the unpatched renderer), all, sun, gi, spec, ao, irr, alb, cav, emis, ap, apt, rtalb; an r prefix (rsun, rgi, rspec, rap)
 * keeps the real albedo. Clouds are off unless --clouds. Views default to tools/views/trees.json. The term patches match exact lines
 * of deferred.wgsl, gi.wgsl and rt_scene.wgsl: "patch: no match" means those lines changed and the patch list needs updating.
 *
 * Writes .bench/lightcast/<tag>/<view>-<quality>-<hour>-<term>.png (tonemapped final image of the 'all' term only is the real picture) and
 * results.json. A card's colour is reported as linear rgb normalised to green = 1, plus its hue in degrees.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const EXPORTS = [
  ['Renderer', 'src/render/renderer.ts'], ['createDefaultModules', 'src/render/modules.ts'], ['DEFAULT_SETTINGS', 'src/contracts.ts'],
  ['generateTerrain', 'src/world/terrain/generate.ts'], ['createTerrainSampler', 'src/world/terrain/sampler.ts'], ['generateTrack', 'src/world/track/generator.ts'],
  ['computeAstro', 'src/world/astro/clock.ts'], ['quatLookAlong', 'src/game/quat.ts'],
];

function patch(file, from, to) {
  const s = readFileSync(file, 'utf8');
  const n = s.split(from).length - 1;
  if (n < 1) throw new Error(`patch: no match in ${file} for ${from.slice(0, 80)}`);
  writeFileSync(file, s.split(from).join(to));
}

// Patched copy of src/: TERM selects the deferred output, GI_* masks the GI ray contributions by what the ray met.
function makeVariant(dir, source, term, gi) {
  rmSync(dir, { recursive: true, force: true });
  cpSync(resolve(source, 'src'), resolve(dir, 'src'), { recursive: true });
  cpSync(resolve(ROOT, 'package.json'), resolve(dir, 'package.json'));
  const deferred = resolve(dir, 'src/render/shaders/lighting/deferred.wgsl');
  if (term === 'real') return;
  // Terms starting with r are the same terms on the real albedo (no grey card).
  const realAlbedo = term.startsWith('r') && term !== 'rtalb';
  if (realAlbedo) term = term.slice(1);
  else {
    patch(deferred, 'let baseColor = alb.rgb * mix(1.0, 0.6, wet);', 'let baseColor = vec3f(0.18);');
    patch(deferred, 'let metal = saturate1(nrm.w);', 'let metal = 0.0;');
  }
  patch(deferred, 'textureStore(hdrOut, px, vec4f(clamp(color, vec3f(0.0), vec3f(MAX_HDR)), 1.0));',
    `${term === 'all' ? '' : `color = ${{
      sun: 'litDirect * pre',
      gi: 'diffuseColor * irradianceOverPi * leafAmbient',
      spec: 'specRadiance * envBrdfApprox(f0, rough, nv) * specularOcclusion(nv, ao, rough)',
      ao: 'vec3f(ao * 0.18)',
      irr: 'irradianceOverPi * 0.18',
      alb: 'alb.rgb',
      cav: 'vec3f(alb.a)',
      emis: 'emissiveShown(msc.a, pre) * alb.rgb',
      ap: 'finiteNits(ap.rgb) * pre',
      apt: 'litDirect * pre + indirect',
      rtalb: 'rtTerrainAlbedo(world)',
    }[term]};`}
  textureStore(hdrOut, px, vec4f(clamp(color, vec3f(0.0), vec3f(MAX_HDR)), 1.0));`);
  if (term === 'rtalb') patch(deferred, '@compute @workgroup_size(8, 8)', `fn rtTerrainAlbedo(p : vec3f) -> vec3f {
  let maps = terrainMapsAt(p.xz);
  let n = terrainNormalAt(p.xz);
  let rock = smoothstep(0.55, 0.8, 1.0 - n.y);
  var a = mix(vec3f(0.12, 0.16, 0.06), vec3f(0.25, 0.18, 0.11), saturate1(maps.x));
  return mix(a, vec3f(0.3), rock) * mix(1.0, 0.6, saturate1(maps.w));
}
@compute @workgroup_size(8, 8)`);
  if (gi) {
    const m = (k) => (gi.includes(k) ? '1.0' : '0.0');
    const giFile = resolve(dir, 'src/render/shaders/rt/gi.wgsl');
    if (readFileSync(giFile, 'utf8').includes('canopyLit(')) {
      // Canopy-map build: sky / terrain / prim pick the ray's end, canopyBehind / canopyScatter what the crowns pass on and add.
      patch(giFile, 'sum += canopyLit(origin, d, rp.f.w, e, skyRadiance(d, e));', `sum += ${m('sky')} * canopyLit(origin, d, rp.f.w, e, skyRadiance(d, e));`);
      patch(giFile, 'sum += canopyLit(origin, d, h.t, e, hitRadianceChord(h, origin, d, e, steps, chord));', `sum += select(${m('prim')}, ${m('terrain')}, h.kind == KIND_TERRAIN) * canopyLit(origin, d, h.t, e, hitRadianceChord(h, origin, d, e, steps, chord));`);
      patch(resolve(dir, 'src/render/shaders/rt/canopy_map.wgsl'), 'return min(behind * trans + light, vec3f(MAX_RADIANCE));', `return min(${m('canopyBehind')} * behind * trans + ${m('canopyScatter')} * light, vec3f(MAX_RADIANCE));`);
      return;
    }
    patch(giFile, 'sum += skyRadiance(d, e);', `sum += ${m('sky')} * skyRadiance(d, e);`);
    patch(giFile, 'sum += hitRadianceChord(h, origin, d, e, steps, chord);', `sum += select(select(${m('prim')}, 1.0, primIsCanopy(h.prim) && h.kind == KIND_PRIM), ${m('terrain')}, h.kind == KIND_TERRAIN) * hitRadianceChord(h, origin, d, e, steps, chord);`);
    const scene = resolve(dir, 'src/render/shaders/rt/rt_scene.wgsl');
    patch(scene, 'return mix(lit, skyRadiance(d, e), chord);', `return ${m('canopyLit')} * (1.0 - chord) * lit + ${m('canopySky')} * chord * skyRadiance(d, e);`);
  }
}

if (process.argv[2] === '--build') {
  const [, , , variantDir, outDir] = process.argv;
  const { build } = await import('vite');
  mkdirSync(outDir, { recursive: true });
  const entry = resolve(outDir, 'entry.ts');
  writeFileSync(entry, EXPORTS.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(variantDir, path).replaceAll('\\', '/'))};`).join('\n'));
  await build({ root: variantDir, configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'bundle.mjs' } } } });
  process.exit(0);
}

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 960), height = Math.round(width * 9 / 16) & ~1, seed = Number(args.seed ?? 1337);
const viewNames = (args.views ?? 'bark-spruce,interior').split(','), hours = (args.hours ?? '12,7.5').split(',').map(Number);
// --date YYYY-MM-DD (UTC; default 2026-06-21, a half moon that sets near 23:00; 2026-06-28 is a full moon up all night).
const DATE = (args.date ?? '2026-06-21').split('-').map(Number);
const qualities = (args.quality ?? 'ultra').split(','), terms = (args.terms ?? 'all,sun,gi,spec').split(',');
const giSplits = args.gi ? args.gi.split(',') : [];
const source = resolve(args.source ?? ROOT), frames = Number(args.frames ?? 120);
const OUT_ROOT = resolve(ROOT, '.bench/lightcast');
const out = resolve(OUT_ROOT, args.tag ?? 'run');
mkdirSync(out, { recursive: true });
// --track <file.json>: a track builder export (terrain seed and quality, track) as the world, with views at its gates (gate-N: 12 m before gate
// N looking through it; flyover: 40 m above the start). --views-file adds views from a JSON file ({ name: { eye, target, fov } }).
const trackFile = args.track ? JSON.parse(await readFile(resolve(args.track), 'utf8')) : null;
const views = trackFile ? {} : JSON.parse(await readFile(resolve(ROOT, 'tools/views/trees.json'), 'utf8'));
if (args['views-file']) Object.assign(views, JSON.parse(await readFile(resolve(args['views-file']), 'utf8')));
if (trackFile) {
  for (const g of trackFile.track.gates) {
    const f = [-Math.sin(g.yaw), 0, -Math.cos(g.yaw)];
    views[`gate-${g.index}`] = { eye: [g.pos[0] - f[0] * 12, g.pos[1] + 0.6, g.pos[2] - f[2] * 12], target: [g.pos[0] + f[0] * 20, g.pos[1], g.pos[2] + f[2] * 20], fov: 80 };
    // Close-up of the gate frame: 3 m off, beside the opening, looking at the frame.
    views[`gate-${g.index}-close`] = { eye: [g.pos[0] - f[0] * 3 + f[2] * 1.2, g.pos[1] - 0.3, g.pos[2] - f[2] * 3 - f[0] * 1.2], target: [g.pos[0], g.pos[1], g.pos[2]], fov: 70 };
  }
  const st = trackFile.track.start;
  views.flyover = { eye: [st.pos[0], st.pos[1] + 40, st.pos[2]], target: [st.pos[0] - 80 * Math.sin(st.yaw), st.pos[1], st.pos[2] - 80 * Math.cos(st.yaw)], fov: 80 };
}

// Every (term, gi mask) needs its own patched bundle; build them before taking the GPU.
const runs = [...terms.map((t) => ({ term: t, gi: null, name: t })), ...giSplits.map((g) => ({ term: 'gi', gi: g === 'all' ? 'sky,terrain,canopyLit,canopySky,prim' : g, name: `gi-${g}` }))];
const bundles = {};
for (const r of runs) {
  const vdir = resolve(OUT_ROOT, 'variants', `${args.tag ?? 'run'}-${r.name}`), bdir = resolve(vdir, 'bundle');
  makeVariant(vdir, source, r.term, r.gi);
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--build', vdir, bdir], { stdio: 'inherit' });
  bundles[r.name] = resolve(bdir, 'bundle.mjs');
}

const { acquireGpuLock } = await import(pathToFileURL(resolve(ROOT, 'tools/native-bench/lock.mjs')).href);
const { offscreenSurface, openRuntime } = await import(pathToFileURL(resolve(ROOT, 'tools/native-bench/runtime.mjs')).href);

function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

async function readTexture(device, texture, bpp) {
  const w = texture.width, h = texture.height, bytesPerRow = Math.ceil(w * bpp / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buffer.getMappedRange()).slice();
  buffer.unmap(); buffer.destroy();
  return { w, h, bytesPerRow, src };
}
const px16 = (t, x, y, c) => half(t.src[y * t.bytesPerRow + x * 8 + c * 2] | (t.src[y * t.bytesPerRow + x * 8 + c * 2 + 1] << 8));
const px8 = (t, x, y, c) => t.src[y * t.bytesPerRow + x * 4 + c] / 255;
const px32 = (t, x, y) => new DataView(t.src.buffer, y * t.bytesPerRow + x * 4, 4).getFloat32(0, true);

function hue([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 1e-9) return null;
  let h;
  if (mx === r) h = ((g - b) / (mx - mn)) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
  return Math.round(((h * 60) + 360) % 360);
}
const norm = (c) => c.map((v) => +(v / Math.max(c[1], 1e-12)).toFixed(3));

let release;
for (let tries = 0; !release; tries++) {
  try { release = await acquireGpuLock(); }
  catch (error) { if (tries > 5000 || !(/locked/.test(error.message) || error.code === 'EPERM')) throw error; await new Promise((done) => setTimeout(done, 3000)); }
}
// A timeout or Ctrl+C must not leave the shared GPU lock behind.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { Promise.resolve(release?.()).finally(() => process.exit(130)); });
const results = {};
let runtime;
try {
  runtime = await openRuntime({ backend: 'd3d12' });
  // Assets the renderer fetches (stars, bark scans) come from public/.
  globalThis.fetch = async (url) => { const m = /(?:^|\/)((?:data|textures)\/.+)$/.exec(String(url)); if (!m) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve(ROOT, 'public', m[1])); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  for (const r of runs) {
    const a = await import(pathToFileURL(bundles[r.name]).href);
    const terrain = trackFile ? a.generateTerrain({ seed: trackFile.terrainSeed, quality: trackFile.quality ?? 'ultra' }) : a.generateTerrain({ seed, quality: 'medium', resolution: 1024, cellSize: 2.5, relief: 220 });
    const sampler = a.createTerrainSampler(terrain);
    const track = trackFile ? trackFile.track : a.generateTrack({ seed, style: 'race', gateCount: 10, laps: 1, difficulty: 0.35 }, sampler);
    for (const quality of qualities) {
      const surf = offscreenSurface(width, height);
      const settings = { ...a.DEFAULT_SETTINGS, quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: 0, frameCap: 0, ...(args.camera === 'game' ? {} : { lensDistortion: 0, videoNoise: 0 }) };
      const modules = a.createDefaultModules();
      const t0 = Date.now();
      const renderer = await a.Renderer.create(surf.surface, settings, modules);
      console.error(`[${new Date().toISOString()}] ${r.name} ${quality}: renderer ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      try {
        renderer.setScene({ terrain, sampler, track });
        // Start-up timing per render module stage (init and setScene), the slow ones first.
        console.error(`[start-up] ${[...renderer.initTimings].sort((x, y) => y.ms - x.ms).filter((t) => t.ms >= 50).map((t) => `${t.stage} ${(t.ms / 1000).toFixed(1)} s`).join(', ')}`);
        for (const m of modules) if (m.name === 'vegetation' || m.name === 'objects') m.setWind?.([0, -1], 0);
        // Clouds off: a cloud shadow over one view and not the other would read as a colour difference.
        if (!args.clouds) modules.find((m) => m.name === 'atmosphere')?.setSettings?.({ cloudsEnabled: false });
        const camera = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 1.2, aspect: width / height, near: 0.03, far: 20000 };
        for (const hour of hours) {
          const astro = a.computeAstro(Date.UTC(DATE[0], DATE[1] - 1, DATE[2], Math.floor(hour), Math.round((hour % 1) * 60)), settings.observer);
          for (const name of viewNames) {
            const v = views[name];
            camera.pos = [...v.eye]; camera.fovY = v.fov * Math.PI / 180;
            a.quatLookAlong(...v.target.map((x, k) => x - v.eye[k]), camera.quat);
            for (let f = 0; f < frames; f++) {
              renderer.render({ dt: 1 / 60, time: 10 + f / 60, camera, astro, quad: null });
              if (f % 8 === 7) await renderer.device.queue.onSubmittedWorkDone();
              if (f === 7) console.error(`[${new Date().toISOString()}] ${name} h${hour}: 8 frames, gpu ${renderer.stats?.gpuMs?.toFixed(1)} ms`);
            }
            await renderer.device.queue.onSubmittedWorkDone();
            const g = renderer.rc.gbuf, dev = renderer.device;
            const hdr = await readTexture(dev, g.hdr, 8), misc = await readTexture(dev, g.misc, 4), nrm = await readTexture(dev, g.normal, 8);
            const shadow = await readTexture(dev, g.sunShadow, 4), alb = await readTexture(dev, g.albedo, 4);
            // Classes: bark (foliage id, no translucency), ground (terrain, sward floor, grass), each split by the traced sun shadow.
            const acc = {};
            const add = (k, c) => { const s = (acc[k] ??= { n: 0, c: [0, 0, 0] }); s.n++; for (let i = 0; i < 3; i++) s.c[i] += c[i]; };
            const sx = shadow.w / hdr.w, sy = shadow.h / hdr.h;
            // The displayed image (after white balance, tonemap and grade), decoded to linear, read per class too: disp-<class>.
            const rgba = await surf.read();
            // --dump: the pre-exposed HDR target as raw rgba16float rows (header: w, h, bytesPerRow as u32), for per-pixel term splits.
            if (args.dump) {
              const head = new Uint32Array([hdr.w, hdr.h, hdr.bytesPerRow]);
              await writeFile(resolve(out, `${name}-${quality}-${hour}-${r.name}.hdr.bin`), Buffer.concat([Buffer.from(head.buffer), Buffer.from(hdr.src.buffer, hdr.src.byteOffset, hdr.src.byteLength)]));
            }
            const lin = (u) => { const v = u / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            const dx = width / hdr.w, dy = height / hdr.h;
            for (let y = 0; y < hdr.h; y += 2) for (let x = 0; x < hdr.w; x += 2) {
              const id = Math.round(px8(misc, x, y, 0) * 255), trans = px8(misc, x, y, 1);
              {
                // The white-balance meter's grey cards (whitebalance.wgsl, without the distance cut), by material.
                const al = [px8(alb, x, y, 0), px8(alb, x, y, 1), px8(alb, x, y, 2)], hi = Math.max(...al);
                if (px8(misc, x, y, 3) === 0 && id !== 2 && id !== 8 && !(id === 5 && trans > 0) && hi >= 0.05 && Math.min(...al) >= 0.5 * hi) {
                  const l = [0, 1, 2].map((c) => px16(hdr, x, y, c) / al[c]);
                  if (l.every((v) => v > 1e-6 && v < 1e6)) { const e = [Math.log(l[0] / l[1]), Math.log(l[2] / l[1]), 1]; add('wb-all', e); add('wb-m' + id, e); }
                }
              }
              const cls = id === 5 && trans < 0.02 ? 'bark' : id === 5 ? 'leaf' : (id === 1 || id === 11 || id === 2) ? 'ground' : null;
              if (!cls) continue;
              const s = px32(shadow, Math.min(shadow.w - 1, Math.floor(x * sx)), Math.min(shadow.h - 1, Math.floor(y * sy)));
              const lit = s > 0.85 ? 'sun' : s < 0.1 ? 'shade' : null;
              if (!lit) continue;
              const c = [px16(hdr, x, y, 0), px16(hdr, x, y, 1), px16(hdr, x, y, 2)];
              if (!c.every(Number.isFinite)) continue;
              // The deferred pass multiplies by the baked cavity (albedo alpha); a card has none, so divide it out where it is not tiny.
              const cav = Math.max(px8(alb, x, y, 3), 0.05);
              add(`${cls}-${lit}`, ['sun', 'spec', 'alb', 'rtalb', 'real', 'cav', 'rsun', 'rspec', 'remis', 'rap'].includes(r.term) ? c : c.map((q) => q / cav));
              const o = (Math.min(height - 1, Math.floor(y * dy)) * width + Math.min(width - 1, Math.floor(x * dx))) * 4;
              add(`disp-${cls}-${lit}`, [lin(rgba[o]), lin(rgba[o + 1]), lin(rgba[o + 2])]);
            }
            const stat = Object.fromEntries(Object.entries(acc).filter(([, s]) => s.n >= 30).map(([k, s]) => {
              const m = s.c.map((q) => q / s.n);
              return [k, { n: s.n, rgb: m.map((q) => +q.toPrecision(4)), rel: norm(m), hue: hue(m) }];
            }));
            (results[`${name}|${quality}|${hour}`] ??= {})[r.name] = stat;
            const png = resolve(out, `${name}-${quality}-${hour}-${r.name}.png`);
            spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', '-', '-frames:v', '1', png], { input: Buffer.from(rgba.buffer) });
            console.log(`${name} ${quality} h${hour} ${r.name}: ${Object.entries(stat).map(([k, s]) => `${k} rel ${s.rel.join('/')} hue ${s.hue}`).join(' | ')}`);
          }
        }
      } finally { renderer.destroy(); }
    }
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
} finally { runtime?.close(); await release(); }
