// Searches for a better prop with a Gaussian-process surrogate (src/prop/optimize.ts). Each real evaluation is the static bench
// (efficiency, thrust to weight, hover time, stress, tip Mach) and, with --brain, a brain flight on a few tracks for lap time.
//
//   node tools/prop-lab/optimize.mjs [--budget 120] [--seed 1] [--brain public/brains/ace.json] [--worlds 2] [--seconds 60]
//        [--w-eff 1] [--w-tw 1] [--w-time 1] [--w-lap 2] [--publish]
//
// Writes .bench/prop-lab/runs/<id>/run.json (every design tried, its numbers, the surrogate's guess) and the best design as
// .bench/prop-lab/props/<id>-best.json. --publish also copies the best into public/props/ so the game can offer it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadPropLab, ROOT } from './bundle.mjs';

const argv = process.argv.slice(2);
const str = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const opt = (k, d) => (str(k) !== undefined ? Number(str(k)) : d);

const p = await loadPropLab();
let flight;
let brainName = null;
if (str('brain')) {
  const brain = p.parseBrain(await readFile(resolve(ROOT, str('brain')), 'utf8'));
  brainName = brain.name;
  const worlds = p.evalWorldSpecs({ worlds: opt('worlds', 2), seed: 0, recipes: 0 }).map((s) => p.buildMixWorld(s));
  const gates = Math.round(worlds.reduce((s, w) => s + w.track.gates.length * (w.track.closed ? w.track.laps : 1), 0) / worlds.length);
  flight = (d, m) => {
    const runs = worlds.map((w, k) => p.flyBrainWithProp(brain, w, d, { seconds: opt('seconds', 60), seed: 1 + k }));
    return { ...m, flightScore: p.flightScore(runs, gates), flightMah: runs.reduce((s, r) => s + r.mah, 0) / runs.length };
  };
}

const weights = { efficiency: opt('w-eff', 1), thrustToWeight: opt('w-tw', 1), flightTime: opt('w-time', 1), lapTime: flight ? opt('w-lap', 2) : 0 };
const id = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const t0 = Date.now();
const res = p.runSearch({
  seed: opt('seed', 1), budget: opt('budget', 120), initial: opt('initial', 24), weights, flight,
  onEval: (e, n, total) => { if (n % 10 === 0 || n === total) console.log(`  ${n}/${total} best so far ${Math.min(...[e.cost]).toFixed(3)} (this ${e.cost.toFixed(3)})`); },
});

const brief = (m) => ({
  gramsPerWattHover: m.bench.gramsPerWattHover, thrustToWeight: m.bench.thrustToWeight, hoverMinutes: m.bench.hoverMinutes, staticThrustG: m.bench.staticThrustG,
  hoverDuty: m.bench.hoverDuty, hoverCurrent: m.bench.hoverCurrent, topSpeed: m.bench.topSpeed, climbRate: m.bench.climbRate, tipMach: m.bench.tipMach,
  massGrams: m.bench.propGrams, stressMPa: m.stress / 1e6, flightScore: m.flightScore, flightMah: m.flightMah,
});
const design = (e) => p.serializeProp(p.designFromVector(e.x, p.DEFAULT_PROP, `opt-${id}-${e.id}`));
const ranked = [...res.evaluated].sort((a, b) => a.cost - b.cost);
const bestDesign = p.serializeProp(p.designFromVector(res.best.x, p.DEFAULT_PROP, `opt-${id}`),
  `Surrogate search ${id}, seed ${opt('seed', 1)}, ${res.evaluated.length} evaluations${brainName ? `, brain ${brainName}` : ''}.`);

const run = {
  schemaVersion: 1, id, createdAt: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, brain: brainName,
  weights, limits: { machLimit: p.MACH_LIMIT, stressLimitMPa: p.stressLimit() / 1e6 },
  surrogate: { rmse: res.surrogateRmse, correlation: res.surrogateCorr },
  reference: brief(res.reference), best: { id: res.best.id, cost: res.best.cost, design: bestDesign, ...brief(res.best.metrics) },
  designs: res.evaluated.map((e) => ({ id: e.id, cost: e.cost, predicted: e.predicted, predictedSd: e.predictedSd, design: design(e), ...brief(e.metrics), violation: p.violation(e.metrics) })),
  top: ranked.slice(0, 5).map((e) => e.id),
};
const dir = resolve(ROOT, '.bench/prop-lab/runs', id);
await mkdir(dir, { recursive: true });
await writeFile(resolve(dir, 'run.json'), JSON.stringify(run, null, 1));
await mkdir(resolve(ROOT, '.bench/prop-lab/props'), { recursive: true });
await writeFile(resolve(ROOT, '.bench/prop-lab/props', `${id}-best.json`), JSON.stringify(bestDesign, null, 1));
if (argv.includes('--publish')) {
  await mkdir(resolve(ROOT, 'public/props'), { recursive: true });
  await writeFile(resolve(ROOT, 'public/props', `${id}-best.json`), JSON.stringify(bestDesign, null, 1));
}

const r = run.reference, b = run.best;
const row = (k, f = 2) => `${k.padEnd(18)} ${Number(r[k]).toFixed(f).padStart(9)} ${Number(b[k]).toFixed(f).padStart(9)}  ${((b[k] / r[k] - 1) * 100).toFixed(1).padStart(6)}%`;
console.log(`\nrun ${id}: ${res.evaluated.length} evaluations in ${run.seconds.toFixed(0)} s, surrogate correlation ${res.surrogateCorr.toFixed(2)} (rmse ${res.surrogateRmse.toFixed(3)})`);
console.log(`best design ${bestDesign.diameterIn.toFixed(2)} x ${bestDesign.pitchIn.toFixed(2)} x ${bestDesign.blades}, chord ${bestDesign.chordRatio.toFixed(2)}, taper ${bestDesign.chordTaper.toFixed(2)}, tilt ${bestDesign.pitchTilt.toFixed(2)}, thickness ${bestDesign.thicknessRatio.toFixed(3)}`);
console.log('                      stock      best   change');
for (const k of ['gramsPerWattHover', 'thrustToWeight', 'hoverMinutes', 'staticThrustG', 'topSpeed', 'climbRate', 'tipMach', 'stressMPa']) console.log(row(k));
if (flight) console.log(row('flightScore'), '\n' + row('flightMah', 0));
console.log(`saved ${resolve(dir, 'run.json')}`);
