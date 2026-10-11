#!/usr/bin/env node
/** Reproducible top-down layout artifacts and measured land use; no GPU renderer or artwork assets. */
import { build } from 'vite';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, key, i, raw) => key.startsWith('--') ? [...all, [key.slice(2), raw[i + 1]?.startsWith('--') === false ? raw[i + 1] : '1']] : all, []));
const out = resolve(args.out ?? '.bench/park-blueprints'), seed = Number(args.seed ?? 1337), grid = Number(args.grid ?? 2);
if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Invalid --seed');
const sizes = args.sizes ? args.sizes.split(',') : ['destination', 'compact', 'mega'];
const layouts = args.layouts ? args.layouts.split(',') : ['random'];
if (sizes.some(size => !['compact', 'destination', 'mega'].includes(size)) || layouts.some(layout => !['random', 'hub', 'loop', 'valley', 'boardwalk'].includes(layout))) throw new Error('Invalid --sizes or --layouts');
const examples = sizes.flatMap(size => layouts.map(layout => ({ size, layout })));
if (!args.sizes && !args.layouts) examples.push(...['hub', 'loop', 'valley', 'boardwalk'].map(layout => ({ size: 'destination', layout })));
await mkdir(out, { recursive: true }); const bundle = resolve(out, 'bundle'); await mkdir(bundle, { recursive: true });
if (args['generation-bundle'] && resolve(args['generation-bundle']) === resolve(bundle, 'blueprint.mjs') && args['reuse-bundle'] !== '1') throw new Error('Use a separate --out directory when remeasuring a frozen --generation-bundle');
const entry = resolve(bundle, 'entry.ts');
await writeFile(entry, [['buildPark', 'src/world/park/build.ts'], ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['makeParkBlueprint, renderParkBlueprint', 'src/world/park/blueprint.ts']].map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(path).replaceAll('\\', '/'))};`).join('\n'));
if (args['reuse-bundle'] !== '1') await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: bundle, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'blueprint.mjs' } } } });
const api = await import(pathToFileURL(resolve(bundle, 'blueprint.mjs')).href);
// Compare a frozen generation bundle using current measurement semantics without rewriting the baseline generator.
const generation = args['generation-bundle'] ? await import(pathToFileURL(resolve(args['generation-bundle'])).href) : api;
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const measurementBundleSha256 = await digest(resolve(bundle, 'blueprint.mjs'));
const generationBundleSha256 = args['generation-bundle'] ? await digest(resolve(args['generation-bundle'])) : measurementBundleSha256;
let browser;
if (args.png === '1') {
  const candidates = [args.browser, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
  let executablePath; for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
  if (!executablePath) throw new Error('PNG rendering needs --browser <Chromium executable>; SVG generation works without it.');
  const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
}
const reports = [];
try {
  for (const example of examples) {
    const recipe = { ...api.defaultParkRecipe(seed, example.size), layout: example.layout }, started = performance.now();
    const { park } = generation.buildPark(recipe), blueprint = api.makeParkBlueprint(park, grid), svg = api.renderParkBlueprint(park, blueprint);
    const name = `${example.size}-${example.layout}-${seed}`, svgPath = resolve(out, `${name}.svg`);
    await writeFile(svgPath, svg);
    const report = { name, recipe, generationBundleSha256, measurementBundleSha256, resolvedLayout: park.layout, bounds: blueprint.bounds, metrics: blueprint.metrics, generationAndAnalysisMs: performance.now() - started,
      method: 'Grid cell-centre union; overlapping object footprints count once. Parcel is the attraction/public-realm convex hull plus 20m. Flat ride apron matches generated radius+3m; rail corridor is 4m wide. Building/service footprints and landscape canopy remain separate; engine plantings use designed rotated crown ellipses, excluding conservative flight-clearance and LOD card margins. Empty-circle distance uses an exact squared Euclidean transform of grid centres, reduced by half a cell diagonal. Geometry projection samples curved primitive support outlines. Enclosure is a proxy: only features at least 1.5m above paths are eligible; public path length is sampled every 5m with perpendicular rays from both physical edges up to 15m, stopped at the parcel boundary.' };
    await writeFile(resolve(out, `${name}.json`), JSON.stringify(report, null, 2)); reports.push(report);
    if (browser) {
      const page = await browser.newPage();
      // Rasterize the standalone SVG directly; this also works when headless Windows has no compositor screenshot surface.
      const png = await page.evaluate(async source => {
        const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' })), image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
        const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1320;
        canvas.getContext('2d').drawImage(image, 0, 0); URL.revokeObjectURL(url); return canvas.toDataURL('image/png').split(',')[1];
      }, svg);
      await writeFile(resolve(out, `${name}.png`), Buffer.from(png, 'base64')); await page.close();
    }
    console.log(`${name}: ${(blueprint.metrics.developedCoverage * 100).toFixed(1)}% developed union; largest empty diameter ${(blueprint.metrics.largestEmptyCircle.radius * 2).toFixed(0)}m; ${blueprint.metrics.reachableStations}/${blueprint.metrics.stations} stations reachable. ${svgPath}`);
  }
  await writeFile(resolve(out, 'report.json'), JSON.stringify(reports, null, 2));
  const links = reports.map(r => `<li><a href="${r.name}.svg">${r.name}</a> · ${(r.metrics.developedCoverage * 100).toFixed(1)}% developed · <a href="${r.name}.json">metrics</a></li>`).join('\n');
  await writeFile(resolve(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Procedural park blueprints</title><style>body{font:18px system-ui;max-width:1100px;margin:48px auto;background:#f6f7f3;color:#243d50}li{margin:14px 0}a{color:#315f85}img{width:100%;border:1px solid #bbc8c5}</style><h1>Procedural park blueprints</h1><p>Seed ${seed}. Measurements use actual generated geometry, paths and operating ride aprons. Compare land use, circulation and empty space across sizes and layouts.</p><ul>${links}</ul>${reports.map(r => `<h2>${r.name}</h2><img src="${r.name}.svg" alt="${r.name} park blueprint">`).join('\n')}</html>`);
} finally { await browser?.close(); }
