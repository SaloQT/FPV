// Trains a drone brain with PPO on the GPU, headless, with a live dashboard in the browser.
//
//   node tools/brain/train.mjs --name ace --minutes 30          # dashboard on http://127.0.0.1:8787
//   node tools/brain/train.mjs --name tech --styles technical,acro --recipes 12 --track my-track.json
//
// Options (defaults in brackets): --name [brain], --minutes [10] wall-clock budget, --iters [0 = until the budget], --envs [16384],
// --steps [32], --worlds [48] generated training worlds (few worlds overfit: the brain learns those tracks), --styles [every
// generated style: race, freestyle, mountain, sprint, technical, acro, industrial] in turn, --recipes [worlds / 6] how many of
// the worlds are random track-builder recipes (--styles race,freestyle,mountain,sprint --recipes 0 gives the 48 worlds the
// trainer flew before technical, acro, industrial and recipes joined the mix), --track <file.json>[,more] track files flown as extra worlds (a TrackData JSON or
// a track builder export { terrainSeed, quality, track }), --seed [1], --lr [3e-4], --lrEnd [lr], --resume <brain.json>,
// --every [5] minutes between checkpoints, --out [public/brains], --env key=value,... reward and episode overrides
// (src/ai/gpu/envKernel.ts EnvConfig, e.g. --env crashPenalty=30,ratePenalty=4e-4), --dash [8787] dashboard port (0 = off),
// --trace [256 with the dashboard, else 0] drones whose every step is sent to the dashboard (a multiple of 16), --runs
// [.bench/brain/runs] where the dashboard keeps <name>.train.ndjson and <name>.trace.bin for `node tools/brain/dashboard.mjs
// --run <runs>/<name>`. Checkpoints and the final brain land in <out>/<name>.json; <out>/index.json lists them all. The
// dashboard's Save button writes a checkpoint after the current iteration; Stop (or Ctrl+C) finishes after it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gpuDevice, loadTrainer, ROOT } from './bundle.mjs';

const keep = setInterval(() => {}, 1000);
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : (all[i + 1] ?? 'true')]] : acc), []));
const num = (k, d) => {
  if (args[k] === undefined) return d;
  const v = Number(args[k]);
  if (!Number.isFinite(v)) throw new Error(`--${k}: not a number: ${args[k]}`);
  return v;
};
const name = args.name ?? 'brain';
const outDir = resolve(ROOT, args.out ?? 'public/brains');
const runsDir = resolve(ROOT, args.runs ?? '.bench/brain/runs');
const minutes = num('minutes', 10);
const maxIters = num('iters', 0);
const everyMin = num('every', 5);
const seed = num('seed', 1);
const dashPort = num('dash', 8787);

const t = await loadTrainer();
const styles = args.styles ? t.parseStyles(args.styles) : undefined;
const { device, name: gpuName, backend } = await gpuDevice();
console.log(`${backend}: ${gpuName}`);

const worlds = [];
const w0 = performance.now();
const say = (w) => {
  console.log(t.describeWorld(w, worlds.length));
  for (const m of w.warnings ?? []) console.log(`  warning: ${m}`);
};
for (const spec of t.trainWorldSpecs({ worlds: num('worlds', 48), seed, styles, recipes: args.recipes === undefined ? undefined : num('recipes', 0) })) {
  let w;
  try {
    w = t.buildMixWorld(spec);
  } catch (e) {
    console.log(`skipped ${spec.style ?? 'recipe'} world on terrain ${spec.seed}: ${e.message}`);
    continue;
  }
  say(w);
  worlds.push(w);
}
for (const file of (args.track ?? '').split(',').filter(Boolean)) {
  const w = t.trackFileWorld(await readFile(resolve(ROOT, file), 'utf8'));
  console.log(`track file ${file}:`);
  say(w);
  worlds.push(w);
}
if (!worlds.length) throw new Error('no training worlds');
console.log(`${worlds.length} worlds built in ${((performance.now() - w0) / 1000).toFixed(1)} s`);

const resume = args.resume ? t.parseBrain(await readFile(resolve(ROOT, args.resume), 'utf8')) : undefined;
const cfg = { ...t.DEFAULT_PPO, envs: num('envs', t.DEFAULT_PPO.envs), steps: num('steps', t.DEFAULT_PPO.steps), seed, lr: num('lr', 3e-4) };
cfg.lrEnd = num('lrEnd', cfg.lr);
const env = { ...t.DEFAULT_ENV };
for (const kv of (args.env ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in env) || !Number.isFinite(Number(v))) throw new Error(`--env: unknown setting or bad value: ${kv}`);
  env[k] = Number(v);
}
if (args.env) console.log(`env overrides: ${args.env}`);

let stop = false;
let saveNow = false;
let dash = null;
// The trace costs one readback of K x steps x 16 bytes per iteration, inside the metrics copy; without a dashboard nobody reads it.
cfg.traceEnvs = num('trace', dashPort > 0 ? Math.min(t.DASH_TRACE_ENVS, cfg.envs - (cfg.envs % 16)) : 0);
if (dashPort > 0) {
  try {
    const { startDashboard } = await import('./dashServer.mjs');
    const geometry = worlds.map((w, i) => t.worldGeometry(w, i));
    dash = await startDashboard({
      port: dashPort, name, outDir: runsDir, config: { ppo: cfg, env }, worlds: geometry,
      onCommand: (cmd) => {
        if (cmd === 'save') { saveNow = true; console.log('dashboard: checkpoint after this iteration'); }
        if (cmd === 'stop') { stop = true; console.log('dashboard: stopping after this iteration...'); }
      },
    });
    console.log(`dashboard run files: ${resolve(runsDir, name)}.train.ndjson and .trace.bin`);
  } catch (e) {
    console.log(`dashboard not started: ${e.message}`);
    if (args.trace === undefined) cfg.traceEnvs = 0;
  }
}
if (cfg.traceEnvs > 0 && cfg.traceEnvs < worlds.length) console.log(`note: ${cfg.traceEnvs} traced drones for ${worlds.length} worlds; worlds ${cfg.traceEnvs}+ show no drones`);

const c0 = performance.now();
const trainer = await t.PpoTrainer.create(device, worlds, cfg, env, resume);
console.log(`trainer ready in ${((performance.now() - c0) / 1000).toFixed(1)} s: ${cfg.envs} drones, ${cfg.steps} steps per iteration, ${cfg.envs * cfg.steps} samples, minibatch ${(cfg.envs * cfg.steps) / cfg.minibatches}${cfg.traceEnvs ? `, ${cfg.traceEnvs} traced` : ''}`);

const prior = resume?.stats ?? { steps: 0, iterations: 0, seconds: 0 };
let bestLap = resume?.stats.bestLap ?? 0;
let lastSave = performance.now();
process.on('SIGINT', () => { stop = true; console.log('\nstopping after this iteration...'); });

async function save(m, final) {
  const seconds = prior.seconds + (performance.now() - start) / 1000;
  const minutesSim = (cfg.envs * cfg.steps) / 50 / 60;
  const brain = await trainer.exportBrain(name, {
    steps: prior.steps + trainer.envSteps, iterations: prior.iterations + trainer.iteration, seconds,
    gatesPerMinute: m ? m.gates / minutesSim : 0, bestLap, meanReturn: m?.meanReturn ?? 0,
  });
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, `${name}.json`), t.serializeBrain(brain));
  const indexPath = resolve(outDir, 'index.json');
  let index = { brains: [] };
  try { index = JSON.parse(await readFile(indexPath, 'utf8')); } catch { /* first brain */ }
  index.brains = [...(index.brains ?? []).filter((b) => b.file !== `${name}.json`), { file: `${name}.json`, name, stats: brain.stats }];
  index.brains.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(indexPath, `${JSON.stringify(index, null, 1)}\n`);
  console.log(`${final ? 'saved' : 'checkpoint'} ${resolve(outDir, `${name}.json`)}`);
}

const start = performance.now();
let m = null;
let wallSteps = 0;
let diverged = false;
let failed = null;
console.log(' iter      steps   steps/s   physics/s  episodes  return  length  crash%  gates/min  laps  bestlap    kl    clip  logstd');
try {
  while (!stop) {
    const i0 = performance.now();
    m = await trainer.iterate();
    const iterMs = performance.now() - i0;
    if (m.bestLap > 0 && (bestLap === 0 || m.bestLap < bestLap)) bestLap = m.bestLap;
    const elapsed = (performance.now() - start) / 1000;
    const sps = (cfg.envs * cfg.steps) / (m.gpuMs / 1000);
    const simMin = (cfg.envs * cfg.steps) / 50 / 60;
    wallSteps += cfg.envs * cfg.steps;
    if (dash) {
      const { trace, ...metrics } = m;
      dash.push({ iteration: m.iteration, elapsed, envSteps: prior.steps + m.envSteps, sps, metrics: { ...metrics, iterMs }, trace });
    }
    console.log(`${String(m.iteration).padStart(5)} ${(prior.steps + m.envSteps).toExponential(2).padStart(10)} ${sps.toExponential(2).padStart(9)} ${(sps * 80).toExponential(2).padStart(11)} ${String(m.episodes).padStart(9)} ${m.meanReturn.toFixed(1).padStart(7)} ${(m.meanLength / 50).toFixed(1).padStart(6)}s ${(m.episodes ? (100 * m.crashes) / m.episodes : 0).toFixed(0).padStart(6)} ${(m.gates / simMin).toFixed(2).padStart(10)} ${String(m.laps).padStart(5)} ${(m.bestLap ? m.bestLap.toFixed(2) : '-').padStart(8)} ${m.approxKl.toFixed(4).padStart(6)} ${m.clipFraction.toFixed(3).padStart(6)} ${(m.logStd.reduce((a, b) => a + b, 0) / 4).toFixed(2).padStart(6)}`);
    if (!Number.isFinite(m.policyLoss) || !Number.isFinite(m.valueLoss)) { console.log('loss is not finite; stopping (the last checkpoint is kept)'); diverged = true; break; }
    if (maxIters && m.iteration >= maxIters) break;
    if (elapsed > minutes * 60) break;
    if (saveNow || (performance.now() - lastSave) / 60000 > everyMin) { await save(m, false); lastSave = performance.now(); saveNow = false; }
  }
  const wall = (performance.now() - start) / 1000;
  if (m) console.log(`${trainer.iteration} iterations in ${wall.toFixed(1)} s: ${(wallSteps / wall).toExponential(3)} decisions/s wall clock`);
  // Stopped before the first iteration (the dashboard takes commands while the pipelines compile): nothing was trained, so
  // nothing is written over <out>/<name>.json or listed in index.json.
  if (m && !diverged) await save(m, true);
  else if (!m) console.log('stopped before the first iteration: no brain saved');
} catch (e) {
  failed = e;
  console.error(`training failed: ${e?.stack ?? e}`);
} finally {
  // Always close the dashboard, also after a lost device or a failed save, so the page shows the run ended.
  await dash?.close();
  clearInterval(keep);
}
process.exit(failed || diverged ? 1 : 0);
