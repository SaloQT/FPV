import type { Vec3 } from '../../contracts';
import { CURVE_STRIDE } from './curve';
import { rotate, yawPoint } from './math';
import { plantingBounds, plantingCanopyFootprint } from './planting';
import type { ParkData, ParkPart, RideDefinition } from './types';

export type PlanPoint = [x: number, z: number];
export type PlanCategory = 'building' | 'landscape' | 'path' | 'ride' | 'furniture' | 'service';
export interface PlanFootprint { polygon: PlanPoint[]; holes?: PlanPoint[][]; category: PlanCategory; source: number; frontage?: boolean }
export interface PlanCorridor { points: PlanPoint[]; width: number; category: PlanCategory }
export interface PlanFrontageMetrics {
  frontageSampleMetres: number; frontageReachMetres: number; frontageSurveyedLengthM: number;
  frontageOneSideFraction: number; frontageBothSidesFraction: number;
}
export interface PlanMetrics extends PlanFrontageMetrics {
  gridMetres: number; studyAreaM2: number; hullAreaM2: number;
  engineeredAreaM2: number; landscapeAreaM2: number; developedAreaM2: number; developedCoverage: number;
  buildingAreaM2: number; circulationAreaM2: number; openAreaM2: number;
  largestOpenPatches: { areaM2: number; center: PlanPoint }[];
  largestEmptyCircle: { radius: number; center: PlanPoint };
  pathLengthM: number; meanPathWidthM: number; pathComponents: number; cycleRank: number;
  reachableStations: number; stations: number; longestEntranceWalkM: number; deadEndPublicJunctions: number;
}
export interface ParkBlueprint {
  recipe: ParkData['recipe']; layout: ParkData['layout']; hull: PlanPoint[]; footprints: PlanFootprint[];
  rails: { ride: number; points: PlanPoint[] }[]; envelopes: { ride: number; polygon: PlanPoint[] }[];
  bounds: { min: PlanPoint; max: PlanPoint }; metrics: PlanMetrics;
}
export type LandUseMetrics = Omit<PlanMetrics, keyof PlanFrontageMetrics | 'pathLengthM' | 'meanPathWidthM' | 'pathComponents' | 'cycleRank' | 'reachableStations' | 'stations' | 'longestEntranceWalkM' | 'deadEndPublicJunctions'>;

const cross2 = (a: PlanPoint, b: PlanPoint, c: PlanPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function convexHull(input: readonly PlanPoint[]): PlanPoint[] {
  const points = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (points.length < 3) return points;
  const chain = (list: PlanPoint[]) => { const out: PlanPoint[] = []; for (const p of list) { while (out.length > 1 && cross2(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } return out; };
  const a = chain(points), b = chain([...points].reverse()); a.pop(); b.pop(); return a.concat(b);
}
export function polygonArea(polygon: readonly PlanPoint[]): number {
  let area = 0; for (let i = 0; i < polygon.length; i++) { const a = polygon[i], b = polygon[(i + 1) % polygon.length]; area += a[0] * b[1] - b[0] * a[1]; } return Math.abs(area) / 2;
}
export function insidePolygon(point: PlanPoint, polygon: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (Math.abs(cross2(a, b, point)) < 1e-8 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1])) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Split at every boundary intersection; testing only the segment endpoints fails in concave parcels. */
export function clipPlanCorridors(corridors: readonly PlanCorridor[], boundary: PlanPoint[], holes: readonly PlanPoint[][] = []): PlanCorridor[] {
  const result: PlanCorridor[] = [];
  for (const corridor of corridors) for (let i = 1; i < corridor.points.length; i++) {
    const a = corridor.points[i - 1], b = corridor.points[i], dx = b[0] - a[0], dz = b[1] - a[1], cuts = [0, 1];
    if (Math.hypot(dx, dz) < 1e-8) continue;
    for (const ring of [boundary, ...holes]) for (let j = 0; j < ring.length; j++) {
      const p = ring[j], q = ring[(j + 1) % ring.length], ex = q[0] - p[0], ez = q[1] - p[1], cross = dx * ez - dz * ex;
      if (Math.abs(cross) < 1e-10) continue;
      const px = p[0] - a[0], pz = p[1] - a[1], t = (px * ez - pz * ex) / cross, u = (px * dz - pz * dx) / cross;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++) {
      const lo = cuts[j - 1], hi = cuts[j], mid = (lo + hi) / 2, p: PlanPoint = [a[0] + dx * mid, a[1] + dz * mid];
      if (hi - lo > 1e-9 && insidePolygon(p, boundary) && !holes.some(hole => insidePolygon(p, hole))) result.push({ ...corridor, points: [[a[0] + dx * lo, a[1] + dz * lo], [a[0] + dx * hi, a[1] + dz * hi]] });
    }
  }
  return result;
}

/** Orthographic X/Z footprint of the actual oriented primitive, including pitched roofs and tilted supports. */
export function partFootprint(part: ParkPart, segments = 24): PlanPoint[] {
  const vertices: PlanPoint[] = [], h = part.half;
  const add = (p: Vec3) => { const v = rotate(part.rot, p); vertices.push([v[0] + part.pos[0], v[2] + part.pos[2]]); };
  if (part.shape === 'box') for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) add([x * h[0], y * h[1], z * h[2]]);
  else if (part.shape === 'gable') for (const z of [-h[2], h[2]]) { add([-h[0], -h[1], z]); add([h[0], -h[1], z]); add([0, h[1], z]); }
  else if (part.shape === 'sphere') {
    // Projected ellipsoid support point in every plan direction; this includes arbitrary quaternion rotation.
    const axes = [rotate(part.rot, [h[0], 0, 0]), rotate(part.rot, [0, h[1], 0]), rotate(part.rot, [0, 0, h[2]])];
    const xx = axes.reduce((sum, a) => sum + a[0] * a[0], 0), zz = axes.reduce((sum, a) => sum + a[2] * a[2], 0), xz = axes.reduce((sum, a) => sum + a[0] * a[2], 0);
    for (let i = 0; i < segments; i++) { const angle = i * Math.PI * 2 / segments, x = Math.cos(angle), z = Math.sin(angle), d = Math.sqrt(xx * x * x + 2 * xz * x * z + zz * z * z); vertices.push([part.pos[0] + (xx * x + xz * z) / d, part.pos[2] + (xz * x + zz * z) / d]); }
  } else {
    for (let i = 0; i < segments; i++) { const a = i * Math.PI * 2 / segments; add([Math.cos(a) * h[0], -h[1], Math.sin(a) * h[2]]); if (part.shape === 'cylinder') add([Math.cos(a) * h[0], h[1], Math.sin(a) * h[2]]); }
    if (part.shape === 'cone') add([0, h[1], 0]);
  }
  return convexHull(vertices);
}

/** Ground ride apron is generated at radius+3; the heading arrow distinguishes oriented boarding access. */
function rideEnvelope(ride: RideDefinition): PlanPoint[] {
  return Array.from({ length: 48 }, (_, i) => { const a = i * Math.PI * 2 / 48, p = yawPoint(ride.pos, ride.yaw, [Math.cos(a) * (ride.radius + 3), 0, Math.sin(a) * (ride.radius + 3)]); return [p[0], p[2]]; });
}
function category(part: ParkPart): PlanCategory {
  if (part.category) return part.category;
  if (part.surface === 'foliage') return 'landscape';
  if (part.surface === 'masonry' || part.surface === 'glass' || part.surface === 'fabric') return 'building';
  return 'ride';
}
const categoryBit: Record<PlanCategory, number> = { path: 1, ride: 2, building: 4, furniture: 8, service: 4, landscape: 16 };

/** Length-weighted street enclosure: perpendicular sight lines from the actual path edges, never arbitrary nearby-object counts. */
export function measureBlueprintFrontage(corridors: readonly PlanCorridor[], footprints: readonly PlanFootprint[], searchMetres = 15, sampleMetres = 5, parcel?: { outer: PlanPoint[]; holes?: readonly PlanPoint[][] }): PlanFrontageMetrics {
  if (!(searchMetres > 0 && Number.isFinite(searchMetres) && sampleMetres > 0 && Number.isFinite(sampleMetres))) throw new Error('Frontage sampling distances must be positive and finite');
  const binSize = Math.max(16, searchMetres * 2), bins = new Map<string, number[]>();
  footprints.forEach((feature, id) => {
    if (feature.frontage === false || !['building', 'landscape', 'service'].includes(feature.category) || feature.polygon.length < 3) return;
    const x0 = Math.floor(Math.min(...feature.polygon.map(p => p[0])) / binSize), x1 = Math.floor(Math.max(...feature.polygon.map(p => p[0])) / binSize);
    const z0 = Math.floor(Math.min(...feature.polygon.map(p => p[1])) / binSize), z1 = Math.floor(Math.max(...feature.polygon.map(p => p[1])) / binSize);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const key = `${x},${z}`, list = bins.get(key); if (list) list.push(id); else bins.set(key, [id]); }
  });
  const enclosed = (start: PlanPoint, direction: PlanPoint) => {
    let reach = searchMetres;
    if (parcel) {
      if (!insidePolygon(start, parcel.outer) || parcel.holes?.some(hole => insidePolygon(start, hole))) return false;
      for (const ring of [parcel.outer, ...(parcel.holes ?? [])]) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], denominator = direction[0] * ez - direction[1] * ex;
        if (Math.abs(denominator) < 1e-10) continue;
        const dx = a[0] - start[0], dz = a[1] - start[1], distance = (dx * ez - dz * ex) / denominator, along = (dx * direction[1] - dz * direction[0]) / denominator;
        if (distance > 1e-8 && distance < reach && along >= 0 && along <= 1) reach = distance;
      }
    }
    const end: PlanPoint = [start[0] + direction[0] * reach, start[1] + direction[1] * reach], visited = new Set<number>();
    for (let z = Math.floor(Math.min(start[1], end[1]) / binSize); z <= Math.floor(Math.max(start[1], end[1]) / binSize); z++) {
      for (let x = Math.floor(Math.min(start[0], end[0]) / binSize); x <= Math.floor(Math.max(start[0], end[0]) / binSize); x++) {
        for (const id of bins.get(`${x},${z}`) ?? []) {
          if (visited.has(id)) continue; visited.add(id); const feature = footprints[id];
          if (insidePolygon(start, feature.polygon) && !feature.holes?.some(hole => insidePolygon(start, hole))) return true;
          for (const ring of [feature.polygon, ...(feature.holes ?? [])]) for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], denominator = direction[0] * ez - direction[1] * ex;
            if (Math.abs(denominator) < 1e-10) continue;
            const dx = a[0] - start[0], dz = a[1] - start[1], distance = (dx * ez - dz * ex) / denominator, along = (dx * direction[1] - dz * direction[0]) / denominator;
            if (distance >= 0 && distance <= reach && along >= 0 && along <= 1) return true;
          }
        }
      }
    }
    return false;
  };
  let surveyed = 0, either = 0, both = 0;
  for (const corridor of corridors) {
    if (corridor.category !== 'path') continue;
    for (let i = 1; i < corridor.points.length; i++) {
      const a = corridor.points[i - 1], b = corridor.points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (!length) continue;
      const normal: PlanPoint = [-dz / length, dx / length], count = Math.ceil(length / sampleMetres), weight = length / count;
      for (let j = 0; j < count; j++) {
        const t = (j + 0.5) / count, x = a[0] + dx * t, z = a[1] + dz * t, half = corridor.width / 2;
        const left = enclosed([x + normal[0] * half, z + normal[1] * half], normal), right = enclosed([x - normal[0] * half, z - normal[1] * half], [-normal[0], -normal[1]]);
        surveyed += weight; if (left || right) either += weight; if (left && right) both += weight;
      }
    }
  }
  return { frontageSampleMetres: sampleMetres, frontageReachMetres: searchMetres, frontageSurveyedLengthM: surveyed, frontageOneSideFraction: surveyed ? either / surveyed : 0, frontageBothSidesFraction: surveyed ? both / surveyed : 0 };
}

function circulation(park: ParkData): Pick<PlanMetrics, 'pathLengthM' | 'meanPathWidthM' | 'pathComponents' | 'cycleRank' | 'reachableStations' | 'stations' | 'longestEntranceWalkM' | 'deadEndPublicJunctions'> {
  let length = 0, weightedWidth = 0, components = 0; const n = park.nodes.length, visited = new Uint8Array(n);
  for (const path of park.paths) { const a = park.nodes[path.a].pos, b = park.nodes[path.b].pos, d = Math.hypot(a[0] - b[0], a[2] - b[2]); length += d; weightedWidth += path.width * d; }
  for (let start = 0; start < n; start++) if (!visited[start]) { components++; const todo = [start]; visited[start] = 1; while (todo.length) for (const next of park.nodes[todo.pop()!].links) if (!visited[next]) { visited[next] = 1; todo.push(next); } }
  const distances = new Float64Array(n).fill(Infinity); distances[park.entrance] = 0; visited.fill(0);
  for (let step = 0; step < n; step++) { let at = -1, nearest = Infinity; for (let i = 0; i < n; i++) if (!visited[i] && distances[i] < nearest) { nearest = distances[i]; at = i; } if (at < 0) break; visited[at] = 1;
    for (const next of park.nodes[at].links) { const a = park.nodes[at].pos, b = park.nodes[next].pos, d = nearest + Math.hypot(a[0] - b[0], a[2] - b[2]); if (d < distances[next]) distances[next] = d; }
  }
  const stations = park.rides.map(r => distances[r.station]);
  return { pathLengthM: length, meanPathWidthM: length ? weightedWidth / length : 0, pathComponents: components, cycleRank: park.paths.length - n + components,
    reachableStations: stations.filter(Number.isFinite).length, stations: stations.length, longestEntranceWalkM: Math.max(0, ...stations.filter(Number.isFinite)), deadEndPublicJunctions: park.nodes.filter(node => node.kind === 'path' && node.links.length === 1).length };
}

/** Exact squared Euclidean transform of grid cell centres (Felzenszwalb/Huttenlocher lower envelopes). */
function distanceLine(input: Float64Array, output: Float64Array, count: number, vertices: Int32Array, bounds: Float64Array): void {
  let k = 0; vertices[0] = 0; bounds[0] = -Infinity; bounds[1] = Infinity;
  for (let q = 1; q < count; q++) {
    let at = vertices[k], s = ((input[q] + q * q) - (input[at] + at * at)) / (2 * (q - at));
    while (s <= bounds[k]) { k--; at = vertices[k]; s = ((input[q] + q * q) - (input[at] + at * at)) / (2 * (q - at)); }
    vertices[++k] = q; bounds[k] = s; bounds[k + 1] = Infinity;
  }
  k = 0; for (let q = 0; q < count; q++) { while (bounds[k + 1] < q) k++; const d = q - vertices[k]; output[q] = d * d + input[vertices[k]]; }
}

export function makeParkBlueprint(park: ParkData, gridMetres = 2): ParkBlueprint {
  if (!(gridMetres >= 0.5 && gridMetres <= 10)) throw new Error('Blueprint grid must be between 0.5 and 10 metres');
  const footprints: PlanFootprint[] = [], rails: ParkBlueprint['rails'] = [], envelopes: ParkBlueprint['envelopes'] = [];
  const study: PlanPoint[] = park.nodes.map(n => [n.pos[0], n.pos[2]]);
  park.parts.forEach((part, source) => {
    if (part.body >= 0 || part.detail > 0 || !part.solid && part.surface !== 'foliage' && part.category !== 'landscape') return;
    const polygon = partFootprint(part), type = category(part);
    if (polygonArea(polygon) < 0.12) return; // Sub-pixel fasteners/sign strokes do not describe land use.
    const verticalExtent = Math.abs(rotate(part.rot, [part.half[0], 0, 0])[1]) + Math.abs(rotate(part.rot, [0, part.half[1], 0])[1]) + Math.abs(rotate(part.rot, [0, 0, part.half[2]])[1]);
    footprints.push({ polygon, category: type, source, frontage: part.pos[1] + verticalExtent >= park.nodes[park.entrance].pos[1] + 1.5 });
    if (type === 'building' || type === 'service') study.push(...polygon);
  });
  for (const [index, plant] of (park.plantings ?? []).entries()) {
    const { center, radii, yaw } = plantingCanopyFootprint(plant), { height } = plantingBounds(plant);
    const polygon: PlanPoint[] = Array.from({ length: 32 }, (_, i) => { const a = i * Math.PI * 2 / 32, p = yawPoint(center, yaw, [Math.cos(a) * radii[0], 0, Math.sin(a) * radii[1]]); return [p[0], p[2]]; });
    footprints.push({ polygon, category: 'landscape', source: park.parts.length + index, frontage: plant.pos[1] + height >= park.nodes[park.entrance].pos[1] + 1.5 });
  }
  for (const ride of park.rides) {
    if (ride.curve) { const points: PlanPoint[] = []; for (let i = 0; i < ride.curve.count; i++) points.push([ride.curve.samples[i * CURVE_STRIDE], ride.curve.samples[i * CURVE_STRIDE + 2]]); rails.push({ ride: ride.id, points }); study.push(...points); }
    else { const polygon = rideEnvelope(ride); envelopes.push({ ride: ride.id, polygon }); study.push(...polygon); }
    for (const p of [...ride.queue, ...ride.boarding, ...ride.exit]) study.push([p[0], p[2]]);
  }
  // The parcel is the actual attraction/public-realm hull plus20m; the fixed2km terrain is not a density denominator.
  const hull = convexHull(study.flatMap(([x, z]): PlanPoint[] => [[x - 20, z], [x + 20, z], [x, z - 20], [x, z + 20]]));
  const corridors: PlanCorridor[] = park.paths.map(path => ({ points: [park.nodes[path.a], park.nodes[path.b]].map(n => [n.pos[0], n.pos[2]]), width: path.width, category: 'path' }));
  const frontage = measureBlueprintFrontage(corridors, footprints, 15, 5, { outer: hull });
  for (const rail of rails) corridors.push({ points: rail.points, width: 4, category: 'ride' });
  for (const ride of park.rides) for (const path of [ride.queue, ride.boarding, ride.exit]) corridors.push({ points: path.map(p => [p[0], p[2]]), width: 1.2, category: 'path' });
  const measurement = measureBlueprintLandUse(hull, [...footprints, ...envelopes.map(e => ({ polygon: e.polygon, category: 'ride' as const, source: e.ride }))], corridors, gridMetres);
  return { recipe: park.recipe, layout: park.layout, hull, footprints, rails, envelopes, bounds: measurement.bounds, metrics: { ...measurement.metrics, ...circulation(park), ...frontage } };
}

/** Shared geometry-only measurement for generated plans and mapped reference parks. Concave rings and holes remain intact. */
export function measureBlueprintLandUse(hull: PlanPoint[], footprints: readonly PlanFootprint[], corridors: readonly PlanCorridor[], gridMetres = 2, boundaryHoles: readonly PlanPoint[][] = []): { bounds: ParkBlueprint['bounds']; metrics: LandUseMetrics } {
  if (!(gridMetres >= 0.5 && gridMetres <= 10) || hull.length < 3) throw new Error('A valid parcel and a 0.5–10m grid are required');
  const bounds = { min: [Math.min(...hull.map(p => p[0])), Math.min(...hull.map(p => p[1]))] as PlanPoint, max: [Math.max(...hull.map(p => p[0])), Math.max(...hull.map(p => p[1]))] as PlanPoint };
  const cell = gridMetres, w = Math.ceil((bounds.max[0] - bounds.min[0]) / cell) + 2, h = Math.ceil((bounds.max[1] - bounds.min[1]) / cell) + 2;
  const origin: PlanPoint = [bounds.min[0] - cell, bounds.min[1] - cell], inside = new Uint8Array(w * h), occupied = new Uint8Array(w * h);
  const center = (x: number, z: number): PlanPoint => [origin[0] + (x + 0.5) * cell, origin[1] + (z + 0.5) * cell];
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) { const p = center(x, z); if (insidePolygon(p, hull) && !boundaryHoles.some(hole => insidePolygon(p, hole))) inside[z * w + x] = 1; }
  const visitBox = (x0: number, z0: number, x1: number, z1: number, bit: number, hit: (x: number, z: number) => boolean) => {
    const loX = Math.max(0, Math.floor((x0 - origin[0]) / cell)), hiX = Math.min(w - 1, Math.floor((x1 - origin[0]) / cell));
    const loZ = Math.max(0, Math.floor((z0 - origin[1]) / cell)), hiZ = Math.min(h - 1, Math.floor((z1 - origin[1]) / cell));
    for (let z = loZ; z <= hiZ; z++) for (let x = loX; x <= hiX; x++) if (hit(origin[0] + (x + 0.5) * cell, origin[1] + (z + 0.5) * cell)) occupied[z * w + x] |= bit;
  };
  const fill = (polygon: PlanPoint[], holes: PlanPoint[][] | undefined, bit: number) => visitBox(Math.min(...polygon.map(p => p[0])), Math.min(...polygon.map(p => p[1])), Math.max(...polygon.map(p => p[0])), Math.max(...polygon.map(p => p[1])), bit, (x, z) => insidePolygon([x, z], polygon) && !holes?.some(hole => insidePolygon([x, z], hole)));
  const stroke = (a: PlanPoint, b: PlanPoint, radius: number, bit: number) => { const dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
    visitBox(Math.min(a[0], b[0]) - radius, Math.min(a[1], b[1]) - radius, Math.max(a[0], b[0]) + radius, Math.max(a[1], b[1]) + radius, bit, (x, z) => { const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (length2 || 1))); return (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2 <= radius * radius; });
  };
  for (const footprint of footprints) fill(footprint.polygon, footprint.holes, categoryBit[footprint.category]);
  for (const corridor of corridors) for (let i = 1; i < corridor.points.length; i++) stroke(corridor.points[i - 1], corridor.points[i], corridor.width / 2, categoryBit[corridor.category]);
  let studyCells = 0, engineered = 0, landscape = 0, developed = 0, buildings = 0, circulationCells = 0;
  for (let i = 0; i < inside.length; i++) if (inside[i]) { studyCells++; const bits = occupied[i]; if (bits) developed++; if (bits & 15) engineered++; if (bits & 16) landscape++; if (bits & 4) buildings++; if (bits & 1) circulationCells++; }
  const seen = new Uint8Array(inside.length), queue = new Int32Array(inside.length), patches: PlanMetrics['largestOpenPatches'] = [];
  for (let i = 0; i < inside.length; i++) if (inside[i] && !occupied[i] && !seen[i]) {
    let tail = 1, head = 0, sumX = 0, sumZ = 0; queue[0] = i; seen[i] = 1;
    while (head < tail) { const at = queue[head++], x = at % w, z = Math.floor(at / w); sumX += x; sumZ += z;
      for (const next of [x > 0 ? at - 1 : -1, x + 1 < w ? at + 1 : -1, z > 0 ? at - w : -1, z + 1 < h ? at + w : -1]) if (next >= 0 && inside[next] && !occupied[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
    }
    patches.push({ areaM2: tail * cell * cell, center: center(sumX / tail, sumZ / tail) });
  }
  patches.sort((a, b) => b.areaM2 - a.areaM2);
  const squared = new Float64Array(inside.length), span = Math.max(w, h), input = new Float64Array(span), output = new Float64Array(span), vertices = new Int32Array(span), cuts = new Float64Array(span + 1);
  for (let z = 0; z < h; z++) { for (let x = 0; x < w; x++) input[x] = inside[z * w + x] && !occupied[z * w + x] ? 1e12 : 0; distanceLine(input, output, w, vertices, cuts); squared.set(output.subarray(0, w), z * w); }
  let maxDistance = 0, maxCenter: PlanPoint = [0, 0];
  for (let x = 0; x < w; x++) { for (let z = 0; z < h; z++) input[z] = squared[z * w + x]; distanceLine(input, output, h, vertices, cuts);
    for (let z = 0; z < h; z++) if (output[z] > maxDistance) { maxDistance = output[z]; maxCenter = center(x, z); }
  }
  const area = cell * cell;
  return { bounds, metrics: { gridMetres, studyAreaM2: studyCells * area, hullAreaM2: polygonArea(hull) - boundaryHoles.reduce((sum, hole) => sum + polygonArea(hole), 0), engineeredAreaM2: engineered * area,
    landscapeAreaM2: landscape * area, developedAreaM2: developed * area, developedCoverage: developed / Math.max(1, studyCells), buildingAreaM2: buildings * area, circulationAreaM2: circulationCells * area, openAreaM2: (studyCells - developed) * area,
    largestOpenPatches: patches.slice(0, 5), largestEmptyCircle: { radius: Math.max(0, Math.sqrt(maxDistance) * cell - cell / Math.SQRT2), center: maxCenter } } };
}

const escapeXml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const colours: Record<PlanCategory, string> = { building: '#c8ac7b', service: '#ae8a96', landscape: '#789a78', path: '#dce6e8', ride: '#567b92', furniture: '#809097' };
export function renderParkBlueprint(park: ParkData, blueprint = makeParkBlueprint(park)): string {
  const { bounds, metrics: m } = blueprint, width = 1600, height = 1320, left = 48, top = 112, mapSize = 1110;
  const scale = mapSize / Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  const project = ([x, z]: PlanPoint): PlanPoint => [left + (x - bounds.min[0]) * scale, top + (z - bounds.min[1]) * scale];
  const points = (poly: PlanPoint[]) => poly.map(p => project(p).map(n => n.toFixed(2)).join(',')).join(' ');
  const line = (poly: PlanPoint[], colour: string, metres: number, extra = '') => `<polyline points="${points(poly)}" fill="none" stroke="${colour}" stroke-width="${Math.max(0.6, metres * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const text = (x: number, y: number, value: unknown, size = 15, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escapeXml(value)}</text>`;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(park.recipe.size)} procedural theme park blueprint">`,
    '<style>text{font-family:Arial,sans-serif;fill:#243d50}.label{paint-order:stroke;stroke:#fff;stroke-width:3;stroke-linejoin:round}.small{fill:#527080}</style>', '<rect width="1600" height="1320" fill="#f6f7f3"/>',
    text(48, 44, `PARK BLUEPRINT · ${park.recipe.size.toUpperCase()} / ${park.layout.toUpperCase()}`, 27, 'font-weight="700"'), text(48, 75, `Seed ${park.recipe.seed} · ${park.rides.length} operating attractions · ${park.recipe.guests.toLocaleString('en-US')} guests · world metres / north = −Z`, 16),
    `<polygon points="${points(blueprint.hull)}" fill="#e9eee3" stroke="#829791" stroke-width="1.2" stroke-dasharray="6 4"/>`];
  for (const category of ['landscape', 'ride', 'path', 'building', 'service', 'furniture'] as const) {
    const selected = blueprint.footprints.filter(f => f.category === category && polygonArea(f.polygon) * scale * scale >= (category === 'ride' ? 3 : 0.8));
    // Bounded batches avoid quadratic tessellation of one enormous self-overlapping SVG path.
    for (let start = 0; start < selected.length; start += 96) {
      const path = selected.slice(start, start + 96).map(f => `M${points(f.polygon).replaceAll(' ', 'L')}Z`).join('');
      svg.push(`<path d="${path}" fill="${colours[category]}" fill-opacity="${category === 'landscape' ? 0.82 : 0.88}"/>`);
    }
  }
  for (const path of park.paths) { const a = park.nodes[path.a].pos, b = park.nodes[path.b].pos; svg.push(line([[a[0], a[2]], [b[0], b[2]]], '#fdfdf8', path.width)); }
  for (const e of blueprint.envelopes) svg.push(`<polygon points="${points(e.polygon)}" fill="#517e9e" fill-opacity="0.17" stroke="#426d8b" stroke-width="1"/>`);
  for (const rail of blueprint.rails) svg.push(line(rail.points, '#b55645', 2.2));
  for (const ride of park.rides) {
    for (const path of [ride.queue, ride.boarding, ride.exit]) svg.push(line(path.map(p => [p[0], p[2]]), '#947450', 0.95));
    const station = park.nodes[ride.station].pos, p = project([station[0], station[2]]);
    svg.push(`<circle cx="${p[0]}" cy="${p[1]}" r="8" fill="#fff" stroke="#274d67"/>`, text(p[0], p[1] + 3.8, ride.id + 1, 10, 'text-anchor="middle" font-weight="700"'));
    if (!ride.curve) { const p = project([ride.pos[0], ride.pos[2]]), forward = yawPoint(ride.pos, ride.yaw, [0, 0, ride.radius * 0.75]), end = project([forward[0], forward[2]]); svg.push(`<path d="M${p[0]},${p[1]}L${end[0]},${end[1]}" stroke="#385b75" stroke-width="1.1"/>`); }
  }
  const empty = m.largestEmptyCircle, emptyPoint = project(empty.center);
  svg.push(`<circle cx="${emptyPoint[0]}" cy="${emptyPoint[1]}" r="${empty.radius * scale}" fill="none" stroke="#c24452" stroke-width="1.5" stroke-dasharray="5 4"/>`, text(emptyPoint[0], emptyPoint[1], `open Ø${Math.round(empty.radius * 2)}m`, 12, 'class="label" text-anchor="middle"'));
  const entrance = park.nodes[park.entrance].pos, ep = project([entrance[0], entrance[2]]); svg.push(text(ep[0], ep[1] + 24, 'ENTRANCE', 12, 'class="label" text-anchor="middle" font-weight="700"'));
  const x = 1200; let y = 125; const row = (label: string, value: string) => { svg.push(text(x, y, label, 14), text(1550, y, value, 15, 'text-anchor="end" font-weight="700"')); y += 25; };
  svg.push(text(x, y, 'LAND USE / CIRCULATION', 17, 'font-weight="700"')); y += 35;
  row('Study parcel', `${(m.studyAreaM2 / 10000).toFixed(1)} ha`); row('Developed union', `${(m.developedCoverage * 100).toFixed(1)}%`);
  row('Engineered / built', `${(100 * m.engineeredAreaM2 / m.studyAreaM2).toFixed(1)}%`); row('Landscape canopy', `${(100 * m.landscapeAreaM2 / m.studyAreaM2).toFixed(1)}%`);
  row('Building footprint', `${(m.buildingAreaM2 / 10000).toFixed(2)} ha`); row('Public paths + queues', `${(m.circulationAreaM2 / 10000).toFixed(2)} ha`);
  row('Largest open patch', `${((m.largestOpenPatches[0]?.areaM2 ?? 0) / 10000).toFixed(2)} ha`); row('Largest empty diameter', `${(empty.radius * 2).toFixed(0)} m`);
  row('Public path length', `${(m.pathLengthM / 1000).toFixed(2)} km`); row('Mean path width', `${m.meanPathWidthM.toFixed(1)} m`);
  row('Connected stations', `${m.reachableStations} / ${m.stations}`); row('Independent path loops', `${m.cycleRank}`); row('Longest entrance walk', `${Math.round(m.longestEntranceWalkM)} m`);
  row(`Frontage either side ≤${m.frontageReachMetres}m`, `${(m.frontageOneSideFraction * 100).toFixed(1)}%`); row('Frontage both sides', `${(m.frontageBothSidesFraction * 100).toFixed(1)}%`);
  y += 16; svg.push(text(x, y, 'ATTRACTIONS / STATION NUMBERS', 15, 'font-weight="700"')); y += 26;
  for (const ride of park.rides) { svg.push(text(x, y, `${ride.id + 1}. ${ride.name}`, 13)); y += 19; }
  const scaleMetres = 100, sx = 55, sy = 1250; svg.push(`<path d="M${sx},${sy - 5}v10m0,-5h${scaleMetres * scale}m0,-5v10" fill="none" stroke="#243d50" stroke-width="2"/>`, text(sx, sy + 24, '100 m', 13));
  let lx = 255; for (const [label, colour] of [['Coaster', '#b55645'], ['Building', colours.building], ['Landscape', colours.landscape], ['Public path', '#dce6e8'], ['Ride apron', colours.ride], ['Queue / exit', '#947450'], ['Service', colours.service]]) { svg.push(`<rect x="${lx}" y="${sy - 8}" width="18" height="12" fill="${colour}"/>`, text(lx + 25, sy + 3, label, 12)); lx += 130; }
  svg.push(text(255, 1276, `Enclosure proxy: building/planting ≥1.5m above paths, within ${m.frontageReachMetres}m of each edge; samples every ${m.frontageSampleMetres}m.`, 12, 'class="small"'));
  svg.push(text(48, 1300, `Coverage is a ${m.gridMetres}m cell-centre union, not summed object areas. Rail corridor=4m. Dashed parcel=hull of attractions/public realm+20m; open land may be intentional.`, 12, 'class="small"'), '</svg>');
  return svg.join('\n');
}
