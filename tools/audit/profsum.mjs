// Summarises a .cpuprofile (node --cpu-prof): top functions by self time and by inclusive time.
//   node tools/audit/profsum.mjs <file.cpuprofile> [n]
import { readFileSync } from 'node:fs';

const prof = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const n = Number(process.argv[3] ?? 25);
const byId = new Map(prof.nodes.map((x) => [x.id, x]));
const dt = new Map();
for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
const parent = new Map();
for (const x of prof.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
const key = (x) => `${x.callFrame.functionName || '(anon)'} ${x.callFrame.url.split('/').pop()}:${x.callFrame.lineNumber + 1}`;
const self = new Map(), incl = new Map();
for (const x of prof.nodes) {
  const t = (dt.get(x.id) ?? 0) / 1000;
  self.set(key(x), (self.get(key(x)) ?? 0) + t);
  // Inclusive: add to every distinct ancestor function once.
  const seen = new Set();
  for (let id = x.id; id !== undefined; id = parent.get(id)) {
    const k = key(byId.get(id));
    if (seen.has(k)) continue;
    seen.add(k);
    incl.set(k, (incl.get(k) ?? 0) + t);
  }
}
const total = [...dt.values()].reduce((a, b) => a + b, 0) / 1000;
const show = (m, title) => {
  console.log(`\n${title} (total ${(total / 1000).toFixed(1)} s)`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(`${(v / 1000).toFixed(2).padStart(8)} s  ${k}`);
};
show(self, 'self time');
show(incl, 'inclusive time');
