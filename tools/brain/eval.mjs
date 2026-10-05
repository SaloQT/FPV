// Times brains in the game's own TypeScript sim (QuadPhysics + BrainPilot + GateTimer), on worlds they did not train on.
//
//   node tools/brain/eval.mjs public/brains/ace.json [more.json ...] [--worlds 3] [--styles race,acro] [--recipes 2]
//        [--track a.json,b.json] [--seconds 120] [--wind 0] [--write]
//
// --worlds style worlds take the styles in turn (default the original four: race, freestyle, mountain, sprint), --recipes adds
// that many random track-builder recipes, --track adds track files (TrackData or a builder export). --write stores the mean
// finish time of the finished races as stats.evalLap in each brain file.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadTrainer, ROOT } from './bundle.mjs';

const argv = process.argv.slice(2);
const files = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--write'));
const str = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const opt = (k, d) => (str(k) !== undefined ? Number(str(k)) : d);
const write = argv.includes('--write');
const nWorlds = opt('worlds', 3);
const seconds = opt('seconds', 120);
const wind = opt('wind', 0);

const t = await loadTrainer();
const styles = str('styles') ? t.parseStyles(str('styles')) : undefined;
// Seeds far from the trainer's (1000 + 7919 k + seed), so these tracks are new to every brain
const worlds = t.evalWorldSpecs({ worlds: nWorlds, seed: 0, styles, recipes: opt('recipes', 0) }).map((s) => t.buildMixWorld(s));
for (const f of (str('track') ?? '').split(',').filter(Boolean)) worlds.push(t.trackFileWorld(await readFile(resolve(ROOT, f), 'utf8')));
for (const [k, w] of worlds.entries()) {
  console.log(t.describeWorld(w, k));
  for (const m of w.warnings ?? []) console.log(`  warning: ${m}`);
}

let failed = false;
for (const f of files) {
  const path = resolve(ROOT, f);
  const brain = t.parseBrain(await readFile(path, 'utf8'));
  const runs = worlds.map((w, k) => t.evaluateBrain(brain, w, { seconds, windSpeed: wind, seed: 1 + k }));
  for (const [k, r] of runs.entries()) {
    console.log(`${brain.name} world ${k}: ${r.gates} gates, ${r.laps} laps, ${r.crashes} crashes, ${r.stalls} stalls, ${Number.isFinite(r.finish) ? `finished in ${r.finish.toFixed(2)} s` : `not finished after ${r.seconds.toFixed(0)} s`}, best lap ${Number.isFinite(r.bestLap) ? r.bestLap.toFixed(2) : '-'} (${(r.wallMs / 1000).toFixed(1)} s wall)`);
    if (!Number.isFinite(r.gates)) failed = true;
  }
  const done = runs.filter((r) => Number.isFinite(r.finish));
  const evalLap = done.length ? done.reduce((a, r) => a + r.finish, 0) / done.length : 0;
  console.log(`${brain.name}: finished ${done.length}/${runs.length}, ${runs.reduce((a, r) => a + r.gates, 0)} gates, ${runs.reduce((a, r) => a + r.crashes, 0)} crashes${evalLap ? `, mean finish ${evalLap.toFixed(2)} s` : ''}`);
  if (write) {
    brain.stats.evalLap = evalLap;
    await writeFile(path, t.serializeBrain(brain));
    console.log(`wrote stats.evalLap to ${path}`);
  }
}
process.exit(failed ? 1 : 0);
