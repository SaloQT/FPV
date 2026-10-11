/**
 * Thrust, power and efficiency curves for the lab page: the quad held on the static bench at a sweep of throttle levels, so the
 * curves include the motor and battery the way the game flies them.
 */
import { QUAD_5IN_6S, type QuadConfig } from '../sim/presets';
import { benchStatic } from '../sim/testkit';
import type { PropDesign } from './design';
import { quadWithProp } from './fit';

const G0 = 9.80665;

export interface CurvePoint {
  /** Motor duty, 0..1. */
  duty: number;
  rpm: number;
  /** All four props, g force. */
  thrustG: number;
  /** Power drawn from the battery, W. */
  watts: number;
  /** g of thrust per watt from the battery. */
  gramsPerWatt: number;
}

export function propCurves(d: PropDesign, base: QuadConfig = QUAD_5IN_6S, steps = 16): CurvePoint[] {
  const cfg = quadWithProp(base, d);
  const out: CurvePoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const duty = i / steps;
    const r = benchStatic(cfg, duty, 0.25);
    const thrustG = (r.thrust / G0) * 1000;
    out.push({ duty, rpm: (r.omega * 60) / (2 * Math.PI), thrustG, watts: r.power, gramsPerWatt: r.power > 0 ? thrustG / r.power : 0 });
  }
  return out;
}
