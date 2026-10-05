// GPU observation vector vs the game's TypeScript `observe`, and the GPU's path-progress state vs src/ai/train/pathProgress.ts:
// `node tools/brain/obscheck.mjs [--styles race,sprint]`. Fails above 1e-4 on any observation slot, or when the arc length
// along the path differs by 5 cm anywhere or by over 1 mm for more than 1 % of the drones (f32 near-ties between samples).
import { gpuDevice, loadTrainer } from './bundle.mjs';

const keep = setInterval(() => {}, 1000);
const argv = process.argv.slice(2);
const at = argv.indexOf('--styles');
const t = await loadTrainer();
const styles = at >= 0 ? t.parseStyles(argv[at + 1] ?? '') : ['race', 'sprint'];
const { device, name, backend } = await gpuDevice();
console.log(`${backend}: ${name}`);
const seeds = [4242, 77, 1001, 5003, 9001, 31337, 2024];
const worlds = styles.map((style, k) => t.buildTrainWorld({ seed: seeds[k % seeds.length] + 7919 * Math.floor(k / seeds.length), style }));
for (const [k, w] of worlds.entries()) console.log(t.describeWorld(w, k));
const r = await t.runObsCheck(device, worlds);
const worst = Math.max(...r.worst);
console.log(`compared ${r.compared} observations; worst gap per slot:`);
console.log(r.worst.map((v, i) => `${i}:${v.toExponential(1)}`).join(' '));
console.log(`path progress: compared ${r.pathCompared} drones, worst arc-length gap ${r.pathWorst.toExponential(2)} m (${r.pathWorstOff.toFixed(1)} m off the line), ${r.pathOff1mm} above 1 mm`);
const pathOk = r.pathCompared > 0 && r.pathWorst < 0.05 && r.pathOff1mm <= 0.01 * r.pathCompared;
const ok = worst < 1e-4 && pathOk;
console.log(ok ? `obscheck: PASS (worst ${worst.toExponential(2)})` : `obscheck: FAIL (worst ${worst.toExponential(2)}, path ${r.pathWorst.toExponential(2)} m)`);
clearInterval(keep);
process.exit(ok ? 0 : 1);
