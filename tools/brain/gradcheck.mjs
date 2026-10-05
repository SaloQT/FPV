// GPU PPO gradients vs the float64 CPU reference on one real minibatch: `node tools/brain/gradcheck.mjs`.
// Fails when any network's gradient differs from the reference by more than 1e-3 of that network's largest gradient.
import { gpuDevice, loadTrainer } from './bundle.mjs';

const keep = setInterval(() => {}, 1000);
const t = await loadTrainer();
const { device, name, backend } = await gpuDevice();
console.log(`${backend}: ${name}`);
const world = t.buildTrainWorld({ seed: 4242, style: 'race' });
const cfg = { ...t.DEFAULT_PPO, envs: 256, steps: 8, minibatches: 1, epochs: 1, chunk: 1024 };
const trainer = await t.PpoTrainer.create(device, [world], cfg);
const p = await trainer.probeGradients();
const mb = (cfg.envs * cfg.steps) / cfg.minibatches;
const ref = t.ppoReference(p.actor, p.critic, cfg.hidden, p.obs, p.u, p.data, mb, cfg);
let ok = true;
for (const [label, gpu, cpu] of [['actor', p.actorGrad, ref.actor], ['critic', p.criticGrad, ref.critic]]) {
  let scale = 0, worst = 0, at = 0;
  for (let i = 0; i < cpu.length; i++) scale = Math.max(scale, Math.abs(cpu[i]));
  for (let i = 0; i < cpu.length; i++) {
    const e = Math.abs(gpu[i] - cpu[i]);
    if (e > worst) { worst = e; at = i; }
  }
  const rel = worst / (scale || 1);
  const pass = rel < 1e-3 && Number.isFinite(rel);
  ok &&= pass;
  console.log(`${label}: ${cpu.length} params, largest gradient ${scale.toExponential(3)}, worst gap ${worst.toExponential(3)} at ${at} (gpu ${gpu[at].toExponential(4)} cpu ${cpu[at].toExponential(4)}), relative ${rel.toExponential(2)} ${pass ? 'PASS' : 'FAIL'}`);
}
const ls = Array.from(p.actorGrad.slice(-4)).map((v, i) => `${v.toExponential(3)}/${ref.actor[ref.actor.length - 4 + i].toExponential(3)}`);
console.log(`log-std gradients gpu/cpu: ${ls.join('  ')}`);
console.log(ok ? 'gradcheck: PASS' : 'gradcheck: FAIL');
clearInterval(keep);
process.exit(ok ? 0 : 1);
