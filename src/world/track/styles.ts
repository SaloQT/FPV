/** Per-style constraints and gate sizing. All lengths in metres, angles in radians. */
import type { GateKind, TrackData } from '../../contracts';
import type { Rng } from './rng';

export type TrackStyle = TrackData['style'];

export interface StyleSpec {
  style: TrackStyle;
  minGates: number;
  maxGates: number;
  defaultGates: number;
  /** Allowed centreline length (one lap for closed tracks). */
  minLength: number;
  maxLength: number;
  closed: boolean;
  defaultLaps: number;
  /** Generator keeps the whole path within this fraction of the map extent from the centre. */
  corridor: number;
  /** Path is lifted where it would come closer than this to the ground. */
  liftAgl: number;
}

export const STYLE_SPECS: Record<TrackStyle, StyleSpec> = {
  race: { style: 'race', minGates: 10, maxGates: 18, defaultGates: 12, minLength: 500, maxLength: 900, closed: true, defaultLaps: 3, corridor: 0.35, liftAgl: 1.2 },
  freestyle: { style: 'freestyle', minGates: 6, maxGates: 10, defaultGates: 8, minLength: 200, maxLength: 1000, closed: false, defaultLaps: 1, corridor: 0.4, liftAgl: 2.5 },
  mountain: { style: 'mountain', minGates: 15, maxGates: 25, defaultGates: 20, minLength: 1500, maxLength: 3000, closed: false, defaultLaps: 1, corridor: 0.44, liftAgl: 6 },
  sprint: { style: 'sprint', minGates: 8, maxGates: 12, defaultGates: 10, minLength: 300, maxLength: 500, closed: false, defaultLaps: 1, corridor: 0.4, liftAgl: 1.2 },
};

/** Fewest gates a track may have when the terrain forces the generator to fall back. */
export const FALLBACK_MIN_GATES = 4;
/** Hard bounds for validation and generation. */
export const MIN_GATE_SPACING = 12;
export const MIN_BOTTOM_CLEARANCE = 0.4;
export const MIN_PATH_AGL = 0.6;
/** Tightest turn radius allowed on the centreline: 6 g at 20 m/s is 6.8 m; the margin absorbs sampling error. */
export const MIN_TURN_RADIUS = 6;
export const MAX_CURVATURE = 1 / MIN_TURN_RADIUS;
export const MAX_GATE_SLOPE = (25 * Math.PI) / 180;
export const MAX_DIVE_GATE_SLOPE = (42 * Math.PI) / 180;
export const WATER_MARGIN = 1;

export interface GateSpec {
  kind: GateKind;
  width: number;
  height: number;
}

/** Clear opening of a plain square gate: 1.95 m at difficulty 0.5, 2.6 m at 0 and 1.3 m at 1. */
export function squareGateSize(difficulty: number): number {
  return 2.6 - 1.3 * difficulty;
}

/** Radius the generator tries to keep turns above; validation only enforces MIN_TURN_RADIUS. */
export function targetTurnRadius(difficulty: number): number {
  return 14 - 6.5 * difficulty;
}

export function gateSpec(kind: GateKind, difficulty: number, rng: Rng): GateSpec {
  const s = squareGateSize(difficulty) * rng.range(0.92, 1.08);
  switch (kind) {
    case 'arch': {
      const w = s * rng.range(0.95, 1.05);
      return { kind, width: w, height: w * 1.25 };
    }
    case 'hoop': {
      const d = s * 1.15;
      return { kind, width: d, height: d };
    }
    case 'dive': {
      const d = 3.6 - 0.9 * difficulty;
      return { kind, width: d, height: d };
    }
    case 'flag':
      return { kind, width: 2.7 - 1.1 * difficulty, height: 2.4 };
    case 'start':
    case 'finish':
      return { kind, width: s * 1.25, height: s };
    default:
      return { kind: 'square', width: s, height: s };
  }
}

/** Large freestyle hoop, 3 to 6 m across. */
export function bigHoopSpec(rng: Rng): GateSpec {
  const d = rng.range(3, 6);
  return { kind: 'hoop', width: d, height: d };
}

export function pickKind(style: TrackStyle, difficulty: number, rng: Rng): GateKind {
  const r = rng.next();
  switch (style) {
    case 'race': {
      const square = 0.72 - 0.1 * difficulty;
      return r < square ? 'square' : r < square + 0.16 ? 'arch' : 'hoop';
    }
    case 'sprint':
      return r < 0.55 ? 'flag' : r < 0.85 ? 'square' : 'arch';
    case 'mountain':
      return r < 0.3 ? 'square' : r < 0.65 ? 'hoop' : 'arch';
    default:
      return r < 0.3 ? 'arch' : r < 0.5 ? 'square' : 'hoop';
  }
}
