#!/usr/bin/env node
/** One slow aerial orbit while the park beneath it changes from seed to seed, rendered offline by the production renderer and encoded
 * with ffmpeg (libx265). Every park is generated once first, to place a single steady orbit round all of them; then each is generated
 * again, run for a while so its rides and guests are going, and filmed along that orbit, which is a function of video time alone. The
 * last part of one park's shot and the first part of the next are filmed at the same camera times, and the new park phases in over the
 * old one along a soft, noisy edge with a faint glow, sweeping from a different direction each time. There is no black between parks.
 *
 *   node tools/park-seed-orbit.mjs --out .bench/park-orbit/orbit.mp4 [--count 30 | --seeds 1337,7:mega,42:compact] [--park destination]
 *     [--duration 60 | --hold 12] [--phase 1] [--width 3840] [--fps 60] [--quality ultra] [--hour 15] [--crf 16] [--preset medium]
 *
 * --seeds takes seed or seed:size entries (a bare seed uses --park); --count makes that many seeds, starting at 1337. --duration sets the
 * whole video's length and divides it between the parks; --hold sets each park's share instead. --phase is the seconds one park takes to
 * phase into the next. The phase holds the old park's frames in memory: 4 bytes a pixel, so about 2 GB a second at 4K 60 fps. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { offscreenSurface, openRuntime } from './native-bench/runtime.mjs';
import { drawtextFont, drawtextText, frameReader, loadParkModules, smoother, startEncoder } from './park-video-common.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 3840), height = Math.round(width * 9 / 16), fps = Number(args.fps ?? 60), quality = args.quality ?? 'ultra', hour = Number(args.hour ?? 15);
const defaultSize = args.park ?? 'destination';
let entries;
if (args.count) {
  // 1337 first, then a fixed sequence of five-digit seeds, so the same --count always films the same parks.
  entries = []; let state = 1337;
  for (let i = 0; i < Number(args.count); i++) { entries.push([i ? 10000 + state % 90000 : 1337]); state = (Math.imul(state, 1103515245) + 12345) >>> 1; }
} else entries = (args.seeds ?? '1337,7:mega,42:compact,2024,31415:mega,90210').split(',').map(item => item.split(':'));
const seeds = entries.map(([seed]) => Number(seed)), sizes = entries.map(([, size]) => size ?? defaultSize);
const phase = Number(args.phase ?? 1), hold = args.duration ? (Number(args.duration) - phase) / seeds.length : Number(args.hold ?? 12);
const crf = Number(args.crf ?? 16), preset = args.preset ?? 'medium';
if (!(width >= 320 && width <= 7680 && width % 16 === 0) || !(fps >= 24 && fps <= 120) || !seeds.length || !seeds.every(Number.isInteger) || !sizes.every(size => ['compact', 'destination', 'mega'].includes(size))) throw new Error('Invalid --width (multiple of 16), --fps, --seeds, --count or --park');
if (!(phase > 0 && hold >= phase + 0.4 && hold <= 120) || !['low', 'medium', 'high', 'ultra', 'extreme'].includes(quality) || !(crf >= 0 && crf <= 51)) throw new Error('Invalid --hold or --duration (each park needs at least --phase + 0.4 s), --phase, --quality or --crf');
const out = resolve(args.out ?? '.bench/park-orbit/orbit.mp4'); await mkdir(dirname(out), { recursive: true });
const a = await loadParkModules(resolve(dirname(out), 'bundle'));
const FONT = { label: drawtextFont('tools/fonts/inter/Inter-SemiBold.ttf'), light: drawtextFont('tools/fonts/inter/InterDisplay-Light.ttf') };
const LAYOUT_NAMES = { hub: 'Hub', loop: 'Loop', valley: 'Valley', boardwalk: 'Boardwalk' };
const title = text => text[0].toUpperCase() + text.slice(1);

/** A smooth field over the frame in [0, 1]: a few octaves of value noise mixed with a ramp along `direction`, so the new park arrives in
 * soft islands that sweep across the picture. A pixel switches to the new park once the phase passes its field value. */
function phaseField(w, h, direction, salt) {
  const field = new Float32Array(w * h), dx = Math.cos(direction), dy = Math.sin(direction);
  const hash = (x, y, o) => { let n = (x * 374761393 + y * 668265263 + o * 2147483647 + salt * 1013904223) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const octaves = [[h / 3.2, 0.55], [h / 8, 0.3], [h / 22, 0.15]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (const [cell, weight] of octaves) {
      const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), o = cell | 0;
      const top = hash(ix, iy, o) + (hash(ix + 1, iy, o) - hash(ix, iy, o)) * sx, bottom = hash(ix, iy + 1, o) + (hash(ix + 1, iy + 1, o) - hash(ix, iy + 1, o)) * sx;
      v += weight * (top + (bottom - top) * sy);
    }
    field[y * w + x] = 0.45 * v + 0.55 * ((x / w - 0.5) * dx + (y / h - 0.5) * dy * (h / w));
  }
  let min = Infinity, max = -Infinity; for (const v of field) { min = Math.min(min, v); max = Math.max(max, v); }
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) / (max - min);
  return field;
}
/** Phases the old frame into the new one in place (u from 0 to 1): pixels past the moving edge show the new park, a soft band blends
 * the two, and the band itself is lifted slightly so the edge reads as light. */
function phaseInto(next, previous, field, u) {
  const soft = 0.18, glow = 28, edge = u * (1 + soft);
  for (let p = 0, i = 0; p < field.length; p++, i += 4) {
    const w = (edge - field[p]) / soft;
    if (w >= 1) continue;
    if (w <= 0) { next[i] = previous[i]; next[i + 1] = previous[i + 1]; next[i + 2] = previous[i + 2]; continue; }
    const s = w * w * (3 - 2 * w), lift = glow * 4 * s * (1 - s);
    next[i] = Math.min(255, previous[i] + (next[i] - previous[i]) * s + lift);
    next[i + 1] = Math.min(255, previous[i + 1] + (next[i + 1] - previous[i + 1]) * s + lift);
    next[i + 2] = Math.min(255, previous[i + 2] + (next[i + 2] - previous[i + 2]) * s + lift);
  }
}
/** Where a park sits and how far its rides reach from there. */
function measure(park) {
  const centre = park.rides.reduce((c, r) => c.map((x, i) => x + r.pos[i] / park.rides.length), [0, 0, 0]);
  let reach = 60;
  for (const r of park.rides) {
    let far = r.radius;
    if (r.curve) for (let i = 0; i < r.curve.count; i += 4) far = Math.max(far, Math.hypot(r.curve.samples[i * a.CURVE_STRIDE] - r.pos[0], r.curve.samples[i * a.CURVE_STRIDE + 2] - r.pos[2]));
    reach = Math.max(reach, Math.hypot(r.pos[0] - centre[0], r.pos[2] - centre[2]) + far);
  }
  return { centre, reach };
}

const release = await acquireGpuLock(); let renderer, runtime, encoder, exitCode = 0;
try {
  const began = performance.now();
  // First pass: every park once, for one steady orbit round them all and for the facts in its title.
  const facts = seeds.map((seed, k) => {
    const recipe = a.defaultParkRecipe(seed, sizes[k]), park = a.buildPark(recipe).park, { centre, reach } = measure(park);
    console.log(`measured ${k + 1}/${seeds.length}: seed ${seed}, ${sizes[k]}, ${park.layout} layout, ${park.rides.length} rides`);
    return { centre, reach, layout: park.layout, rides: park.rides.length, coasters: park.rides.filter(r => r.curve).length, guests: recipe.guests };
  });
  const centre = facts.reduce((c, f) => c.map((x, i) => x + f.centre[i] / facts.length), [0, 0, 0]);
  const reaches = facts.map(f => Math.hypot(f.centre[0] - centre[0], f.centre[2] - centre[2]) + f.reach).sort((p, q) => p - q), reach = reaches[Math.floor(reaches.length / 2)];

  runtime = await openRuntime({ backend: args.backend ?? 'd3d12' });
  globalThis.fetch = async url => { if (!/(^|\/)data\/stars\.bin$/.test(String(url))) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve('public/data/stars.bin')); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const surface = offscreenSurface(width, height);
  const settings = { ...a.DEFAULT_SETTINGS, quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: fps, frameCap: 0, lensDistortion: 0, videoNoise: 0 };
  renderer = await a.Renderer.create(surface.surface, settings, a.createDefaultModules()); renderer.setDisplayRefresh(fps, 'override'); renderer.device.pushErrorScope('validation');
  const astro = a.computeAstro(Date.UTC(2026, 5, 21, Math.floor(hour), Math.round((hour % 1) * 60)), settings.observer);

  const frameTime = 1 / fps, holdFrames = Math.round(hold * fps), phaseFrames = Math.round(phase * fps), settle = Math.round(0.75 * fps);
  const total = seeds.length * holdFrames + phaseFrames, end = total / fps;
  console.log(`${seeds.length} parks, ${(holdFrames / fps).toFixed(3)} s each, ${total} frames (${end.toFixed(2)} s) at ${width}x${height} ${fps} fps, quality ${quality}`);

  // The orbit is a function of video time only, so the outgoing and incoming parks are filmed from identical cameras.
  const orbit = t => {
    const angle = 0.4 + t * (2 * Math.PI / 110), distance = reach * 1.2, rise = reach * (0.42 + 0.04 * Math.sin(t * 0.21));
    return { eye: [centre[0] + Math.cos(angle) * distance, centre[1] + rise + 15, centre[2] + Math.sin(angle) * distance], target: [centre[0], centre[1] + 4, centre[2]] };
  };

  // Titles: a spaced label that stays for the whole video, then for each park its seed in light display type and a line of facts,
  // switched half way through each phase. With time to spare (a hold of 6 s or more) each line rises a little as it fades in.
  const spaced = text => [...text].join(' '), x = Math.round(width * 0.05), base = Math.round(height * 0.9), shadow = Math.max(1, Math.round(height / 900));
  const draw = (text, font, size, color, bottom, from, to, fade, rise) => {
    const p = `clip((t-${from.toFixed(3)})/${fade.toFixed(3)}\\,0\\,1)`, alpha = `min(${p}\\,clip((${to.toFixed(3)}-t)/${fade.toFixed(3)}\\,0\\,1))`;
    const y = rise ? `${base}-${Math.round(height * bottom)}-th+${Math.round(height * 0.012)}*pow(1-${p}\\,3)` : `${base}-${Math.round(height * bottom)}-th`;
    return `drawtext=fontfile='${font}':expansion=none:text='${drawtextText(text)}':fontsize=${Math.round(height * size)}:fontcolor=${color}:shadowcolor=black@0.35:shadowx=${shadow}:shadowy=${shadow}`
      + `:x=${x}:y=${y}:alpha='${alpha}':enable='between(t\\,${from.toFixed(3)}\\,${to.toFixed(3)})'`;
  };
  const slow = hold >= 6, texts = [draw(`${spaced('PROCEDURAL THEME PARK')} · ${spaced(`${seeds.length} SEEDS`)}`, FONT.label, 0.0155, 'white@0.72', 0.115, 0.5, end - 0.5, 0.6, false)];
  seeds.forEach((seed, k) => {
    const f = facts[k], from = k === 0 ? 0.7 : k * hold + phase / 2, to = k + 1 === seeds.length ? end - 0.5 : (k + 1) * hold + phase / 2, fade = slow ? 0.8 : 0.14;
    texts.push(draw(`Seed ${seed}`, FONT.light, 0.072, 'white', 0.042, from, to, fade, slow));
    texts.push(draw(`${String(k + 1).padStart(2, '0')} / ${String(seeds.length).padStart(2, '0')}  ·  ${title(sizes[k])} park  ·  ${LAYOUT_NAMES[f.layout] ?? f.layout} layout  ·  ${f.rides} rides  ·  ${f.coasters} coasters  ·  ${f.guests.toLocaleString('en-GB')} guests`,
      FONT.light, 0.022, 'white@0.86', 0, from + (slow ? 0.14 : 0), to, fade, slow));
  });
  const filters = [`fade=t=in:st=0:d=0.6:color=black:enable='between(t\\,0\\,0.6)'`, `fade=t=out:st=${(end - 0.8).toFixed(4)}:d=0.8:color=black:enable='between(t\\,${(end - 0.8).toFixed(4)}\\,${end.toFixed(4)})'`, ...texts, 'format=yuv420p10le'];
  const filterFile = resolve(dirname(out), 'orbit-filters.txt'); await writeFile(filterFile, filters.join(',\n'));

  const tail = new Array(phaseFrames).fill(null);
  let field = null, written = 0;
  // Frames arrive tagged: kept as the outgoing park's tail, phased over the kept tail, or written as they are.
  const deliver = async (frame, tag) => {
    if (tag.kind === 'tail') { tail[tag.index] = frame; return; }
    if (tag.kind === 'head') { phaseInto(frame, tail[tag.index], field, smoother((tag.index + 1) / (phaseFrames + 1))); tail[tag.index] = null; }
    await encoder.write(frame); written++;
  };
  const device = renderer.device, reader = frameReader(device, () => surface.surface.getContext('webgpu').getCurrentTexture(), width, height, deliver);
  encoder = startEncoder({ out, width, height, fps, pixelFormat: reader.pixelFormat, filterFile, crf, preset });
  const camera = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 48 * Math.PI / 180, aspect: width / height, near: 0.1, far: 20000 };
  const aim = t => { const view = orbit(t); camera.pos = view.eye; a.quatLookAlong(...view.target.map((v, k) => v - view.eye[k]), camera.quat); };

  const rendering = performance.now();
  for (let k = 0; k < seeds.length; k++) {
    const built = a.buildPark(a.defaultParkRecipe(seeds[k], sizes[k])), sim = new a.ParkRuntime(built.park), sampler = a.createTerrainSampler(built.terrain);
    // Run the park for a while first, so the rides are going and the guests have spread out.
    for (let t = 0; t < 30; t += frameTime) sim.advance(frameTime);
    sim.present(1, 0);
    renderer.setScene({ terrain: built.terrain, sampler, track: built.track, park: sim });
    // Each phase sweeps in from a new direction, turning by the golden angle, through fresh noise.
    if (k > 0) field = phaseField(width, height, k * 2.39996, k);
    const first = k * holdFrames, last = (k + 1) * holdFrames + phaseFrames;
    aim(first / fps);
    for (let i = 0; i < settle; i++) renderer.render({ dt: frameTime, time: sim.elapsed, camera, astro, quad: null });
    for (let g = first; g < last; g++) {
      const local = g - first;
      const tag = k > 0 && local < phaseFrames ? { kind: 'head', index: local } : k + 1 < seeds.length && local >= holdFrames ? { kind: 'tail', index: local - holdFrames } : { kind: 'write' };
      sim.advance(frameTime); sim.present(1, 0); aim(g / fps);
      renderer.render({ dt: frameTime, time: sim.elapsed, camera, astro, quad: null });
      await reader.capture(tag);
    }
    await reader.drain();
    const rate = (k + 1) / ((performance.now() - rendering) / 1000);
    console.log(`park ${k + 1}/${seeds.length} (seed ${seeds[k]}) done, about ${((seeds.length - k - 1) / rate / 60).toFixed(0)} min left`);
  }
  await encoder.finish();
  const validation = (await device.popErrorScope())?.message ?? null;
  if (validation || renderer.errors.length) throw new Error(`GPU errors: ${validation ?? ''} ${[...renderer.errors].join('; ')}`);
  if (written !== total) throw new Error(`Wrote ${written} of ${total} frames`);
  await writeFile(out.replace(/\.mp4$/, '.json'), JSON.stringify({ seeds, sizes, width, height, fps, quality, hour, crf, preset, hold, phase, frames: total, parks: facts }, null, 2));
  console.log(`Wrote ${out}: ${total} frames (${end.toFixed(2)} s) in ${((performance.now() - began) / 60000).toFixed(1)} min`);
} catch (error) { console.error(error); exitCode = 1; encoder?.abort(); }
finally { renderer?.destroy(); runtime?.close(); await release(); }
process.exit(exitCode);
