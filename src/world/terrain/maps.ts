/**
 * Material maps derived from the final heightfield: drainage (flow), regolith depth (soil), sediment (deposit) and moisture
 * (wetness), plus the optional lake level. Everything is normalised to 0..1 with quantiles so seeds look alike.
 */
import { FloodWorkspace } from './flood';
import { boxBlur, quantile } from './grid';
import { accumulateFlow } from './hydrology';
import { Noise2D, clamp01, smoothstep } from './noise';

export interface MapInputs {
  height: Float32Array;
  n: number;
  cell: number;
  seed: number;
  minHeight: number;
  maxHeight: number;
  /** Net height gained by the erosion stages in metres (>= 0): droplet deposition and thermal talus. */
  gain: Float32Array;
  /** Water carried through each cell by the final droplet pass. */
  visits: Float32Array;
}

export interface TerrainMaps {
  soil: Float32Array;
  flow: Float32Array;
  deposit: Float32Array;
  wetness: Float32Array;
  waterLevel: number;
}

const CURVATURE_GAIN = 14;

/** Fraction of the whole maps stage at which each phase ends, measured on 1024^2 (flood fill and accumulation dominate). */
const PHASE = { flood: 0.3, accumulate: 0.52, flow: 0.6, slope: 0.66, soil: 0.8, water: 0.86 };

export function* computeMaps(inp: MapInputs, report: (fraction: number) => void): Generator<void, TerrainMaps> {
  const { height, n, cell, minHeight, maxHeight } = inp;
  const cells = n * n;
  const range = Math.max(maxHeight - minHeight, 1e-3);

  const ws = new FloodWorkspace(n);
  ws.begin(height);
  const floodSlice = cells >> 4;
  for (let popped = floodSlice; !ws.advance(floodSlice); popped += floodSlice) {
    report((PHASE.flood * popped) / cells);
    yield;
  }
  report(PHASE.flood);
  yield;

  const area = new Float32Array(cells);
  yield* accumulateFlow(ws, area, (f) => report(PHASE.flood + (PHASE.accumulate - PHASE.flood) * f));

  const tmp = new Float32Array(cells);
  const flow = buildFlow(area, inp.visits, n, tmp);
  const deposit = buildDeposit(inp.gain, n, tmp);
  report(PHASE.flow);
  yield;

  const hs = ws.filled;
  hs.set(height);
  boxBlur(hs, n, 1, tmp);
  const slope = new Float32Array(cells);
  const curv = new Float32Array(cells);
  slopeAndCurvature(hs, n, cell, slope, curv);
  report(PHASE.slope);
  yield;

  const soil = yield* buildSoil(hs, slope, curv, deposit, n, cell, inp.seed, minHeight, range, (f) =>
    report(PHASE.slope + (PHASE.soil - PHASE.slope) * f),
  );

  const waterLevel = pickWaterLevel(height, n, minHeight, maxHeight);
  report(PHASE.water);
  yield;
  const wetness = yield* buildWetness(area, slope, flow, hs, n, cell, minHeight, range, waterLevel, tmp, (f) =>
    report(PHASE.water + (1 - PHASE.water) * f),
  );
  report(1);
  return { soil, flow, deposit, wetness, waterLevel };
}

function buildFlow(area: Float32Array, visits: Float32Array, n: number, tmp: Float32Array): Float32Array {
  const cells = n * n;
  let maxArea = 1;
  for (let i = 0; i < cells; i++) if (area[i] > maxArea) maxArea = area[i];
  const invLogArea = 1 / Math.log(1 + maxArea);

  boxBlur(visits, n, 1, tmp);
  const visitCap = Math.max(quantile(visits, 0.999), 1e-6);
  const invLogVisit = 1 / Math.log(1 + visitCap);

  const flow = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    const network = smoothstep(0.2, 0.8, Math.log(1 + area[i]) * invLogArea);
    const droplets = clamp01(Math.log(1 + visits[i]) * invLogVisit);
    flow[i] = clamp01(0.75 * network + 0.25 * droplets);
  }
  return flow;
}

function buildDeposit(gain: Float32Array, n: number, tmp: Float32Array): Float32Array {
  const cells = n * n;
  const deposit = new Float32Array(cells);
  const cap = quantile(gain, 0.995);
  if (!(cap > 1e-6)) return deposit;
  const inv = 1 / cap;
  for (let i = 0; i < cells; i++) deposit[i] = clamp01(gain[i] * inv);
  boxBlur(deposit, n, 1, tmp);
  return deposit;
}

/** Central-difference slope (tan of the angle) and a two-cell-stencil Laplacian curvature (>0 concave) in 1/m. */
function slopeAndCurvature(hs: Float32Array, n: number, cell: number, slope: Float32Array, curv: Float32Array): void {
  const last = n - 1;
  const lapScale = 1 / (4 * cell * cell);
  for (let j = 0; j < n; j++) {
    const j0 = j > 0 ? j - 1 : 0;
    const j1 = j < last ? j + 1 : last;
    const jm = j > 1 ? j - 2 : 0;
    const jp = j < last - 1 ? j + 2 : last;
    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : 0;
      const i1 = i < last ? i + 1 : last;
      const im = i > 1 ? i - 2 : 0;
      const ip = i < last - 1 ? i + 2 : last;
      const id = j * n + i;
      const gx = (hs[j * n + i1] - hs[j * n + i0]) / ((i1 - i0) * cell);
      const gz = (hs[j1 * n + i] - hs[j0 * n + i]) / ((j1 - j0) * cell);
      slope[id] = Math.sqrt(gx * gx + gz * gz);
      curv[id] = (hs[j * n + im] + hs[j * n + ip] + hs[jm * n + i] + hs[jp * n + i] - 4 * hs[id]) * lapScale;
    }
  }
}

function* buildSoil(
  hs: Float32Array,
  slope: Float32Array,
  curv: Float32Array,
  deposit: Float32Array,
  n: number,
  cell: number,
  seed: number,
  minHeight: number,
  range: number,
  report: (fraction: number) => void,
): Generator<void, Float32Array> {
  const noise = new Noise2D(seed, 11);
  const origin = -(n * cell) / 2;
  const invRange = 1 / range;
  const soil = new Float32Array(n * n);
  const sliceMask = (n >> 3) - 1;
  for (let j = 0; j < n; j++) {
    if (j > 0 && (j & sliceMask) === 0) {
      report(j / n);
      yield;
    }
    const z = origin + j * cell;
    for (let i = 0; i < n; i++) {
      const id = j * n + i;
      const x = origin + i * cell;
      const rock = smoothstep(0.25, 0.85, slope[id]);
      const alt = smoothstep(0.62, 1.0, (hs[id] - minHeight) * invRange);
      const cv = Math.max(-1, Math.min(1, curv[id] * CURVATURE_GAIN));
      const patch = 0.6 * noise.simplex(x / 60, z / 60) + 0.4 * noise.simplex(x / 17 + 31.7, z / 17 - 12.3);
      soil[id] = clamp01((1 - rock) * (1 - 0.6 * alt) + 0.28 * cv + 0.45 * deposit[id] + 0.14 * patch);
    }
  }
  return soil;
}

/** Topographic wetness index ln(a / tan(slope)) blended with drainage and low altitude, blurred, plus lake shores. */
function* buildWetness(
  area: Float32Array,
  slope: Float32Array,
  flow: Float32Array,
  hs: Float32Array,
  n: number,
  cell: number,
  minHeight: number,
  range: number,
  waterLevel: number,
  tmp: Float32Array,
  report: (fraction: number) => void,
): Generator<void, Float32Array> {
  const cells = n * n;
  const twi = tmp;
  for (let i = 0; i < cells; i++) twi[i] = Math.log((area[i] * cell) / Math.max(slope[i], 0.02));
  report(0.4);
  yield;
  const lo = quantile(twi, 0.05);
  const hi = quantile(twi, 0.995);
  const inv = 1 / Math.max(hi - lo, 1e-6);
  const invRange = 1 / range;
  const wet = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    wet[i] = 0.55 * clamp01((twi[i] - lo) * inv) + 0.3 * flow[i] + 0.15 * (1 - clamp01((hs[i] - minHeight) * invRange));
  }
  report(0.7);
  yield;
  boxBlur(wet, n, 2, tmp);
  if (waterLevel > -Infinity) {
    for (let i = 0; i < cells; i++) wet[i] = Math.max(wet[i], 1 - smoothstep(0, 4, hs[i] - waterLevel));
  }
  for (let i = 0; i < cells; i++) wet[i] = clamp01(wet[i]);
  return wet;
}

/**
 * A lake at minHeight + 6% of the range, only when it covers a meaningful part of the map and the flyable centre stays dry.
 * The map edge is a fixed base level, so the water is confined to the low outlet region.
 */
export function pickWaterLevel(height: Float32Array, n: number, minHeight: number, maxHeight: number): number {
  const level = minHeight + 0.06 * (maxHeight - minHeight);
  const half = n / 2;
  const keepDry = (0.2 * n) * (0.2 * n);
  let below = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (height[j * n + i] >= level) continue;
      const dx = i - half;
      const dz = j - half;
      if (dx * dx + dz * dz < keepDry) return -Infinity;
      below++;
    }
  }
  const fraction = below / (n * n);
  return fraction >= 0.004 && fraction <= 0.2 ? level : -Infinity;
}
