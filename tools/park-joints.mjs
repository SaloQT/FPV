#!/usr/bin/env node
/** Declared construction-interface audit through production generation and runtime poses. */
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, key, i, raw) => key.startsWith('--') ? [...all, [key.slice(2), raw[i + 1]?.startsWith('--') === false ? raw[i + 1] : '1']] : all, []));
const output = resolve(args.out ?? '.bench/park-joints'), seed = Number(args.seed ?? 1337), sizes = (args.sizes ?? 'compact,destination,mega').split(',');
const times = [...new Set((args.times ?? '0,7,18,35,60,95').split(',').map(Number))].sort((a, b) => a - b);
if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295 || sizes.some(s => !['compact', 'destination', 'mega'].includes(s)) || times.some(t => !Number.isFinite(t) || t < 0 || t > 600)) throw new Error('Invalid --seed, --sizes or --times');
const bundle = resolve(output, 'bundle'); await mkdir(bundle, { recursive: true });
const entry = resolve(bundle, 'entry.ts');
await writeFile(entry, [['buildPark', 'src/world/park/build.ts'], ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['ParkRuntime', 'src/world/park/runtime.ts'], ['measureJoints', 'src/world/park/construction.ts'], ['pose', 'src/world/park/math.ts'], ['PARK_DT', 'src/world/park/ridePhysics.ts']]
  .map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(path).replaceAll('\\', '/'))};`).join('\n'));
await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: bundle, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'joints.mjs' } } } });
const bundleSha256 = createHash('sha256').update(await readFile(resolve(bundle, 'joints.mjs'))).digest('hex');
const api = await import(pathToFileURL(resolve(bundle, 'joints.mjs')).href), reports = [];
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const limitation = 'This audits declared interfaces only, using production primitive-local anchors and runtime body transforms. The explicit anchorModel distinguishes material anchors from virtual axes independently of joint kind. Material anchors must lie on or inside their declared primitives; anchorError is the maximum positive signed distance outside them. Coincident material anchors alone do not prove finite-area flush contact. Passing does not establish that every touching surface has a declaration, that unrelated parts cannot intersect, or that the complete geometry is structurally valid. Numerical tolerances only bound floating-point transform error; designed travel and clearance remain explicit joint ranges.';

function summary(records, key) {
  const groups = new Map();
  for (const r of records) { const label = key(r), g = groups.get(label) ?? { label, joints: 0, failed: 0, maxLateralError: 0, maxAxisError: 0, maxSeparationError: 0, maxAnchorError: 0 };
    g.joints++; g.failed += r.pass ? 0 : 1; for (const field of ['maxLateralError', 'maxAxisError', 'maxSeparationError', 'maxAnchorError']) g[field] = Math.max(g[field], r[field]); groups.set(label, g); }
  return [...groups.values()].sort((a, b) => b.failed - a.failed || b.joints - a.joints || a.label.localeCompare(b.label));
}
function svg(park, report) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const joint of report.joints) for (const p of [joint.worst.a, joint.worst.b]) { bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[2]); bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[2]); }
  const minX = bounds[0] - 30, minZ = bounds[1] - 30, maxX = bounds[2] + 30, maxZ = bounds[3] + 30;
  const scale = Math.min(1120 / (maxX - minX), 1000 / (maxZ - minZ)), x = v => 40 + (v - minX) * scale, z = v => 100 + (v - minZ) * scale;
  const paths = park.paths.map(p => { const a = park.nodes[p.a].pos, b = park.nodes[p.b].pos; return `<path d="M${x(a[0])},${z(a[2])}L${x(b[0])},${z(b[2])}" stroke="#d6dcda" stroke-width="${Math.max(1, p.width * scale)}"/>`; }).join('');
  const markers = report.joints.map(j => `<circle cx="${x(j.worst.a[0])}" cy="${z(j.worst.a[2])}" r="${j.pass ? 1.7 : 5}" fill="${j.pass ? '#2e7868' : '#be3434'}" opacity="${j.pass ? 0.7 : 1}"><title>${escape(j.family)} · ${escape(j.name)} · ${j.pass ? 'pass' : 'FAIL'} · ${j.contactModel} · t=${j.worst.time}s α=${j.worst.alpha} · distance error ${j.maxSeparationError.toExponential(3)}m · anchor outside material ${j.maxAnchorError.toExponential(3)}m</title></circle>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#f4f6f3"/><g font-family="system-ui" fill="#253c4b"><text x="40" y="40" font-size="27">CONSTRUCTION CONTACTS · ${escape(report.size.toUpperCase())}</text><text x="40" y="70" font-size="16">Seed ${report.seed} · ${report.counts.joints} declared joints · ${report.counts.failed} failed · sampled at ${escape(times.join(', '))}s</text></g>${paths}${markers}<g font-family="system-ui" font-size="14" fill="#253c4b"><text x="40" y="1150">Green: all sampled contacts pass. Red: a declared contact fails. Hover markers for details.</text><text x="40" y="1176">Declared joints only; this is not an exhaustive collision or structural audit.</text></g></svg>`;
}

for (const size of sizes) {
  const recipe = api.defaultParkRecipe(seed, size), started = performance.now(), { park } = api.buildPark(recipe), generationMs = performance.now() - started, runtime = new api.ParkRuntime(park), poses = park.bodies.map(() => api.pose());
  const declarations = park.joints ?? [];
  if (!declarations.length) throw new Error(`${size}: no declared construction joints`);
  const records = declarations.map((joint, index) => {
    const body = [joint.a, joint.b].map(a => park.parts[a.part].body).find(b => b >= 0), declaredRide = joint.name.match(/^(\d+)\//);
    const ride = body === undefined ? declaredRide ? park.rides[Number(declaredRide[1])] : undefined : park.rides[park.bodies[body].ride], segments = joint.name.split('/');
    return { index, name: joint.name, interface: segments.length > 1 ? segments[1] : joint.name, kind: joint.kind, contactModel: joint.anchorModel ?? 'material', family: ride?.family ?? `static/${park.parts[joint.a.part].category ?? 'unclassified'}`, ride: ride?.name ?? null, rationale: joint.rationale,
      min: joint.min ?? 0, max: joint.max ?? 0, pass: true, samples: 0, maxLateralError: 0, maxAxisError: 0, maxSeparationError: 0, maxAnchorError: 0, worst: null, severity: -1 };
  });
  const simulationStarted = performance.now(), samples = [];
  for (const time of times) {
    while (runtime.elapsed < time - 1e-10) runtime.advance(Math.min(api.PARK_DT, time - runtime.elapsed));
    for (const alpha of [1, 0.5]) {
      const poseTime = Math.max(0, runtime.elapsed - (1 - alpha) * api.PARK_DT);
      for (let i = 0; i < poses.length; i++) runtime.bodyPose(i, poseTime, poses[i]);
      const measurements = api.measureJoints(park, poses); let failed = 0;
      for (let i = 0; i < measurements.length; i++) {
        const m = measurements[i], r = records[i], separationError = r.kind === 'fixed' ? m.separation : Math.max(0, r.min - m.separation, m.separation - r.max), severity = (m.pass ? 0 : 1e6) + Math.max(separationError, m.lateralError, m.axisError, m.anchorError) / Math.max(m.numericTolerance, Number.EPSILON);
        r.pass &&= m.pass; r.samples++; r.maxLateralError = Math.max(r.maxLateralError, m.lateralError); r.maxAxisError = Math.max(r.maxAxisError, m.axisError); r.maxSeparationError = Math.max(r.maxSeparationError, separationError); r.maxAnchorError = Math.max(r.maxAnchorError, m.anchorError);
        if (severity > r.severity) { r.severity = severity; r.worst = { time, alpha, poseTime, ...m }; }
        if (!m.pass) failed++;
      }
      samples.push({ time, alpha, poseTime, measurements: measurements.length, failed });
    }
  }
  const report = { bundleSha256, size, seed, recipe, times, generationMs, simulationAndAuditMs: performance.now() - simulationStarted,
    counts: { parts: park.parts.length, renderedParts: park.parts.filter(p => p.render !== false).length, solidParts: park.parts.filter(p => p.solid).length, hiddenSourceSlabs: park.parts.filter(p => p.render === false && !p.solid && p.surface === 'paving').length,
      pavingPrisms: park.parts.filter(p => p.shape === 'gable' && p.surface === 'paving').length, bodies: park.bodies.length, plantings: park.plantings?.length ?? 0, joints: records.length, failed: records.filter(r => !r.pass).length },
    limitations: limitation, samples, byKind: summary(records, r => r.kind), byContactModel: summary(records, r => r.contactModel), byFamily: summary(records, r => r.family), byName: summary(records, r => r.interface), joints: records.map(({ severity, ...record }) => record) };
  const name = `${size}-${seed}`; await writeFile(resolve(output, `${name}.json`), JSON.stringify(report, null, 2)); await writeFile(resolve(output, `${name}.svg`), svg(park, report)); reports.push(report);
  console.log(`${size}: ${report.counts.joints} declared joints; ${report.counts.failed} failed; ${report.counts.renderedParts} rendered parts (${report.counts.pavingPrisms} pavement prisms); generation ${generationMs.toFixed(0)}ms`);
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(reports.map(({ joints, ...report }) => report), null, 2));
await writeFile(resolve(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Park construction contacts</title><style>body{font:17px system-ui;max-width:1200px;margin:40px auto;background:#f4f6f3;color:#253c4b}img{width:100%}table{border-collapse:collapse}td,th{padding:8px 18px;text-align:right;border-bottom:1px solid #bcc9c5}th:first-child,td:first-child{text-align:left}</style><h1>Park construction contacts</h1><p>${escape(limitation)}</p><table><tr><th>Size</th><th>Declared joints</th><th>Failures</th><th>Rendered parts</th><th>Generation</th></tr>${reports.map(r => `<tr><td><a href="${r.size}-${seed}.json">${r.size}</a></td><td>${r.counts.joints}</td><td>${r.counts.failed}</td><td>${r.counts.renderedParts}</td><td>${r.generationMs.toFixed(0)}ms</td></tr>`).join('')}</table>${reports.map(r => `<h2>${r.size}</h2><p>Open the map to inspect individual connection markers.</p><a href="${r.size}-${seed}.svg"><img src="${r.size}-${seed}.svg" alt="Declared construction joints for ${r.size}"></a>`).join('')}</html>`);
console.log(`Audit artifacts: ${output}`); if (reports.some(r => r.counts.failed)) process.exitCode = 1;
