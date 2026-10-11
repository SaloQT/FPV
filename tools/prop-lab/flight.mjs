// Flies trained brains on a few tracks with each prop fitted, in the game's own sim, and prints lap time, crashes and battery used.
//
//   node tools/prop-lab/flight.mjs public/brains/ace.json [more.json ...] [--props a.json,b.json] [--worlds 2]
//        [--styles race,acro] [--track t.json] [--seconds 90]
//
// The stock prop is always flown first. --props takes prop files (see .bench/prop-lab/props and public/props).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadPropLab, ROOT } from './bundle.mjs';

const argv = process.argv.slice(2);
const str = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const opt = (k, d) => (str(k) !== undefined ? Number(str(k)) : d);
const files = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!files.length) { console.error('usage: node tools/prop-lab/flight.mjs brain.json [...] [--props a.json,b.json]'); process.exit(1); }

const p = await loadPropLab();
const styles = str('styles') ? p.parseStyles(str('styles')) : undefined;
const worlds = p.evalWorldSpecs({ worlds: opt('worlds', 2), seed: 0, styles, recipes: 0 }).map((s) => p.buildMixWorld(s));
for (const f of (str('track') ?? '').split(',').filter(Boolean)) worlds.push(p.trackFileWorld(await readFile(resolve(ROOT, f), 'utf8')));
worlds.forEach((w, k) => console.log(p.describeWorld(w, k)));
const gatesOf = (w) => w.track.gates.length * (w.track.closed ? w.track.laps : 1);

const props = [p.DEFAULT_PROP];
for (const f of (str('props') ?? '').split(',').filter(Boolean)) props.push(p.parseProp(await readFile(resolve(ROOT, f), 'utf8')));

for (const bf of files) {
  const brain = p.parseBrain(await readFile(resolve(ROOT, bf), 'utf8'));
  console.log(`\nbrain ${brain.name}`);
  for (const d of props) {
    const runs = worlds.map((w, k) => p.flyBrainWithProp(brain, w, d, { seconds: opt('seconds', 90), seed: 1 + k }));
    const cells = runs.map((r) => `${Number.isFinite(r.finish) ? `${r.finish.toFixed(2)}s` : `DNF ${r.gates}g`} ${r.crashes}cr ${r.mah.toFixed(0)}mAh`);
    const score = p.flightScore(runs, Math.round(worlds.reduce((s, w) => s + gatesOf(w), 0) / worlds.length));
    console.log(`  ${d.name.padEnd(22)} ${cells.join(' | ')}   score ${score.toFixed(2)}`);
  }
}
