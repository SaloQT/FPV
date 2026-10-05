/** Per-style constraints and gate sizing. All lengths in metres, angles in radians. */
import type { GateKind, GeneratedStyle, TrackData } from '../../contracts';
import { DROP_DIAMETER, HURDLE_HEIGHT, HURDLE_WIDTH, TUNNEL_MIN_SIZE } from './kindGeometry';
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
  /**
   * Tracks built from manoeuvres (TrackFeature): the new styles and custom recipes. Their validation knows feature zones (tighter
   * turns inside a split-S or ladder, path stretches stacked above each other), the new gate kinds' pitch rules and checks the
   * whole path against every gate frame. Left out for the original four, whose rules and tracks stay exactly as they were.
   */
  features?: boolean;
}

export const STYLE_SPECS: Record<GeneratedStyle, StyleSpec> = {
  race: { style: 'race', minGates: 10, maxGates: 18, defaultGates: 12, minLength: 500, maxLength: 900, closed: true, defaultLaps: 3, corridor: 0.35, liftAgl: 1.2 },
  freestyle: { style: 'freestyle', minGates: 6, maxGates: 10, defaultGates: 8, minLength: 200, maxLength: 1000, closed: false, defaultLaps: 1, corridor: 0.4, liftAgl: 2.5 },
  mountain: { style: 'mountain', minGates: 15, maxGates: 25, defaultGates: 20, minLength: 1500, maxLength: 3000, closed: false, defaultLaps: 1, corridor: 0.44, liftAgl: 6 },
  sprint: { style: 'sprint', minGates: 8, maxGates: 12, defaultGates: 10, minLength: 300, maxLength: 500, closed: false, defaultLaps: 1, corridor: 0.4, liftAgl: 1.2 },
  technical: { style: 'technical', minGates: 10, maxGates: 24, defaultGates: 16, minLength: 350, maxLength: 1400, closed: true, defaultLaps: 3, corridor: 0.35, liftAgl: 1.1, features: true },
  acro: { style: 'acro', minGates: 6, maxGates: 18, defaultGates: 10, minLength: 300, maxLength: 1800, closed: false, defaultLaps: 1, corridor: 0.4, liftAgl: 2, features: true },
  industrial: { style: 'industrial', minGates: 10, maxGates: 22, defaultGates: 14, minLength: 450, maxLength: 1600, closed: true, defaultLaps: 3, corridor: 0.36, liftAgl: 1.1, features: true },
};

/** True for the styles built from manoeuvres (StyleSpec.features): technical, acro, industrial and custom. */
export function hasFeatures(style: TrackStyle): boolean {
  return style === 'custom' || STYLE_SPECS[style].features === true;
}

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

/** Feature tracks only (StyleSpec.features). Gates of one manoeuvre may stand this close (3D), e.g. a split-S pair. */
export const FEATURE_GATE_SPACING = 5;
/** Tightest radius any manoeuvre may use inside its own zone (each feature has its own minimum, never below this). */
export const MIN_FEATURE_TURN_RADIUS = 3.5;
/** Path stretches far apart along the path may overlap horizontally when they are at least this far apart vertically. */
export const VERTICAL_SEPARATION = 4;
/** Inside a manoeuvre's zone (a loop, a ladder) far-apart stretches only need this much 3D distance. */
export const FEATURE_SEPARATION = 4;

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
    case 'window':
      return { kind, width: Math.min(Math.max(s * 1.15, 1.6), 2.8), height: Math.min(Math.max(s * 0.95, 1.4), 2.4) };
    case 'ladder':
      return { kind, width: s, height: s * 0.85 };
    case 'tunnel': {
      const t = Math.max(TUNNEL_MIN_SIZE, (2.6 + 0.8 * (1 - difficulty)) * rng.range(0.95, 1.05));
      return { kind, width: t, height: Math.max(TUNNEL_MIN_SIZE, t * 0.9) };
    }
    case 'hurdle': {
      // Tall enough that the line through it (sill + half the height) stays above the lift height of the low styles.
      const [w0, w1] = HURDLE_WIDTH;
      return { kind, width: w0 + (w1 - w0) * (1 - difficulty) * rng.range(0.6, 1), height: Math.max(1.5, HURDLE_HEIGHT[1] - 0.3 * difficulty) };
    }
    case 'drop': {
      const [d0, d1] = DROP_DIAMETER;
      const d = d1 - (d1 - d0) * difficulty;
      return { kind, width: d, height: d };
    }
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
    case 'technical':
      return r < 0.5 - 0.1 * difficulty ? 'square' : r < 0.7 ? 'arch' : r < 0.85 ? 'flag' : 'hoop';
    case 'acro':
      return r < 0.35 ? 'hoop' : r < 0.7 ? 'arch' : 'square';
    case 'industrial':
      return r < 0.55 ? 'square' : r < 0.8 ? 'arch' : 'hoop';
    default:
      return r < 0.3 ? 'arch' : r < 0.5 ? 'square' : 'hoop';
  }
}
