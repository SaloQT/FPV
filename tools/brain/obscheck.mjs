// GPU observation vector vs the game's TypeScript `observe`, and the GPU's path-progress state vs src/ai/train/pathProgress.ts:
// `node tools/brain/obscheck.mjs [--styles race,sprint] [--parks 7:compact] [--brain public/brains/ace.json]` (the brain flies a quarter of the drones,
// so some clear gates; default ace when it is there). Fails above 1e-4 on any slot before the obstacle slots, or when the arc
// length along the path differs by 5 cm anywhere or by over 1 mm for more than 1 % of the drones (f32 near-ties between samples),
// or when the arc left to the gate due next (the progress cap) differs by 1 cm. The brain's drones race through gate centres
// and far off the line, where f32 rounding grows: they fail above 1e-3 on a slot or 50 cm of arc length. Obstacle slots fail
// when more than 0.05 % of the range-ray values or the side entries differ by over 1e-3 (a ray grazing an edge can hit on one
// side of the rounding only), or when the rest differ by over 1e-3, or when no ray met a collider or no side saw one.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gpuDevice, loadTrainer, ROOT } from './bundle.mjs';

const keep = setInterval(() => {}, 1000);
const argv = process.argv.slice(2);
const at = argv.indexOf('--styles');
const t = await loadTrainer();
const styles = at >= 0 ? t.parseStyles(argv[at + 1] ?? '') : ['race', 'sprint'];
const { device, name, backend } = await gpuDevice();
console.log(`${backend}: ${name}`);
const seeds = [4242, 77, 1001, 5003, 9001, 31337, 2024];
const worlds = styles.map((style, k) => t.buildTrainWorld({ seed: seeds[k % seeds.length] + 7919 * Math.floor(k / seeds.length), style }));
// --parks 7:compact,1337 adds theme park race courses, whose park comes in as thousands of box stand-ins.
const pk = argv.indexOf('--parks');
for (const item of pk >= 0 ? (argv[pk + 1] ?? '').split(',').filter(Boolean) : []) worlds.push(t.buildTrainWorld(t.parseParkItem(item)));
for (const [k, w] of worlds.entries()) console.log(t.describeWorld(w, k));
const bi = argv.indexOf('--brain');
const brainFile = resolve(ROOT, bi >= 0 ? argv[bi + 1] : 'public/brains/ace.json');
const pilot = existsSync(brainFile) ? t.parseBrain(await readFile(brainFile, 'utf8')) : undefined;
console.log(pilot ? `pilot: ${brainFile}` : 'pilot: none (scripted drones)');
const r = await t.runObsCheck(device, worlds, 90, pilot);
const base = (g) => g.worst.slice(0, t.OBS.rays);
const worst = Math.max(...base(r));
console.log(`compared ${r.compared} observations; worst gap per slot before the obstacle slots:`);
console.log(base(r).map((v, i) => `${i}:${v.toExponential(1)}`).join(' '));
const senseLine = (label, s, unit) => `${label}: ${s.compared} ${unit}, ${s.seen} seeing something${unit === 'rays' ? ` (${s.boxes} a collider first)` : ''}; ${s.over1e4} over 1e-4, ${s.over1e3} over 1e-3, worst of the rest ${s.worst.toExponential(2)}`;
console.log(senseLine('range rays', r.rays, 'rays'));
console.log(senseLine('nearest collider per side', r.near, 'entries'));
console.log(`path progress: compared ${r.pathCompared} drones, worst arc-length gap ${r.pathWorst.toExponential(2)} m (${r.pathWorstOff.toFixed(1)} m off the line), ${r.pathOff1mm} above 1 mm`);
const c = r.gateLeftCompared;
console.log(`arc left to the gate due next: compared ${c.carried} carried on, ${c.passed} after a pass, ${c.spawned} at a spawn; worst gap ${r.gateLeftWorst.toExponential(2)} m`);
const p = r.piloted;
if (p) {
  const pw = Math.max(...base(p));
  console.log(`brain-flown drones: compared ${p.compared} observations, worst gap ${pw.toExponential(2)} (slot ${base(p).indexOf(pw)}); path worst ${p.pathWorst.toExponential(2)} m (${p.pathWorstOff.toFixed(1)} m off the line), ${p.pathOff1mm} of ${p.pathCompared} above 1 mm`);
  console.log(`  ${senseLine('range rays', p.rays, 'rays')}`);
  console.log(`  ${senseLine('nearest collider per side', p.near, 'entries')}`);
}
const senseOk = (g) => g.over1e3 <= 0.0005 * g.compared && g.worst < 1e-3;
const pilotedOk = !p || (Math.max(...base(p)) < 1e-3 && p.pathWorst < 0.5 && p.pathOff1mm <= 0.01 * p.pathCompared && senseOk(p.rays) && senseOk(p.near));
const pathOk = r.pathCompared > 0 && r.pathWorst < 0.05 && r.pathOff1mm <= 0.01 * r.pathCompared && pilotedOk;
const gateOk = c.carried > 0 && c.spawned > 0 && (!p || c.passed > 0) && r.gateLeftWorst < 0.01;
const obstacleOk = senseOk(r.rays) && senseOk(r.near) && r.rays.boxes + (p?.rays.boxes ?? 0) > 0 && r.near.seen > 0;
const ok = worst < 1e-4 && pathOk && gateOk && obstacleOk;
console.log(ok ? `obscheck: PASS (worst ${worst.toExponential(2)})` : `obscheck: FAIL (worst ${worst.toExponential(2)}, path ${r.pathWorst.toExponential(2)} m, gate left ${r.gateLeftWorst.toExponential(2)} m, obstacle slots ${obstacleOk ? 'ok' : 'off'})`);
clearInterval(keep);
process.exit(ok ? 0 : 1);
