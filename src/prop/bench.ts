/**
 * The headless prop test bench: what a prop does on a thrust stand and in a short free flight, using the same quad
 * physics the game flies. Static thrust and power come from the sim's static bench (testkit.ts), top speed and climb rate
 * from a few seconds of flight in angle mode at full throttle.
 */
import { QUAD_5IN_6S, type QuadConfig } from '../sim/presets';
import { airborneQuad, benchStatic, inp, run } from '../sim/testkit';
import { DEFAULT_PROP, type PropDesign } from './design';
import { propMassInertia, quadWithProp } from './fit';

const G0 = 9.80665;
/** Share of the pack's capacity a pilot lands with. */
const USABLE_CHARGE = 0.85;

export interface BenchReport {
  name: string;
  /** Prop mass, g. */
  propGrams: number;
  /** Quad take-off mass, g. */
  massGrams: number;
  /** Full-throttle thrust of all four props, g force. */
  staticThrustG: number;
  /** Full-throttle thrust over weight. */
  thrustToWeight: number;
  /** Battery current at full throttle, A. */
  fullCurrent: number;
  /** Electrical efficiency at full throttle, g of thrust per watt from the battery. */
  gramsPerWattFull: number;
  /** Motor duty (0..1) that holds the quad up. */
  hoverDuty: number;
  hoverCurrent: number;
  /** Efficiency in the hover, g per watt from the battery. */
  gramsPerWattHover: number;
  /** Hover endurance on 85% of the pack, minutes (avionics included). */
  hoverMinutes: number;
  /** Fastest level-ish speed in angle mode at full throttle, m/s. */
  topSpeed: number;
  /** Climb rate after 1.5 s of full throttle, m/s. */
  climbRate: number;
  /** Tip speed at full throttle, m/s, and Mach number. */
  tipSpeed: number;
  tipMach: number;
}

export function benchProp(d: PropDesign = DEFAULT_PROP, base: QuadConfig = QUAD_5IN_6S, flight = true): BenchReport {
  const cfg = quadWithProp(base, d);
  const weight = cfg.mass * G0;
  const full = benchStatic(cfg, 1, 0.5);
  // Duty that makes the four props lift the weight (bisection, as testkit.hoverStick does but without the idle mapping).
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (benchStatic(cfg, m, 0.3).thrust < weight) lo = m;
    else hi = m;
  }
  const hover = benchStatic(cfg, hi, 0.3);
  let topSpeed = 0;
  let climbRate = 0;
  if (flight) {
    const q = airborneQuad(cfg, 0.29);
    run(q, 1.5, inp({ throttle: 1, mode: 'angle' }));
    climbRate = q.state.vel[1];
    const f = airborneQuad(cfg, 0.29);
    run(f, 6, inp({ throttle: 1, mode: 'angle', pitch: 1 }));
    topSpeed = Math.hypot(f.state.vel[0], f.state.vel[2]);
  }
  const R = cfg.prop.diameter * 0.5;
  const tip = full.omega * R;
  return {
    name: d.name,
    propGrams: propMassInertia(d).mass * 1000,
    massGrams: cfg.mass * 1000,
    staticThrustG: (full.thrust / G0) * 1000,
    thrustToWeight: full.thrust / weight,
    fullCurrent: full.current,
    gramsPerWattFull: full.power > 0 ? (full.thrust / G0) * 1000 / full.power : 0,
    hoverDuty: hi,
    hoverCurrent: hover.current,
    gramsPerWattHover: hover.power > 0 ? (hover.thrust / G0) * 1000 / hover.power : 0,
    hoverMinutes: hover.current > 0 ? ((cfg.battery.capacityMah / 1000) * USABLE_CHARGE) / hover.current * 60 : 0,
    topSpeed,
    climbRate,
    tipSpeed: tip,
    tipMach: tip / 343,
  };
}
