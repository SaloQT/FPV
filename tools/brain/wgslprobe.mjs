// Compiles a WGSL file and builds one compute pipeline from it: `node tools/brain/wgslprobe.mjs file.wgsl [entry] [backend]`.
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);
const keep = setInterval(() => {}, 1000);
const [file, entry = 'main', backend = 'd3d12'] = process.argv.slice(2);
const gpu = create([`backend=${backend}`]);
const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
const extra = JSON.parse(process.env.PROBE_LIMITS ?? '{}');
const device = await adapter.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage, ...extra } });
const code = readFileSync(file, 'utf8');
const module = device.createShaderModule({ code });
const info = await module.getCompilationInfo();
const lines = code.split('\n');
for (const m of info.messages) console.log(`${m.type} ${m.lineNum}:${m.linePos} ${m.message}\n  > ${lines[m.lineNum - 1] ?? ''}`);
console.log('module ok');
const t0 = performance.now();
device.pushErrorScope('validation');
await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: entry } }).catch((e) => console.log('pipeline error', e.message));
const err = await device.popErrorScope();
if (err) console.log('validation:', err.message);
console.log(`pipeline ${(performance.now() - t0).toFixed(0)} ms`);
clearInterval(keep);
process.exit(0);
