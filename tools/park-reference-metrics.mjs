#!/usr/bin/env node
/** Measure a local OSM reference with the exact same sampling routine as generated park blueprints. */
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = process.argv[2];
if (!file) throw new Error('Usage: node tools/park-reference-metrics.mjs <reference.json> [grid metres]');
const grid = Number(process.argv[3] ?? 2), input = resolve(file), out = input.replace(/\.json$/, '-metrics.json');
if (!(grid >= 0.5 && grid <= 10)) throw new Error('Grid must be 0.5–10 metres');
const bundle = resolve(dirname(input), 'reference-metrics-bundle'); await mkdir(bundle, { recursive: true });
const entry = resolve(bundle, 'entry.ts');
await writeFile(entry, `export { measureBlueprintLandUse, measureBlueprintFrontage, clipPlanCorridors, polygonArea } from ${JSON.stringify(resolve('src/world/park/blueprint.ts').replaceAll('\\', '/'))};`);
await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: bundle, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'metrics.mjs' } } } });
const api = await import(pathToFileURL(resolve(bundle, 'metrics.mjs')).href), reference = JSON.parse(await readFile(input, 'utf8'));
// Use the principal contiguous park parcel; list excluded detached pieces rather than inventing connecting land.
const rings = [...reference.boundary].sort((a, b) => api.polygonArea(b) - api.polygonArea(a));
const footprints = [], corridors = [];
reference.features.forEach((f, source) => {
  const category = f.category === 'attraction' ? 'ride' : f.category === 'water' ? 'landscape' : f.category;
  for (const polygon of f.polygons ?? []) footprints.push({ polygon, holes: f.holes ?? [], category, source, frontage: f.frontage ?? f.category === 'building' });
  if (f.points) corridors.push({ points: f.points, width: f.width, category });
});
const boundaryHoles = reference.boundaryHoles ?? [];
const measured = api.measureBlueprintLandUse(rings[0], footprints, corridors, grid, boundaryHoles);
const publicPaths = reference.features.filter(f => f.points && f.category === 'path' && f.highway !== 'service' && !['private', 'no'].includes(f.access) && f.queue !== 'yes' && f.indoor !== 'yes')
  .map(f => ({ points: f.points, width: f.width, category: 'path' }));
// Clip the surveyed paths at the reference boundary; do not measure neighbouring hotels or city streets.
const surveyedPaths = api.clipPlanCorridors(publicPaths, rings[0], boundaryHoles);
const frontage = api.measureBlueprintFrontage(surveyedPaths, footprints, 15, 5, { outer: rings[0], holes: boundaryHoles });
const result = { name: reference.name, source: reference.source, attribution: reference.attribution, downloaded: reference.downloaded,
  ...measured, frontage, excludedDetachedParcelAreaM2: rings.slice(1).reduce((n, r) => n + api.polygonArea(r), 0),
  method: 'Same cell-centre union and distance transform as procedural blueprints. Exact mapped park boundary; footprints retain concavity and courtyard holes. Water is counted with landscaped land. Missing OSM features are unmapped, not confirmed empty. Untagged path widths are estimates. Largest empty circle means largest UNMAPPED circle for this dataset.',
  estimatedWidthLines: reference.features.filter(f => f.widthEstimated).length, totalLineFeatures: reference.features.filter(f => f.points).length,
  frontageMethod: 'Public line paths clipped to the concave main parcel and its holes; exclude explicitly private/service/queue/indoor paths. Unspecified access is treated as public. Area-only plazas are not surveyed. Only buildings and explicitly woody vegetation count as street enclosure; water, grass, flowerbeds and unclassified gardens are excluded. Perpendicular 15m edge sightlines sampled every 5m; same algorithm as generated park paths. Generated features must rise at least 1.5m above the public path datum.',
};
await writeFile(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ name: result.name, areaHa: result.metrics.studyAreaM2 / 10000, mappedCoverage: result.metrics.developedCoverage,
  buildingHa: result.metrics.buildingAreaM2 / 10000, circulationHa: result.metrics.circulationAreaM2 / 10000,
  largestUnmappedDiameterM: result.metrics.largestEmptyCircle.radius * 2, frontage, out }));
