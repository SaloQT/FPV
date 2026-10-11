/**
 * A parametric propeller design: the numbers a person would pick when drawing a prop. The blade element solver (bemt.ts)
 * turns one of these into thrust and torque; fit.ts turns it into the sim's prop coefficients, mass and inertia.
 * All lengths are metres, angles radians, density kg/m^3.
 */

/** Lift and drag of the blade section, as a simple polar: a linear lift slope that stalls, and a quadratic drag bucket. */
export interface Airfoil {
  /** Lift slope per radian below the stall (thin plate is 2 pi, real sections with thickness sit a little under). */
  clAlpha: number;
  /** Angle of zero lift, rad (negative for a cambered section). */
  alpha0: number;
  /** Peak lift coefficient before the stall. */
  clMax: number;
  /** Section drag at zero lift. */
  cd0: number;
  /** Drag growth with lift squared. */
  cdK: number;
}

export interface PropDesign {
  name: string;
  /** Tip to tip, m. */
  diameter: number;
  /** Geometric pitch at 75% radius, m: how far the prop would screw forward in one turn. */
  pitch: number;
  /** How the pitch changes root to tip: 0 is a constant-pitch helix, 0.2 puts 20% more pitch at the tip than at the root. */
  pitchTilt: number;
  /** Number of blades. */
  blades: number;
  /** Chord at 75% radius as a fraction of the radius. */
  chordRatio: number;
  /** Chord change along the blade: positive makes the tip wider than the root (per unit radius fraction). */
  chordTaper: number;
  /** Hub radius as a fraction of the tip radius (the blade starts here). */
  hubRatio: number;
  /** Blade thickness as a fraction of the chord (mass and bending stiffness). */
  thicknessRatio: number;
  airfoil: Airfoil;
  /** Plastic density, kg/m^3. */
  density: number;
}

export const INCH = 0.0254;

/** Mass of the stock 5 inch tri-blade as the sim has always flown it (presets.ts propMass), kg. */
export const STOCK_PROP_MASS = 0.005;

export const DEFAULT_AIRFOIL: Airfoil = { clAlpha: 5.3, alpha0: -0.05, clMax: 1.25, cd0: 0.014, cdK: 0.06 };

/** 5 x 4.3 x 3: 5.1 in diameter (the sim's 0.1295 m), 4.3 in pitch, three blades. Calibrated by fit.ts to the sim's stock prop. */
export const DEFAULT_PROP: PropDesign = {
  name: '5.1x4.3x3 stock',
  diameter: 0.1295,
  pitch: 4.3 * INCH,
  pitchTilt: 0,
  blades: 3,
  chordRatio: 0.15,
  chordTaper: 0,
  hubRatio: 0.14,
  thicknessRatio: 0.09,
  airfoil: DEFAULT_AIRFOIL,
  density: 1200,
};

/** The numbers the optimiser may change, with their allowed range. Everything else is copied from the default. */
export interface PropVar {
  key: 'diameter' | 'pitch' | 'pitchTilt' | 'blades' | 'chordRatio' | 'chordTaper' | 'thicknessRatio' | 'clMax' | 'cd0';
  min: number;
  max: number;
  /** Blades are whole numbers. */
  integer?: boolean;
}

export const PROP_VARS: readonly PropVar[] = [
  { key: 'diameter', min: 4.0 * INCH, max: 5.2 * INCH },
  { key: 'pitch', min: 2.5 * INCH, max: 6.5 * INCH },
  { key: 'pitchTilt', min: -0.3, max: 0.4 },
  { key: 'blades', min: 2, max: 5, integer: true },
  { key: 'chordRatio', min: 0.11, max: 0.45 },
  { key: 'chordTaper', min: -0.5, max: 0.5 },
  { key: 'thicknessRatio', min: 0.05, max: 0.14 },
  { key: 'clMax', min: 1.0, max: 1.5 },
  { key: 'cd0', min: 0.010, max: 0.035 },
];

/** Read one optimiser variable off a design. */
export function getVar(d: PropDesign, key: PropVar['key']): number {
  if (key === 'clMax') return d.airfoil.clMax;
  if (key === 'cd0') return d.airfoil.cd0;
  return d[key];
}

/** A copy of `base` with the optimiser variables in `x` (same order as PROP_VARS, each clamped to its range). */
export function designFromVector(x: readonly number[], base: PropDesign = DEFAULT_PROP, name = 'candidate'): PropDesign {
  const d: PropDesign = { ...base, name, airfoil: { ...base.airfoil } };
  PROP_VARS.forEach((v, i) => {
    let val = Math.min(v.max, Math.max(v.min, x[i]));
    if (v.integer) val = Math.round(val);
    if (v.key === 'clMax') d.airfoil.clMax = val;
    else if (v.key === 'cd0') d.airfoil.cd0 = val;
    else d[v.key] = val;
  });
  return d;
}

export function vectorFromDesign(d: PropDesign): number[] {
  return PROP_VARS.map((v) => getVar(d, v.key));
}

/** Chord at radius fraction x (0 hub .. 1 tip), m. */
export function chordAt(d: PropDesign, x: number): number {
  const c = d.chordRatio * d.diameter * 0.5 * (1 + d.chordTaper * (x - 0.75));
  return Math.max(0.002, c);
}

/** Geometric blade angle at radius fraction x, rad: the helix angle of the local pitch. */
export function twistAt(d: PropDesign, x: number): number {
  const r = x * d.diameter * 0.5;
  const pitchHere = d.pitch * (1 + d.pitchTilt * (x - 0.75));
  return Math.atan2(pitchHere, 2 * Math.PI * r);
}
