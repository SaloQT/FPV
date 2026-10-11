// Displayed colour (linear, r/g and b/g) per class with the white balance off and on, from two measure.mjs runs under .bench/lightcast/:
//   node tools/lightcast/wbsummary.mjs wb-wboff wb-wbon   (TERM_NAME picks the term, default real)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '../../.bench/lightcast');
const term = process.env.TERM_NAME ?? 'real';
const [off, on] = process.argv.slice(2).map((t) => JSON.parse(readFileSync(resolve(here, t, 'results.json'), 'utf8')));
const fmt = (s) => (s ? `${s.rel[0].toFixed(2)}/${s.rel[2].toFixed(2)} h${String(s.hue).padStart(3)}` : '      -      ');
const classes = ['disp-bark-shade', 'disp-ground-shade', 'disp-bark-sun', 'disp-ground-sun'];
console.log('view|quality|hour'.padEnd(24), classes.map((c) => c.replace('disp-', '').padEnd(31)).join(''));
console.log(''.padEnd(24), classes.map(() => 'off (r/g b/g)   on'.padEnd(31)).join(''));
for (const k of Object.keys(off)) {
  const a = off[k][term] ?? {}, b = on[k]?.[term] ?? {};
  console.log(k.padEnd(24), classes.map((c) => `${fmt(a[c])} ${fmt(b[c])}`.padEnd(31)).join(''));
}
