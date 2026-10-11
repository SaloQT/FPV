import { describe, expect, it } from 'vitest';
import { testTerrainData } from '../track/testTerrain';
import { createTerrainSampler } from '../terrain/sampler';
import { axisAngle } from './math';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';
import { clipPlanCorridors, convexHull, insidePolygon, makeParkBlueprint, measureBlueprintFrontage, measureBlueprintLandUse, partFootprint, polygonArea, renderParkBlueprint, type PlanCorridor, type PlanPoint } from './blueprint';
import { plantingCanopyFootprint } from './planting';
import type { ParkPart } from './types';

const artifactFs = (globalThis as unknown as { process: { getBuiltinModule(name: 'node:fs'): {
  mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void;
} } }).process.getBuiltinModule('node:fs');

const rectangle = (x0: number, z0: number, x1: number, z1: number): PlanPoint[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const box: ParkPart = { shape: 'box', pos: [10, 12, 20], half: [2, 3, 4], rot: axisAngle([0, 1, 0], Math.PI / 2), color: [0.5, 0.5, 0.5], roughness: 0.8, metalness: 0, emissive: 0, solid: true, detail: 0, body: -1, category: 'building' };

describe('programmatic park plan geometry and land-use measurements', () => {
  it('projects an oriented physical box without replacing it by an unrotated footprint', () => {
    const footprint = partFootprint(box);
    expect(polygonArea(footprint)).toBeCloseTo(32, 8);
    expect(Math.min(...footprint.map(p => p[0]))).toBeCloseTo(6); expect(Math.max(...footprint.map(p => p[0]))).toBeCloseTo(14);
    expect(Math.min(...footprint.map(p => p[1]))).toBeCloseTo(18); expect(Math.max(...footprint.map(p => p[1]))).toBeCloseTo(22);
    expect(insidePolygon([10, 20], footprint)).toBe(true); expect(insidePolygon([10, 24], footprint)).toBe(false);
  });
  it('includes vertical extent when an ellipsoid is tilted into the plan projection', () => {
    const part: ParkPart = { ...box, shape: 'sphere', rot: axisAngle([1, 0, 0], Math.PI / 2) };
    const footprint = partFootprint(part, 48), expected = Math.PI * part.half[0] * part.half[1];
    expect(Math.abs(polygonArea(footprint) - expected) / expected).toBeLessThan(0.005);
    expect(Math.max(...footprint.map(p => p[1]))).toBeCloseTo(23, 7);
  });
  it('preserves concave parcels, courtyard holes and overlap unions for fair reference comparisons', () => {
    const parcel: PlanPoint[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], polygon = rectangle(0, 0, 4, 4), holes = [rectangle(1, 1, 3, 3)];
    expect(insidePolygon([8, 8], parcel)).toBe(false); expect(insidePolygon([2, 8], parcel)).toBe(true);
    const { metrics } = measureBlueprintLandUse(parcel, [
      { polygon, holes, category: 'building', source: 0 }, { polygon, holes, category: 'building', source: 1 }, { polygon, holes, category: 'landscape', source: 2 },
    ], [], 1);
    expect(metrics.studyAreaM2).toBe(64); expect(metrics.buildingAreaM2).toBe(12); expect(metrics.landscapeAreaM2).toBe(12);
    expect(metrics.developedAreaM2).toBe(12); expect(metrics.engineeredAreaM2).toBe(12); expect(metrics.openAreaM2).toBe(52);
    expect(measureBlueprintLandUse(parcel, [], [], 1, [rectangle(1, 1, 3, 3)]).metrics.studyAreaM2).toBe(60);
  });
  it('measures circulation as an actual-width corridor and identifies the resulting empty districts', () => {
    const { metrics } = measureBlueprintLandUse(rectangle(0, 0, 20, 20), [], [{ points: [[10, 0], [10, 20]], width: 2, category: 'path' }], 1);
    expect(metrics.circulationAreaM2).toBe(40); expect(metrics.largestOpenPatches.map(p => p.areaM2)).toEqual([180, 180]);
    expect(metrics.largestEmptyCircle.radius).toBeGreaterThan(4); expect(metrics.largestEmptyCircle.radius).toBeLessThanOrEqual(4.5);
    expect(insidePolygon(metrics.largestEmptyCircle.center, rectangle(0, 0, 20, 20))).toBe(true);
  });
  it('measures real street frontage on each side, excluding nearby objects beyond sight lines or the search distance', () => {
    const corridors = [{ points: [[0, 0], [100, 0]] as PlanPoint[], width: 10, category: 'path' as const }];
    const footprints = [rectangle(0, 10, 40, 14), rectangle(20, -14, 60, -10), rectangle(0, 25.1, 100, 29), rectangle(101, -20, 104, 20)].map((polygon, source) => ({ polygon, source, category: 'building' as const }));
    const result = measureBlueprintFrontage(corridors, footprints);
    expect(result.frontageSurveyedLengthM).toBe(100); expect(result.frontageOneSideFraction).toBeCloseTo(0.6); expect(result.frontageBothSidesFraction).toBeCloseTo(0.2);
    const longer = measureBlueprintFrontage([...corridors, { points: [[0, 100], [100, 100]], width: 10, category: 'path' }], footprints);
    expect(longer.frontageOneSideFraction).toBeCloseTo(0.3); expect(longer.frontageBothSidesFraction).toBeCloseTo(0.1);
  });
  it('starts frontage sight lines at the true path edge and respects courtyard holes', () => {
    const paths = [{ points: [[-5, 0], [5, 0]] as PlanPoint[], width: 2, category: 'path' as const }];
    const building = [{ polygon: rectangle(-10, -10, 10, 10), holes: [rectangle(-8, -8, 8, 8)], category: 'building' as const, source: 0 }];
    expect(measureBlueprintFrontage(paths, building, 6).frontageOneSideFraction).toBe(0);
    expect(measureBlueprintFrontage(paths, building, 7).frontageBothSidesFraction).toBe(1);
    expect(measureBlueprintFrontage(paths, building.map(f => ({ ...f, frontage: false })), 7).frontageBothSidesFraction).toBe(0);
  });
  it('clips paths through concave parcel notches and excluded holes without discarding their valid parts', () => {
    const parcel: PlanPoint[] = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
    const path = { points: [[-2, 5], [12, 5]] as PlanPoint[], width: 2, category: 'path' as const };
    expect(clipPlanCorridors([path], parcel).map(p => p.points)).toEqual([[[0, 5], [3, 5]], [[7, 5], [10, 5]]]);
    const throughHole = { ...path, points: [[1, 5], [9, 5]] as PlanPoint[] };
    expect(clipPlanCorridors([throughHole], rectangle(0, 0, 10, 10), [rectangle(4, 4, 6, 6)]).map(p => p.points)).toEqual([[[1, 5], [4, 5]], [[6, 5], [9, 5]]]);
  });
  it('does not credit neighbouring buildings beyond the reference park boundary', () => {
    const paths = [{ points: [[2, 7], [8, 7]] as PlanPoint[], width: 2, category: 'path' as const }];
    const features = [{ polygon: rectangle(0, 11, 10, 15), category: 'building' as const, source: 0 }];
    expect(measureBlueprintFrontage(paths, features).frontageOneSideFraction).toBe(1);
    expect(measureBlueprintFrontage(paths, features, 15, 5, { outer: rectangle(0, 0, 10, 10) }).frontageOneSideFraction).toBe(0);
  });
  it('produces a reviewable seeded blueprint and verifies real attraction/path integration', async () => {
    const recipe = { ...defaultParkRecipe(1337, 'compact'), guests: 0 }, terrain = gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe);
    const park = generatePark(recipe, createTerrainSampler(terrain)), plan = makeParkBlueprint(park, 2), svg = renderParkBlueprint(park, plan);
    expect(plan.rails.length).toBe(park.rides.filter(r => r.curve).length); expect(plan.envelopes.length).toBe(park.rides.filter(r => !r.curve).length);
    expect(plan.metrics.reachableStations).toBe(park.rides.length); expect(plan.metrics.pathComponents).toBe(1);
    expect(plan.metrics.developedAreaM2 + plan.metrics.openAreaM2).toBe(plan.metrics.studyAreaM2);
    expect(Math.abs(plan.metrics.studyAreaM2 - plan.metrics.hullAreaM2) / plan.metrics.hullAreaM2).toBeLessThan(0.002);
    expect(plan.metrics.developedAreaM2).toBeGreaterThanOrEqual(Math.max(plan.metrics.engineeredAreaM2, plan.metrics.landscapeAreaM2));
    expect(svg).toContain('100 m'); expect(svg).toContain('PARK BLUEPRINT'); expect(svg).not.toMatch(/NaN|Infinity/);
    for (const footprint of plan.footprints) expect(polygonArea(convexHull(footprint.polygon))).toBeGreaterThan(0);
    const out = '.bench/park-blueprints'; artifactFs.mkdirSync(out, { recursive: true });
    artifactFs.writeFileSync(`${out}/test-compact-1337.svg`, svg); artifactFs.writeFileSync(`${out}/test-compact-1337.json`, JSON.stringify(plan.metrics, null, 2));
    // Engine foliage has no rasterized ellipsoid crown parts; metadata must still contribute its mature canopy.
    const plant = { pos: [0, 12, 0] as [number, number, number], yaw: 0.4, variant: 0, scale: 0.75, tint: [1, 1, 1] as [number, number, number] };
    (park.plantings ??= []).push(plant);
    const canopy = makeParkBlueprint(park, 2).footprints.find(f => f.source === park.parts.length + park.plantings!.length - 1)!;
    const bounds = plantingCanopyFootprint(plant);
    expect(canopy.category).toBe('landscape'); expect(Math.abs(polygonArea(canopy.polygon) / (Math.PI * bounds.radii[0] * bounds.radii[1]) - 1)).toBeLessThan(0.01);
    expect(canopy.polygon.reduce((sum, p) => sum + p[0], 0) / canopy.polygon.length).toBeCloseTo(bounds.center[0]);
  }, 30000);
  it.each([{ seed: 1337, size: 'compact' as const }, { seed: 4201, size: 'destination' as const }, { seed: 1337, size: 'mega' as const }])('preserves occupied districts and actual street architecture in $size seed $seed', ({ seed, size }) => {
    const recipe = { ...defaultParkRecipe(seed, size), guests: 0 }, terrain = gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe);
    const park = generatePark(recipe, createTerrainSampler(terrain)), plan = makeParkBlueprint(park, 2), m = plan.metrics;
    const paths: PlanCorridor[] = park.paths.map(path => ({ points: [park.nodes[path.a], park.nodes[path.b]].map(n => [n.pos[0], n.pos[2]]), width: path.width, category: 'path' }));
    const architecture = measureBlueprintFrontage(paths, plan.footprints.filter(f => f.category === 'building'), 15, 5, { outer: plan.hull });
    // Broad regression floors retain the spatial pass without prescribing a real park's density or
    // treating maximum enclosure as desirable. Trees alone cannot satisfy architectural frontage.
    expect(m.pathComponents).toBe(1); expect(m.reachableStations).toBe(park.rides.length);
    expect(m.developedCoverage).toBeGreaterThan(0.22);
    expect(m.engineeredAreaM2 / m.studyAreaM2).toBeGreaterThan(0.12);
    expect(m.landscapeAreaM2 / m.studyAreaM2).toBeGreaterThan(0.04);
    expect(architecture.frontageOneSideFraction).toBeGreaterThan(0.15);
  }, 30000);
});
