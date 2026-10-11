import { CURVE_STRIDE, railSample, sampleRail } from './curve';
import { SCRAMBLER, ENTERPRISE_BOOM, ENTERPRISE_HINGE, ENTERPRISE_PIVOT, ENTERPRISE_RADIUS, ENTERPRISE_RAM_FOOT, ENTERPRISE_RAM_HEAD, TOPSPIN_ARM, TOPSPIN_PIVOT, TOPSPIN_PLATFORM_DROP } from './flatPhysics';
import { smooth, TAU, wrap } from './math';
import { CAROUSEL_BOBS, CAROUSEL_MOUNT, CAROUSEL_STROKE, coasterBogiePivot, coasterCouplerHeight, coasterCouplerLength, coasterCouplerPin, coasterWheelbase, RAIL, SWING_ANCHOR, SWING_CHAIN, TEACUP_BASE, TEACUPS, WHEEL_HINGE } from './rideDimensions';
import type { ParkRuntime } from './runtime';
import type { CoasterCurve } from './types';

type Range = [number, number];
const interval = (a: number, b = a): Range => [Math.min(a, b), Math.max(a, b)];
const plus = (a: Range, b: Range): Range => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Range, k: number): Range => interval(a[0] * k, a[1] * k);
const product = (a: Range, b: Range): Range => { const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return [Math.min(...p), Math.max(...p)]; };
/** Exact extrema over an unwrapped angle interval, including every interior quarter turn. */
function sine(a: Range): Range {
  if (a[1] - a[0] >= TAU) return [-1, 1];
  const out = interval(Math.sin(a[0]), Math.sin(a[1]));
  if (Math.ceil((a[0] - Math.PI / 2) / TAU) <= Math.floor((a[1] - Math.PI / 2) / TAU)) out[1] = 1;
  if (Math.ceil((a[0] + Math.PI / 2) / TAU) <= Math.floor((a[1] + Math.PI / 2) / TAU)) out[0] = -1;
  return out;
}
const cosine = (a: Range): Range => sine(plus(a, interval(Math.PI / 2)));

/** Conservative centres for the complete generalized-coordinate interpolation interval.
 * The body origin need not follow its endpoint chord: pendulums, nested pivots and track followers are bounded analytically.
 * Local primitive geometry is enclosed separately by a rigid-body sphere; collision still tests every exact primitive. */
export class SweptBodyBounds {
  private readonly centres: Float64Array;
  private readonly stamps: Int32Array;
  private readonly rail = railSample();
  private epoch = 0;
  constructor(private readonly runtime: ParkRuntime) {
    this.centres = new Float64Array(runtime.bodies.length * 6); this.stamps = new Int32Array(runtime.bodies.length);
  }
  begin(): void { if (++this.epoch >= 0x7fffffff) { this.stamps.fill(0); this.epoch = 1; } }
  bounds(index: number, radius: number, out: Float64Array, offset: number): void {
    this.centre(index); const a = index * 6;
    const current = this.runtime.bodies[index].pos, previous = this.runtime.previousBodies[index].pos;
    let magnitude = Math.max(1, radius); for (let k = 0; k < 6; k++) magnitude = Math.max(magnitude, Math.abs(this.centres[a + k]));
    for (let k = 0; k < 3; k++) magnitude = Math.max(magnitude, Math.abs(current[k]), Math.abs(previous[k]));
    const roundoff = 128 * Number.EPSILON * magnitude;
    // bodyPose returns stored endpoint poses at alpha0/1. Include those as well, including explicit teleports/debug poses.
    for (let k = 0; k < 3; k++) { out[offset + k] = Math.min(this.centres[a + k], current[k], previous[k]) - radius - roundoff;
      out[offset + k + 3] = Math.max(this.centres[a + k + 3], current[k], previous[k]) + radius + roundoff; }
  }
  private railBounds(curve: CoasterCurve, start: number, end: number, out: Float64Array, o: number): void {
    for (let k = 0; k < 3; k++) { out[o + k] = Infinity; out[o + k + 3] = -Infinity; }
    const include = (p: ArrayLike<number>, at = 0) => { for (let k = 0; k < 3; k++) { out[o + k] = Math.min(out[o + k], p[at + k]); out[o + k + 3] = Math.max(out[o + k + 3], p[at + k]); } };
    const a = curve.samples, stride = CURVE_STRIDE;
    if (end - start >= curve.length) { for (let i = 0; i < curve.count; i++) include(a, i * stride); return; }
    const first = wrap(start, curve.length), last = first + end - start;
    const segment = (loS: number, hiS: number) => {
      include(sampleRail(curve, loS, this.rail).pos); include(sampleRail(curve, hiS, this.rail).pos);
      let lo = 0, hi = curve.count - 1;
      while (hi - lo > 1) { const m = (lo + hi) >>> 1; if (a[m * stride + 13] <= loS) lo = m; else hi = m; }
      // Rail positions interpolate linearly between stored knots; endpoints plus all interior knots are an exact convex enclosure.
      for (let i = lo + 1; i < curve.count && a[i * stride + 13] < hiS; i++) include(a, i * stride);
    };
    segment(first, Math.min(last, curve.length)); if (last > curve.length) segment(0, last - curve.length);
  }
  private centre(index: number): void {
    if (this.stamps[index] === this.epoch) return; this.stamps[index] = this.epoch;
    const rt = this.runtime, def = rt.park.bodies?.[index], state = def && rt.rides?.[def.ride], out = this.centres, o = index * 6;
    // Minimal external test/runtime fixtures expose endpoint poses rather than generalized ride coordinates.
    if (!def || !state) { for (let k = 0; k < 3; k++) { out[o + k] = Math.min(rt.bodies[index].pos[k], rt.previousBodies[index].pos[k]); out[o + k + 3] = Math.max(rt.bodies[index].pos[k], rt.previousBodies[index].pos[k]); } return; }
    const r = rt.park.rides[def.ride];
    if (def.role === 'restraint') {
      this.centre(def.parent!); const parent = def.parent! * 6, radius = Math.hypot(...def.local);
      for (let k = 0; k < 3; k++) { out[o + k] = out[parent + k] - radius; out[o + k + 3] = out[parent + k + 3] + radius; } return;
    }
    if (r.curve && (def.role === 'car' || def.role === 'bogie' || def.role === 'coupler')) {
      const car = def.role === 'bogie' ? rt.park.bodies[def.parent!].index : def.index, train = state.trains[def.train ?? 0];
      const pin = coasterCouplerPin(r.carLength), drawbar = coasterCouplerLength(r.carLength), wheelbase = coasterWheelbase(r.carLength);
      // These are solver brackets, not empirical maximum errors: each link spacing lies in [2pin,2pin+2drawbar], each bogie offset in [0,wheelbase].
      const first = def.role === 'coupler' ? car - 1 : car;
      this.railBounds(r.curve, Math.min(train.previousS, train.s) - car * (2 * pin + 2 * drawbar) - wheelbase,
        Math.max(train.previousS, train.s) - first * 2 * pin + wheelbase, out, o);
      // Bogies sit on the rail lengths as built, which the rail builder keeps within RAIL.chordError of the exact curve; cars and couplers hang from the bogies.
      const radius = RAIL.chordError + (def.role === 'bogie' ? 0 : 2 * Math.abs(coasterBogiePivot(r.family)) + (def.role === 'coupler' ? Math.hypot(pin, coasterCouplerHeight(r.family)) : 0));
      for (let k = 0; k < 3; k++) { out[o + k] -= radius; out[o + k + 3] += radius; } return;
    }
    const theta = interval(state.previousTheta, state.theta), phi = interval(state.previousPhi, state.phi), height = interval(state.previousY, state.y);
    let x = interval(0), y = interval(0), z = interval(0), extra = 0;
    if (r.family === 'enterprise') {
      // A boom-frame point (h, b) sits at pivot + (h cos phi + b sin phi, b cos phi - h sin phi).
      const boom = (h: number, b: number): [Range, Range] => [plus(interval(ENTERPRISE_PIVOT[1]), plus(scale(cosine(phi), h), scale(sine(phi), b))), plus(interval(ENTERPRISE_PIVOT[2]), plus(scale(cosine(phi), b), scale(sine(phi), -h)))];
      if (def.role === 'frame') { y = interval(ENTERPRISE_PIVOT[1]); z = interval(ENTERPRISE_PIVOT[2]); }
      else if (def.role === 'actuator') {
        // Every telescoping sleeve centre lies on the foot-to-head segment, including the fully nested minimum length.
        const [topY, topZ] = boom(ENTERPRISE_RAM_HEAD[1], ENTERPRISE_RAM_HEAD[2]);
        const [, fy, fz] = ENTERPRISE_RAM_FOOT;
        y = interval(Math.min(fy, topY[0]), Math.max(fy, topY[1])); z = interval(Math.min(fz, topZ[0]), Math.max(fz, topZ[1]));
      } else {
        [y, z] = boom(ENTERPRISE_BOOM[1], ENTERPRISE_BOOM[2]);
        if (def.role !== 'rotor') { const a = plus(theta, interval(def.index * TAU / 20)), s = scale(sine(a), ENTERPRISE_RADIUS);
          x = scale(cosine(a), ENTERPRISE_RADIUS); y = plus(y, product(s, sine(phi))); z = plus(z, product(s, cosine(phi))); extra = ENTERPRISE_HINGE;
        }
      }
    } else if (r.family === 'topspin') {
      if (def.role === 'platform') { const t = def.train ?? 0; y = scale(interval(smooth(state.previousRestraints[t]), smooth(state.trains[t].restraint)), -TOPSPIN_PLATFORM_DROP); }
      else if (def.role === 'rotor') y = interval(TOPSPIN_PIVOT);
      else { y = plus(interval(TOPSPIN_PIVOT), scale(cosine(theta), -TOPSPIN_ARM)); z = scale(sine(theta), -TOPSPIN_ARM); }
    } else if (r.family === 'wheel') {
      y = interval(r.radius + 5);
      if (def.role !== 'rotor') { const a = plus(theta, interval(def.index * TAU / 12)); x = plus(scale(cosine(a), r.radius), scale(sine(phi), WHEEL_HINGE)); y = plus(y, plus(scale(sine(a), r.radius), scale(cosine(phi), -WHEEL_HINGE))); }
    } else if (r.family === 'ship' || r.family === 'pendulum') {
      y = interval(r.height); if (def.role !== 'rotor') { x = scale(sine(phi), r.radius); y = plus(y, scale(cosine(phi), -r.radius)); }
    } else if ((r.family === 'drop' || r.family === 'observation') && (def.role === 'tower' || def.role === 'frame')) y = height;
    else if (r.family === 'scrambler' && def.role !== 'rotor') {
      const group = def.role === 'frame' ? def.index : Math.floor(def.index / SCRAMBLER.carsPerUnit), a = plus(theta, interval(group * TAU / SCRAMBLER.units));
      x = scale(cosine(a), r.radius * SCRAMBLER.reach); y = interval(SCRAMBLER.bodyY); z = scale(sine(a), r.radius * SCRAMBLER.reach);
      if (def.role === 'cup') { const c = plus(scale(theta, -2.2), interval(def.index % SCRAMBLER.carsPerUnit * TAU / SCRAMBLER.carsPerUnit)); x = plus(x, scale(cosine(c), r.radius * SCRAMBLER.offset)); z = plus(z, scale(sine(c), r.radius * SCRAMBLER.offset)); }
    } else if (r.family === 'teacups' && def.role !== 'rotor') {
      // Small turntables ride the main one; each cup turns on a pin set cupOffset from its table's centre.
      const T = TEACUPS, group = def.role === 'frame' ? def.index : Math.floor(def.index / T.cupsPerTable), a = plus(theta, interval(group * TAU / T.tables));
      x = scale(cosine(a), r.radius * T.tableReach); z = scale(sine(a), r.radius * T.tableReach);
      if (def.role === 'cup') { const c = plus(scale(theta, T.tableRate), interval(def.index % T.cupsPerTable * TAU / T.cupsPerTable)); x = plus(x, scale(cosine(c), T.cupOffset)); z = plus(z, scale(sine(c), T.cupOffset)); y = interval(TEACUP_BASE); }
    } else if (def.role === 'rotor') { if (r.family === 'swings') y = plus(height, interval(-r.height)); }
    else {
      const a = plus(theta, interval(def.index * TAU / (def.role === 'cup' ? 6 : 16))), rr = plus(interval(r.radius * SWING_ANCHOR), r.family === 'swings' ? scale(sine(phi), SWING_CHAIN) : interval(0));
      x = product(cosine(a), rr); z = product(sine(a), rr);
      y = r.family === 'swings' ? plus(height, scale(cosine(phi), -SWING_CHAIN)) : r.family === 'carousel' ? plus(interval(CAROUSEL_MOUNT), scale(sine(plus(scale(theta, CAROUSEL_BOBS), interval(3 * def.index * TAU / 16))), CAROUSEL_STROKE / 2)) : interval(TEACUP_BASE);
    }
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw), axes: [Range, Range, Range] = [plus(scale(x, c), scale(z, s)), y, plus(scale(x, -s), scale(z, c))];
    for (let k = 0; k < 3; k++) { out[o + k] = r.pos[k] + axes[k][0] - extra; out[o + k + 3] = r.pos[k] + axes[k][1] + extra; }
  }
}
