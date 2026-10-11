/**
 * Turns a prop design into what the quad physics uses: the linearised thrust and torque coefficients (PropParams), the
 * prop's mass and its spin inertia. The solver's own numbers are scaled so the default design lands exactly on the sim's
 * stock prop (STOCK_PROP, 5 g), which keeps every existing brain flying the way it was trained.
 */
import { QUAD_5IN_6S, type QuadConfig } from '../sim/presets';
import type { PropParams } from '../sim/propeller';
import { bemt } from './bemt';
import { chordAt, DEFAULT_PROP, STOCK_PROP_MASS, type PropDesign } from './design';

const STOCK_PROP = QUAD_5IN_6S.prop;

/** Shaft speed at which the coefficient curves are sampled: about 25000 rpm, a 5 inch prop at cruise throttle. */
const FIT_OMEGA = (25000 * 2 * Math.PI) / 60;

/** Straight-line fit of a coefficient against advance ratio: value at J = 0 and the J where the line reaches zero. */
function lineFit(ys: readonly number[], js: readonly number[]): { c0: number; j0: number } {
  const n = js.length;
  const mj = js.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (js[i] - mj) * (ys[i] - my);
    sxx += (js[i] - mj) ** 2;
  }
  const slope = sxy / sxx;
  const c0 = my - slope * mj;
  return { c0, j0: slope < 0 ? -c0 / slope : 9 };
}

export interface RawCoefficients { ct0: number; j0: number; cq0: number; jq0: number }

/** The solver's own linear coefficients for a design (before calibration to the stock prop). */
export function rawCoefficients(d: PropDesign): RawCoefficients {
  const n = FIT_OMEGA / (2 * Math.PI);
  const js: number[] = [];
  const cts: number[] = [];
  const cqs: number[] = [];
  // Sample the band the sim cares about: standstill up to about 60% of the way to zero thrust.
  const jTop = 0.55 * (d.pitch / d.diameter);
  for (let i = 0; i <= 8; i++) {
    const j = (jTop * i) / 8;
    const p = bemt(d, FIT_OMEGA, j * n * d.diameter);
    js.push(j);
    cts.push(p.ct);
    cqs.push(p.cq);
  }
  const a = lineFit(cts, js);
  const b = lineFit(cqs, js);
  return { ct0: a.c0, j0: a.j0, cq0: b.c0, jq0: b.j0 };
}

let stockRaw: RawCoefficients | null = null;

/** The sim's prop coefficients for a design. The default design returns STOCK_PROP exactly. */
export function propParamsFromDesign(d: PropDesign): PropParams {
  stockRaw ??= rawCoefficients(DEFAULT_PROP);
  if (d === DEFAULT_PROP) return { ...STOCK_PROP };
  const r = rawCoefficients(d);
  return {
    ...STOCK_PROP,
    diameter: d.diameter,
    ct0: STOCK_PROP.ct0 * (r.ct0 / stockRaw.ct0),
    cq0: STOCK_PROP.cq0 * (r.cq0 / stockRaw.cq0),
    j0: STOCK_PROP.j0 * (r.j0 / stockRaw.j0),
    jq0: STOCK_PROP.jq0 * (r.jq0 / stockRaw.jq0),
  };
}

/** Raw, uncalibrated plastic mass and spin inertia of the blades plus a small hub. */
function rawMassInertia(d: PropDesign): { mass: number; inertia: number } {
  const R = d.diameter * 0.5;
  const rings = 30;
  const dx = (1 - d.hubRatio) / rings;
  let mass = 0;
  let inertia = 0;
  for (let k = 0; k < rings; k++) {
    const x = d.hubRatio + (k + 0.5) * dx;
    const c = chordAt(d, x);
    const dm = d.density * 0.75 * c * c * d.thicknessRatio * dx * R * d.blades;
    mass += dm;
    inertia += dm * (x * R) ** 2;
  }
  const hubR = d.hubRatio * R;
  const hubM = d.density * Math.PI * hubR * hubR * 0.006;
  mass += hubM;
  inertia += 0.5 * hubM * hubR * hubR;
  return { mass, inertia };
}

let stockMass: { mass: number; inertia: number } | null = null;

/** Mass (kg) and spin inertia (kg m^2) of one prop; the default design is the stock 5 g prop. */
export function propMassInertia(d: PropDesign): { mass: number; inertia: number } {
  stockMass ??= rawMassInertia(DEFAULT_PROP);
  const m = rawMassInertia(d);
  const f = STOCK_PROP_MASS / stockMass.mass;
  return { mass: m.mass * f, inertia: m.inertia * f };
}

/**
 * The quad with a custom prop fitted to all four motors: the sim's prop coefficients, the changed prop mass in the
 * airframe mass and in the arm inertia, and the changed spin inertia on each motor. With the default design the result
 * is the same quad (a copy with identical numbers).
 */
export function quadWithProp(base: QuadConfig, d: PropDesign): QuadConfig {
  const stock = propMassInertia(DEFAULT_PROP);
  const mine = propMassInertia(d);
  const dm = mine.mass - stock.mass;
  const motors = base.motorPos.length;
  // Extra mass at each motor hub adds to the pitch, yaw and roll inertia by the parallel axis term.
  let ixx = base.inertia[0];
  let iyy = base.inertia[1];
  let izz = base.inertia[2];
  for (const p of base.motorPos) {
    ixx += dm * (p[1] * p[1] + p[2] * p[2]);
    iyy += dm * (p[0] * p[0] + p[2] * p[2]);
    izz += dm * (p[0] * p[0] + p[1] * p[1]);
  }
  return {
    ...base,
    name: d === DEFAULT_PROP ? base.name : `${base.name}+${d.name}`,
    mass: base.mass + dm * motors,
    inertia: [ixx, iyy, izz],
    prop: propParamsFromDesign(d),
    motor: { ...base.motor, inertia: base.motor.inertia + (mine.inertia - stock.inertia) },
  };
}

