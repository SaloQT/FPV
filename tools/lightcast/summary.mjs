// Prints the grey-card colour and the shade / sun ratio of each measure.mjs run (.bench/lightcast/<tag>/results.json, terms all and real):
//   node tools/lightcast/summary.mjs cmp-base cmp-ground cmp-fix
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '../../.bench/lightcast');
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const fmt = (s) => (s ? `${s.rel.map((v) => v.toFixed(2)).join('/')} h${String(s.hue).padStart(3)}` : '        -        ');
const runs = process.argv.slice(2).map((tag) => [tag, JSON.parse(readFileSync(resolve(here, tag, 'results.json'), 'utf8'))]);
const keys = Object.keys(runs[0][1]);
console.log('view|quality|hour'.padEnd(26), 'run'.padEnd(12), 'card bark-shade'.padEnd(20), 'card ground-shade'.padEnd(20), 'card ground-sun'.padEnd(20), 'shade/sun', '  real bark-shade');
for (const k of keys) {
  for (const [tag, r] of runs) {
    const all = r[k]?.all ?? {}, real = r[k]?.real ?? {};
    const ratio = all['ground-shade'] && all['ground-sun'] ? (lum(all['ground-shade'].rgb) / lum(all['ground-sun'].rgb)).toFixed(3) : '  -  ';
    console.log(k.padEnd(26), tag.padEnd(12), fmt(all['bark-shade']).padEnd(20), fmt(all['ground-shade']).padEnd(20), fmt(all['ground-sun']).padEnd(20), String(ratio).padEnd(9), ' ', fmt(real['bark-shade']));
  }
}
