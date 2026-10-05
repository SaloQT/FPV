import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { sha256, stable, readJson, toolingHash } from './common.mjs';

const require = createRequire(import.meta.url);
async function nativePackage() {
  const entry = process.env.WEBGPU_MODULE ? resolve(process.env.WEBGPU_MODULE) : require.resolve('webgpu');
  let directory = dirname(entry), metadata = null;
  while (directory !== parse(directory).root) {
    try { metadata = await readJson(resolve(directory, 'package.json')); break; } catch { directory = dirname(directory); }
  }
  if (!metadata) throw new Error('Cannot identify Dawn package; WEBGPU_MODULE must be inside a package');
  const binaries = [];
  async function collect(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const path = resolve(folder, item.name);
      if (item.isDirectory()) await collect(path);
      else if (item.name.endsWith('.node')) binaries.push(sha256(await readFile(path)));
    }
  }
  await collect(directory);
  if (!binaries.length) throw new Error('Dawn native binary missing. Install dependencies with npm ci.');
  return { entry, identity: { package: metadata.name, version: metadata.version,
    entrySha256: sha256(await readFile(entry)), binariesSha256: binaries.sort() } };
}
function drivers(explicit) {
  if (explicit) return { source: 'explicit', id: explicit };
  if (process.platform === 'win32') {
    try {
      const output = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_VideoController | Sort-Object Name | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
      return { source: 'Win32_VideoController', devices: JSON.parse(output) };
    } catch { /* Unknown driver identity disables persistent result cache reuse. */ }
  }
  return { source: 'unknown', id: null };
}
export async function runtimeIdentity(options) {
  const pkg = await nativePackage();
  return { schemaVersion: 1, node: process.version, platform: process.platform, arch: process.arch,
    os: os.release(), cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
    native: pkg.identity, driver: drivers(options.driverId), backend: options.backend,
    requestedAdapter: options.adapter, toolingSha256: await toolingHash() };
}
export async function openRuntime(options) {
  const pkg = await nativePackage(), { create, globals } = await import(pathToFileURL(pkg.entry).href);
  Object.assign(globalThis, globals);
  const flags = [`backend=${options.backend}`, ...(options.adapter ? [`adapter=${options.adapter}`] : [])];
  const gpu = create(flags);
  Object.defineProperty(globalThis, 'navigator', { value: { gpu }, configurable: true });
  return { gpu, flags, close() { delete globalThis.navigator; } };
}
export async function adapterIdentity(gpu) {
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No native hardware adapter available');
  const info = adapter.info ?? {}, features = [...adapter.features].sort();
  const identity = { vendor: info.vendor ?? '', device: info.device ?? '', architecture: info.architecture ?? '', description: info.description ?? '',
    fallback: adapter.isFallbackAdapter === true || info.isFallbackAdapter === true, features };
  if (identity.fallback || /swiftshader|llvmpipe|lavapipe|softpipe|software|\bwarp\b|microsoft basic render/i.test(stable(identity))) {
    throw new Error('Software adapters cannot produce a hardware benchmark');
  }
  if (![identity.vendor, identity.device, identity.architecture, identity.description].some(Boolean)) throw new Error('Adapter identity unavailable');
  if (!features.includes('timestamp-query')) throw new Error('Hardware timestamp-query is required');
  return { adapter, identity };
}
export async function capabilities(options) {
  const environment = await runtimeIdentity(options), runtime = await openRuntime(options);
  let device;
  try {
    const { adapter, identity } = await adapterIdentity(runtime.gpu);
    device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const query = device.createQuerySet({ type: 'timestamp', count: 2 });
    const resolveBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass({ timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } });
    pass.end(); encoder.resolveQuerySet(query, 0, 2, resolveBuffer, 0); encoder.copyBufferToBuffer(resolveBuffer, 0, readback, 0, 16);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const timestamps = [...new BigUint64Array(readback.getMappedRange())];
    readback.unmap(); readback.destroy(); resolveBuffer.destroy(); query.destroy();
    const validation = await device.popErrorScope();
    if (validation || errors.length || timestamps[0] === 0n || timestamps[1] < timestamps[0]) throw new Error('Native timestamp readback failed');
    return { status: 'ready', environment, adapter: identity, flags: runtime.flags, timestampsNs: timestamps.map(String), timingClaim: false };
  } finally { device?.destroy(); runtime.close(); }
}
export function offscreenSurface(width, height) {
  let device, format, target;
  const surface = { width, height, getContext(type) { return type === 'webgpu' ? context : null; } };
  const context = {
    configure(config) {
      device = config.device; format = config.format;
      target?.destroy();
      target = device.createTexture({ label: 'native benchmark output', size: [surface.width, surface.height], format, usage: config.usage });
    },
    getCurrentTexture() { if (!target) throw new Error('Output not configured'); return target; },
    unconfigure() { target?.destroy(); target = null; },
  };
  return { surface,
    async read() {
      const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
      const buffer = device.createBuffer({ label: 'benchmark correctness readback', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
        device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint8Array(buffer.getMappedRange()), rgba = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) rgba.set(source.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
        if (format.startsWith('bgra')) for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
        buffer.unmap(); return rgba;
      } finally { buffer.destroy(); }
    },
  };
}
