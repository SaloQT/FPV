// Compiles one stage of the env shader (argv[2]: world | quad | env) to find which part a compiler fault comes from.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gpuDevice, loadTrainer, ROOT } from './bundle.mjs';

const keep = setInterval(() => {}, 1000);
const stage = process.argv[2];
const t = await loadTrainer();
const { device } = await gpuDevice(process.argv[3] ?? 'd3d12');
const full = t.envShader({ envs: 1024, worlds: 1, quad: t.QUAD_5IN_6S, rates: t.DEFAULT_RATES, env: t.DEFAULT_ENV });
const src = (f) => readFileSync(resolve(ROOT, 'src/ai/gpu', f), 'utf8');
const head = full.slice(0, full.indexOf(src('world.wgsl').slice(0, 60)));
let code;
if (stage === 'world') code = `${head}\n${src('world.wgsl')}\n@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g : vec3u) { T = tracks[0]; S[g.x] = groundHeight(f32(g.x), 0.0) + f32(gatherNearBoxes(vec3f(0.0))); }\n@group(0) @binding(0) var<storage, read_write> S : array<f32>;`;
else if (stage === 'quad') code = `${head}\n${src('world.wgsl')}\n${src('quad.wgsl')}\n@group(0) @binding(0) var<storage, read_write> S : array<f32>;\n@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g : vec3u) { loadQuad(g.x); T = tracks[0]; advance(Sticks(0.0, 0.0, 0.0, 0.5, true)); storeQuad(g.x); }`;
else if (stage === 'head') code = `${head}\n@group(0) @binding(0) var<storage, read_write> S : array<f32>;\n@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g : vec3u) { loadQuad(g.x); storeQuad(g.x); }`;
else code = full;
// The layouts reference S and E; give the partial stages an E too.
if (stage !== 'env') code += '\n@group(0) @binding(1) var<storage, read_write> E : array<f32>;';
console.log(`${stage}: ${code.split('\n').length} lines`);
const module = device.createShaderModule({ code });
const info = await module.getCompilationInfo();
const lines = code.split('\n');
for (const m of info.messages) console.log(`${m.type} ${m.lineNum}:${m.linePos} ${m.message}\n  > ${lines[m.lineNum - 1] ?? ''}`);
console.log('module ok');
if (!info.messages.some((m) => m.type === 'error')) {
  const entry = stage === 'env' ? 'stepEnvs' : 'main';
  await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: entry } });
  console.log('pipeline ok');
}
clearInterval(keep);
process.exit(0);
