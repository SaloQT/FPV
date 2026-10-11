#!/usr/bin/env node
/** Construction audit of the production park: exact primitive interference, end-cap reception,
 * support paths, coplanar finishes and (with --motion) moving mechanisms against everything else.
 * Writes report.json, an HTML summary and views.json (worst finding per group) for park-inspect.mjs. */
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, key, i, raw) => key.startsWith('--') ? [...all, [key.slice(2), raw[i + 1]?.startsWith('--') === false ? raw[i + 1] : '1']] : all, []));
const output = resolve(args.out ?? '.bench/park-audit'), seeds = (args.seeds ?? args.seed ?? '1337').split(',').map(Number), sizes = (args.sizes ?? 'destination').split(',');
const times = (args.times ?? '0,20').split(',').map(Number), families = args.families ? new Set(args.families.split(',')) : null;
const motion = args.motion === '1', motionStep = Number(args['motion-step'] ?? 0.05), motionSpan = Number(args['motion-span'] ?? 120);
if (seeds.some(s => !Number.isInteger(s) || s < 0) || sizes.some(s => !['compact', 'destination', 'mega'].includes(s)) || times.some(t => !(t >= 0 && t <= 600))) throw new Error('Invalid --seeds, --sizes or --times');
await mkdir(output, { recursive: true });
const bundle = resolve(output, 'bundle'); await mkdir(bundle, { recursive: true });
const entry = resolve(bundle, 'entry.ts');
const modules = [['buildPark', 'src/world/park/build.ts'], ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['ParkRuntime', 'src/world/park/runtime.ts'], ['pose', 'src/world/park/math.ts'],
  ['setPartProvenance, partSource', 'src/world/park/parts.ts'], ['auditPark, ownerRide, partFamily', 'src/world/park/constructionAudit.ts'], ['auditMotion', 'src/world/park/motionAudit.ts'], ['PARK_DT', 'src/world/park/ridePhysics.ts']];
await writeFile(entry, modules.map(([n, p]) => `export { ${n} } from ${JSON.stringify(resolve(p).replaceAll('\\', '/'))};`).join('\n'));
await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: bundle, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'audit.mjs' } } } });
const bundleSha256 = createHash('sha256').update(await readFile(resolve(bundle, 'audit.mjs'))).digest('hex');
const api = await import(pathToFileURL(resolve(bundle, 'audit.mjs')).href);
api.setPartProvenance(true);
const escape = t => String(t).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const report = { bundleSha256, generated: new Date().toISOString(), options: { seeds, sizes, times, families: families ? [...families] : 'all', motion, motionStep, motionSpan }, parks: [] };
const allViews = [];
for (const size of sizes) for (const seed of seeds) {
  const started = performance.now(), recipe = { ...api.defaultParkRecipe(seed, size), guests: 0 }, { park } = api.buildPark(recipe);
  const focus = families ? i => families.has(api.partFamily(park, i)) : undefined;
  const runtime = new api.ParkRuntime(park), poses = park.bodies.map(() => api.pose()), entryReport = { size, seed, parts: park.parts.length, bodies: park.bodies.length, generationMs: performance.now() - started, samples: [] };
  for (const time of [...times].sort((a, b) => a - b)) {
    while (runtime.elapsed < time - 1e-9) runtime.advance(Math.min(api.PARK_DT, time - runtime.elapsed));
    for (let i = 0; i < poses.length; i++) runtime.bodyPose(i, runtime.elapsed, poses[i]);
    const t0 = performance.now(), audit = api.auditPark(park, poses, { time: runtime.elapsed, focus });
    entryReport.samples.push({ time: runtime.elapsed, ms: performance.now() - t0, stats: audit.stats, findings: audit.findings, insertions: audit.insertions });
    console.log(`${size}/${seed} t=${runtime.elapsed.toFixed(2)}: ${audit.findings.length} findings (${(performance.now() - t0).toFixed(0)} ms)`, JSON.stringify(audit.stats));
  }
  if (motion) {
    const t0 = performance.now(), m = api.auditMotion(park, { step: motionStep, span: motionSpan, focus, families: families ? [...families] : undefined });
    entryReport.motion = { ms: performance.now() - t0, ...m };
    console.log(`${size}/${seed} motion: ${m.findings.length} findings over ${m.samples} samples (${(performance.now() - t0).toFixed(0)} ms)`);
  }
  // Group findings by kind, family and generator source; keep the worst of each group as an inspection view.
  const groups = new Map();
  const every = [...entryReport.samples.flatMap(s => s.findings), ...(entryReport.motion?.findings ?? [])];
  for (const f of every) {
    const key = `${f.kind} | ${f.family} | ${f.sources.map(s => s.split(' < ')[0]).join(' x ')}`;
    const g = groups.get(key) ?? { key, kind: f.kind, family: f.family, severity: f.severity, count: 0, maxMeasured: -Infinity, worst: null };
    g.count++; if (f.measured > g.maxMeasured) { g.maxMeasured = f.measured; g.worst = f; } groups.set(key, g);
  }
  entryReport.groups = [...groups.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'defect' ? -1 : 1) || b.count - a.count);
  for (const g of entryReport.groups) if (g.worst) allViews.push({ ...g.worst.view, name: `${size}-${seed}-${g.kind}-${g.family}-${g.worst.parts[0]}`.replace(/[^a-z0-9-]/gi, '_') });
  report.parks.push(entryReport);
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, (k, v) => typeof v === 'number' ? Number(v.toPrecision(6)) : v));
await writeFile(resolve(output, 'views.json'), JSON.stringify(allViews, null, 1));
const rows = report.parks.flatMap(p => p.groups.map(g => `<tr class="${g.severity}"><td>${p.size}/${p.seed}</td><td>${escape(g.kind)}</td><td>${escape(g.family)}</td><td>${g.count}</td><td>${(g.maxMeasured * 1000).toFixed(1)} mm</td><td>${escape(g.key.split(' | ')[2])}</td><td>${escape(g.worst?.detail ?? '')}<br><small>parts ${g.worst?.parts.join(', ')} at ${g.worst?.location.map(v => v.toFixed(2)).join(', ')} t=${g.worst?.time.toFixed(2)}</small></td></tr>`)).join('');
await writeFile(resolve(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Park construction audit</title><style>body{font:14px system-ui;margin:24px;color:#1d2a33}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #dde;padding:4px 8px;vertical-align:top;text-align:left}tr.defect td:nth-child(2){color:#b3261e;font-weight:600}small{color:#667}</style>
<h1>Park construction audit</h1><p>Bundle ${bundleSha256.slice(0, 16)} · ${escape(report.generated)} · seeds ${seeds.join(', ')} · sizes ${sizes.join(', ')} · times ${times.join(', ')} s${motion ? ` · motion every ${motionStep} s over ${motionSpan} s` : ''}</p>
<p>Exact convex primitive tests (GJK overlap, certified intrusion depth, end-cap containment by Lipschitz branch and bound) over the production generator and runtime poses. Each permitted overlap needs a declared monolith, insertion, coaxial or bearing contract. Sampled motion can miss contacts shorter than the sampling interval unless the clearance bound in the motion section says otherwise.</p>
<table><tr><th>Park</th><th>Kind</th><th>Family</th><th>Count</th><th>Worst</th><th>Sources</th><th>Worst case</th></tr>${rows}</table>`);
console.log(`Report: ${resolve(output, 'index.html')}`);
