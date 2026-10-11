/** Shared pieces of the offline park videos (tools/park-tour.mjs, tools/park-seed-orbit.mjs): the production modules bundled for Node,
 * an ffmpeg libx265 encoder fed raw frames, and a frame reader that copies rendered frames out through a ring of staging buffers. */
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Bundles the renderer, park generator and runtime (plus any extra exports) and imports the bundle. */
export async function loadParkModules(directory, extra = []) {
  await mkdir(directory, { recursive: true });
  const imports = [
    ['Renderer', 'src/render/renderer.ts'], ['createDefaultModules', 'src/render/modules.ts'], ['buildPark', 'src/world/park/build.ts'],
    ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['ParkRuntime', 'src/world/park/runtime.ts'], ['createTerrainSampler', 'src/world/terrain/sampler.ts'],
    ['computeAstro', 'src/world/astro/clock.ts'], ['quatLookAlong', 'src/game/quat.ts'], ['DEFAULT_SETTINGS', 'src/contracts.ts'],
    ['pose, rotate', 'src/world/park/math.ts'], ['CURVE_STRIDE', 'src/world/park/curve.ts'], ...extra,
  ];
  const entry = resolve(directory, 'entry.ts');
  await writeFile(entry, imports.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(path).replaceAll('\\', '/'))};`).join('\n'));
  await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: directory, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'video.mjs' } } } });
  return import(pathToFileURL(resolve(directory, 'video.mjs')).href);
}

/** Starts libx265 on raw frames. It writes Matroska, which stays playable if a long render stops part way; finish() copies it into the MP4. */
export function startEncoder({ out, width, height, fps, pixelFormat, filterFile, crf, preset }) {
  const partial = out.replace(/\.mp4$/i, '') + '.partial.mkv';
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'rawvideo', '-pix_fmt', pixelFormat, '-s', `${width}x${height}`, '-r', String(fps), '-i', '-',
    '-/vf', filterFile, '-c:v', 'libx265', '-preset', preset, '-crf', String(crf), '-x265-params', 'log-level=warning:aq-mode=3', partial], { stdio: ['pipe', 'inherit', 'inherit'] });
  const encoded = new Promise((done, fail) => { ffmpeg.on('error', fail); ffmpeg.on('close', code => code === 0 ? done() : fail(new Error(`ffmpeg exited with ${code}`))); });
  return {
    write: buffer => new Promise((done, fail) => { if (ffmpeg.stdin.write(buffer, error => error && fail(error))) done(); else ffmpeg.stdin.once('drain', done); }),
    abort: () => ffmpeg.stdin.destroy(),
    async finish() {
      ffmpeg.stdin.end(); await encoded;
      await new Promise((done, fail) => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-i', partial, '-c', 'copy', '-tag:v', 'hvc1', '-movflags', '+faststart', out], { stdio: 'inherit' })
        .on('error', fail).on('close', code => code === 0 ? done() : fail(new Error(`ffmpeg remux exited with ${code}`))));
      await rm(partial);
    },
  };
}

/** Copies each rendered frame out of the output texture. capture(tag) queues the current frame; frames reach deliver(frame, tag) in order,
 * a few frames later, so the GPU keeps rendering while earlier frames are read. drain() delivers the rest. */
export function frameReader(device, texture, width, height, deliver) {
  const format = texture().format;
  if (!/^(bgra|rgba)8unorm/.test(format)) throw new Error(`Unexpected output format ${format}`);
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const ring = Array.from({ length: 3 }, () => ({ buffer: device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), pending: null, tag: null }));
  let slot = 0;
  const flush = async entry => {
    await entry.pending; const mapped = new Uint8Array(entry.buffer.getMappedRange());
    let frame;
    if (bytesPerRow === width * 4) frame = Buffer.from(mapped);
    else { frame = Buffer.alloc(width * height * 4); for (let y = 0; y < height; y++) frame.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4); }
    entry.buffer.unmap(); entry.pending = null; await deliver(frame, entry.tag);
  };
  return {
    pixelFormat: format.startsWith('bgra') ? 'bgra' : 'rgba',
    async capture(tag) {
      const entry = ring[slot]; slot = (slot + 1) % ring.length;
      if (entry.pending) await flush(entry);
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: texture() }, { buffer: entry.buffer, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]); entry.pending = entry.buffer.mapAsync(GPUMapMode.READ); entry.tag = tag;
    },
    async drain() { for (let k = 0; k < ring.length; k++) { const entry = ring[slot]; slot = (slot + 1) % ring.length; if (entry.pending) await flush(entry); } },
  };
}

/** Text for an ffmpeg drawtext value inside single quotes in a filter script. */
export const drawtextText = text => text.replaceAll('\\', '\\\\\\\\').replaceAll("'", '’').replaceAll(':', '\\:').replaceAll(',', '\\,');
/** A font path for drawtext's fontfile option (the drive colon escaped). */
export const drawtextFont = path => resolve(path).replaceAll('\\', '/').replace(/^([A-Za-z]):/, '$1\\:');
export const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);
