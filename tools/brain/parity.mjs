// GPU flight model vs the game's QuadPhysics on scripted flights: `node tools/brain/parity.mjs [seconds]`.
// Fails when the GPU copy leaves the TypeScript model by more than 1 cm in the first half second, or the arm and crash
// flags disagree in that window.
import { gpuDevice, loadTrainer } from './bundle.mjs';

const keep = setInterval(() => {}, 1000);
const seconds = Number(process.argv[2] ?? 2);
const t = await loadTrainer();
const { device, name, backend } = await gpuDevice();
console.log(`${backend}: ${name}`);
const t0 = performance.now();
const world = t.buildTrainWorld({ seed: 4242, style: 'race' });
console.log(`world: ${world.track.gates.length} gates, ${world.colliders.length} colliders, built in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const results = await t.runParity(device, [world], t.parityFlights(world), seconds);
let ok = true;
const fmt = (v) => (v < 1e-3 ? `${(v * 1e6).toFixed(0)}u` : v < 1 ? `${(v * 1e3).toFixed(2)}m` : v.toFixed(2));
for (const r of results) {
  console.log(`\n${r.name}`);
  console.log('   t(s)   pos(m)   vel(m/s)  angle(rad)  rate(rad/s)  motor(rad/s)  armed  crashed gpu/cpu');
  for (const s of r.samples.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 10)) === 0 || i === a.length - 1)) {
    console.log(`  ${s.t.toFixed(3).padStart(5)}  ${fmt(s.pos).padStart(8)}  ${fmt(s.vel).padStart(8)}  ${fmt(s.angle).padStart(9)}  ${fmt(s.rate).padStart(10)}  ${fmt(s.motor).padStart(11)}   ${s.armed ? 'same' : 'DIFF'}   ${s.crashed.map(Number).join('/')}`);
  }
  const early = r.samples.filter((s) => s.t <= 0.5);
  const worst = Math.max(...early.map((s) => s.pos));
  const flags = early.every((s) => s.armed && s.crashed[0] === s.crashed[1]);
  const pass = worst < 0.01 && flags;
  ok &&= pass;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}: worst position gap in the first 0.5 s ${fmt(worst)}, flags ${flags ? 'agree' : 'differ'}`);
}
clearInterval(keep);
console.log(ok ? '\nparity: PASS' : '\nparity: FAIL');
process.exit(ok ? 0 : 1);
