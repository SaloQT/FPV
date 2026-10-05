// Bundles the TypeScript trainer (src/ai/train/node.ts and everything it imports, WGSL included) into one ES module Node can
// import, under .bench/brain/bundle. The bundler runs in a child process: Vite's native bundler loaded next to Dawn crashes
// Dawn's pipeline compiler.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, '.bench/brain/bundle');
const SELF = fileURLToPath(import.meta.url);
const INSTANCES = [];

async function buildBundle() {
  const { build } = await import('vite');
  const built = await build({
    root: ROOT, configFile: false, logLevel: 'warn', mode: 'production', publicDir: false,
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    ssr: { noExternal: true },
    build: {
      ssr: resolve(ROOT, 'src/ai/train/node.ts'), write: false, minify: false, target: 'es2022',
      rolldownOptions: { output: { format: 'es', entryFileNames: 'trainer.mjs', chunkFileNames: '[name]-[hash].mjs' } },
    },
  });
  const output = Array.isArray(built) ? built[0].output : built.output;
  await mkdir(OUT, { recursive: true });
  for (const item of output) {
    const file = resolve(OUT, item.fileName);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, item.type === 'chunk' ? item.code : item.source);
  }
}

/** Rebuilds the bundle in a child process and imports it. */
export async function loadTrainer() {
  execFileSync(process.execPath, [SELF, '--build'], { stdio: 'inherit' });
  return import(`${pathToFileURL(resolve(OUT, 'trainer.mjs')).href}?t=${Date.now()}`);
}

/** A Dawn device for compute (D3D12 by default on Windows, `backend` or FPV_GPU_BACKEND overrides). */
export async function gpuDevice(backend = process.env.FPV_GPU_BACKEND ?? (process.platform === 'win32' ? 'd3d12' : 'vulkan')) {
  const { create, globals } = await import('webgpu');
  Object.assign(globalThis, globals);
  const gpu = create([`backend=${backend}`]);
  // The Dawn instance must outlive every device made from it: once collected, the next GPU call crashes the process.
  INSTANCES.push(gpu);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error(`no ${backend} GPU adapter`);
  const l = adapter.limits;
  const big = Math.min(l.maxStorageBufferBindingSize, l.maxBufferSize, 2 ** 30);
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBuffersPerShaderStage: l.maxStorageBuffersPerShaderStage,
      maxStorageBufferBindingSize: big,
      maxBufferSize: big,
      maxComputeWorkgroupStorageSize: l.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: l.maxComputeInvocationsPerWorkgroup,
    },
  });
  device.addEventListener?.('uncapturederror', (e) => console.error('GPU error:', e.error?.message ?? e));
  const info = adapter.info ?? {};
  return { gpu, adapter, device, backend, name: `${info.vendor ?? ''} ${info.description ?? info.device ?? ''}`.trim() };
}

if (process.argv[2] === '--build' && process.argv[1] === SELF) await buildBundle();
