/**
 * Terrain pipeline, coarse to fine: domain-warped ridged macro shape -> stream-power valley networks (coarse grids) ->
 * repeated 2x refinement with roughness -> droplet erosion -> thermal talus + soil creep -> normalisation -> material maps.
 *
 * Heights leave the pipeline linearly rescaled so that maxHeight - minHeight === relief and minHeight === 0 (the datum is the
 * lowest point of the map; callers add the geographic altitude themselves).
 */
import type { ProgressFn, TerrainData, TerrainParams, TerrainQuality } from '../../contracts';
import { addDetail, erodibilityGrid, hardnessGrid, talusGrid, upliftGrid } from './detail';
import { erodeDroplets, type DropletParams } from './erosion';
import { minMax, relaxBorder, upsample2x } from './grid';
import { computeMaps } from './maps';
import { Rng } from './noise';
import { ProgressTracker } from './progress';
import { createShape, fillMacroHeight, type TerrainShape } from './shape';
import { streamPowerErode } from './stream';
import { creepSmooth, thermalErode } from './thermal';
import { TUNING } from './tuning';

export interface TerrainDefaults {
  resolution: number;
  cellSize: number;
  relief: number;
}

const DEFAULTS: Record<TerrainQuality, TerrainDefaults> = {
  low: { resolution: 512, cellSize: 4, relief: 220 },
  medium: { resolution: 1024, cellSize: 3, relief: 220 },
  high: { resolution: 2048, cellSize: 2, relief: 220 },
  ultra: { resolution: 2048, cellSize: 1.5, relief: 220 },
};

export function terrainDefaults(quality: TerrainQuality): TerrainDefaults {
  return { ...DEFAULTS[quality] };
}

function resolveParams(params: TerrainParams): TerrainDefaults & { seed: number } {
  const d = DEFAULTS[params.quality];
  const resolution = params.resolution ?? d.resolution;
  const cellSize = params.cellSize ?? d.cellSize;
  const relief = params.relief ?? d.relief;
  if (!Number.isInteger(resolution) || resolution < TUNING.coarseMin || (resolution & (resolution - 1)) !== 0) {
    throw new RangeError(`terrain resolution must be a power of two >= ${TUNING.coarseMin}, got ${resolution}`);
  }
  if (!(cellSize > 0) || !(relief > 0)) throw new RangeError('terrain cellSize and relief must be positive');
  return { resolution, cellSize, relief, seed: params.seed };
}

function levelSizes(resolution: number): number[] {
  const first = Math.min(resolution, Math.max(TUNING.coarseMin, Math.min(TUNING.coarseMax, resolution / 4)));
  const sizes: number[] = [];
  for (let n = first; n <= resolution; n *= 2) sizes.push(n);
  return sizes;
}

type StepKind = 'macro' | 'refine' | 'fluvial' | 'droplets' | 'thermal' | 'finish' | 'maps';

interface Step {
  kind: StepKind;
  level: number;
  label: string;
  cost: number;
}

/** Approximate nanoseconds per cell (or per cell iteration / droplet step) of each step in Node; only used to weight progress. */
const COST = { macro: 1100, refine: 170, fluvialIter: 210, dropletStep: 90, thermalIter: 28, creepIter: 30, finish: 10, maps: 780 };

function planSteps(sizes: readonly number[]): Step[] {
  const steps: Step[] = [];
  const last = sizes.length - 1;
  for (let level = 0; level <= last; level++) {
    const cells = sizes[level] * sizes[level];
    if (level === 0) steps.push({ kind: 'macro', level, label: 'Shaping terrain', cost: cells * COST.macro });
    else steps.push({ kind: 'refine', level, label: 'Refining terrain', cost: cells * COST.refine });
    const iterations = TUNING.spl.iterations[level] ?? 0;
    if (iterations > 0) steps.push({ kind: 'fluvial', level, label: 'Carving valleys', cost: iterations * cells * COST.fluvialIter });
    const perCell = TUNING.droplets.perCell[last - level] ?? 0;
    if (perCell > 0) {
      const lifetime = TUNING.droplets.lifetime[last - level];
      steps.push({ kind: 'droplets', level, label: 'Eroding slopes', cost: perCell * cells * lifetime * COST.dropletStep });
    }
  }
  const cells = sizes[last] * sizes[last];
  steps.push({
    kind: 'thermal',
    level: last,
    label: 'Settling talus',
    cost: cells * (TUNING.thermal.iterations * COST.thermalIter + TUNING.creep.iterations * COST.creepIter),
  });
  steps.push({ kind: 'finish', level: last, label: 'Normalising', cost: cells * COST.finish });
  steps.push({ kind: 'maps', level: last, label: 'Mapping materials', cost: cells * COST.maps });
  return steps;
}

interface State {
  n: number;
  cell: number;
  h: Float32Array;
  hard: Float32Array;
  uplift: Float32Array;
  /** Net height gained by droplet deposition and talus, accumulated across levels. */
  gain: Float32Array;
  /** Snapshot of `h` at the last gain checkpoint. */
  base: Float32Array;
  visits: Float32Array | null;
}

function checkpointGain(st: State, count: boolean): void {
  const { h, base, gain } = st;
  if (count) {
    for (let k = 0; k < h.length; k++) {
      const d = h[k] - base[k];
      if (d > 0) gain[k] += d;
    }
  }
  base.set(h);
}

function scaleHeights(h: Float32Array, factor: number): void {
  for (let k = 0; k < h.length; k++) h[k] *= factor;
}

/**
 * Resumable generation: every `yield` is a safe point to hand control back to an event loop. The returned TerrainData owns
 * its arrays. Deterministic for a given (params, source revision).
 */
export function* terrainSteps(params: TerrainParams, onProgress?: ProgressFn): Generator<void, TerrainData> {
  const cfg = resolveParams(params);
  const extent = cfg.resolution * cfg.cellSize;
  const sizes = levelSizes(cfg.resolution);
  const steps = planSteps(sizes);
  const tracker = new ProgressTracker(
    onProgress,
    steps.map((s) => s.cost),
  );
  const shape = createShape(cfg.seed, extent, cfg.relief);
  const st: State = {
    n: 0,
    cell: 0,
    h: new Float32Array(0),
    hard: new Float32Array(0),
    uplift: new Float32Array(0),
    gain: new Float32Array(0),
    base: new Float32Array(0),
    visits: null,
  };
  let waterLevel = -Infinity;
  const none = new Float32Array(0);
  let maps: TerrainData['maps'] = { soil: none, flow: none, deposit: none, wetness: none };

  for (const step of steps) {
    const progress = tracker.step(step.label, step.cost);
    progress.report(0);
    switch (step.kind) {
      case 'macro':
        buildMacro(st, shape, extent, sizes[0], cfg.relief);
        break;
      case 'refine':
        yield* refine(st, shape, progress.report);
        break;
      case 'fluvial':
        yield* streamPowerErode(
          st.h,
          st.n,
          st.uplift,
          erodibilityGrid(st.hard, TUNING.spl.softErodibility, TUNING.spl.hardErodibility),
          {
            iterations: TUNING.spl.iterations[step.level],
            k: TUNING.spl.k,
            diffusion: TUNING.spl.diffusion,
            edgeDrop: TUNING.spl.edgeSlope * st.cell,
          },
          progress.report,
        );
        break;
      case 'droplets':
        yield* dropletPass(st, cfg.seed, step.level, sizes.length - 1 - step.level, progress.report);
        break;
      case 'thermal':
        yield* settle(st, cfg.relief, progress.report);
        break;
      case 'finish':
        normalise(st, cfg.relief);
        break;
      case 'maps': {
        const [minHeight, maxHeight] = minMax(st.h);
        const result = yield* computeMaps(
          {
            height: st.h,
            n: st.n,
            cell: st.cell,
            seed: cfg.seed,
            minHeight,
            maxHeight,
            gain: st.gain,
            visits: st.visits ?? new Float32Array(st.n * st.n),
          },
          progress.report,
        );
        maps = { soil: result.soil, flow: result.flow, deposit: result.deposit, wetness: result.wetness };
        waterLevel = result.waterLevel;
        break;
      }
    }
    progress.finish();
    yield;
  }
  tracker.complete('Done');

  const [minHeight, maxHeight] = minMax(st.h);
  const half = -(st.n * st.cell) / 2;
  return {
    seed: cfg.seed,
    resolution: st.n,
    cellSize: st.cell,
    origin: [half, half],
    height: st.h,
    maps,
    minHeight,
    maxHeight,
    waterLevel,
  };
}

function buildMacro(st: State, shape: TerrainShape, extent: number, n: number, relief: number): void {
  st.n = n;
  st.cell = extent / n;
  st.h = new Float32Array(n * n);
  fillMacroHeight(st.h, n, st.cell, shape, 4 * st.cell);
  st.hard = hardnessGrid(n, st.cell, shape);
  st.uplift = upliftGrid(st.h, relief, TUNING.spl.uplift, TUNING.spl.upliftFloor);
  st.gain = new Float32Array(n * n);
  st.base = new Float32Array(n * n);
}

function* refine(st: State, shape: TerrainShape, report: (f: number) => void): Generator<void> {
  const n = st.n;
  st.h = upsample2x(st.h, n);
  report(0.08);
  yield;
  st.hard = upsample2x(st.hard, n);
  st.uplift = upsample2x(st.uplift, n);
  report(0.16);
  yield;
  st.gain = upsample2x(st.gain, n);
  st.n = n * 2;
  st.cell /= 2;
  st.base = new Float32Array(st.n * st.n);
  report(0.24);
  yield;
  yield* addDetail(st.h, st.n, st.cell, shape, TUNING.detailSlopeGain, (f) => report(0.24 + 0.76 * f));
}

/** Droplets work in cell units (height / cell) so their behaviour is identical on every grid resolution. */
function* dropletPass(st: State, seed: number, level: number, fromFinest: number, report: (f: number) => void): Generator<void> {
  const d = TUNING.droplets;
  const cells = st.n * st.n;
  const params: DropletParams = {
    droplets: Math.round(d.perCell[fromFinest] * cells),
    lifetime: d.lifetime[fromFinest],
    inertia: d.inertia,
    capacity: d.capacity,
    minSlope: d.minSlope,
    erodeSpeed: d.erodeSpeed,
    depositSpeed: d.depositSpeed,
    evaporation: d.evaporation,
    gravity: d.gravity,
    radius: d.radius,
  };
  if (fromFinest === 0) st.visits = new Float32Array(cells);
  st.base.set(st.h);
  scaleHeights(st.h, 1 / st.cell);
  yield* erodeDroplets(st.h, st.n, params, new Rng(seed, 100 + level), st.visits, report);
  scaleHeights(st.h, st.cell);
  checkpointGain(st, true);
}

function* settle(st: State, relief: number, report: (f: number) => void): Generator<void> {
  // Repose angles are only real angles once heights are in final metres (raw stream-power heights end up ~3x taller).
  const [lo, hi] = minMax(st.h);
  const to = hi > lo ? relief / (hi - lo) : 1;
  scaleHeights(st.h, to);
  scaleHeights(st.base, to);
  scaleHeights(st.gain, to);
  const t = TUNING.thermal;
  const talus = talusGrid(st.hard, t.soilTan, t.rockTan);
  yield* thermalErode(st.h, st.n, st.cell, talus, t.soilTan, t.iterations, t.rate, (f) => report(f * 0.75));
  // Thermal relaxation only ever feeds the outer ring, which would otherwise end up a cliff around the map.
  relaxBorder(st.h, st.n);
  checkpointGain(st, true);
  const c = TUNING.creep;
  yield* creepSmooth(st.h, st.n, st.cell, null, c.flatTan, c.strength, c.iterations, (f) => report(0.75 + f * 0.25));
  relaxBorder(st.h, st.n);
  checkpointGain(st, false);
}

function normalise(st: State, relief: number): void {
  const [lo, hi] = minMax(st.h);
  const scale = hi > lo ? relief / (hi - lo) : 1;
  const h = st.h;
  for (let k = 0; k < h.length; k++) h[k] = (h[k] - lo) * scale;
}

export function generateTerrain(params: TerrainParams, onProgress?: ProgressFn): TerrainData {
  const gen = terrainSteps(params, onProgress);
  for (;;) {
    const r = gen.next();
    if (r.done === true) return r.value;
  }
}
