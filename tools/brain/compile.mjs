// Compiles the trainer's shaders on the GPU and prints any errors: `node tools/brain/compile.mjs [backend]`.
import { gpuDevice, loadTrainer } from './bundle.mjs';

const keep = setInterval(() => {}, 1000);
const t = await loadTrainer();
const { device, name, backend } = await gpuDevice(process.argv[2]);
console.log(`${backend}: ${name}`);
const code = t.envShader({ envs: 1024, worlds: 1, quad: t.QUAD_5IN_6S, rates: t.DEFAULT_RATES, env: t.DEFAULT_ENV });
const t0 = performance.now();
const module = device.createShaderModule({ code });
const info = await module.getCompilationInfo();
const lines = code.split('\n');
for (const m of info.messages) {
  console.log(`${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
  if (m.lineNum) console.log(`  > ${lines[m.lineNum - 1]}`);
}
if (info.messages.some((m) => m.type === 'error')) process.exit(1);
for (const entryPoint of ['initEnvs', 'stepEnvs']) {
  const p0 = performance.now();
  await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
  console.log(`${entryPoint}: pipeline in ${(performance.now() - p0).toFixed(0)} ms`);
}
console.log(`env shader ${lines.length} lines compiled in ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(0);
