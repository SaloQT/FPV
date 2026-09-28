/**
 * Race circuit: a star-shaped closed blob (a few random harmonics on a circle, then stretched) is scaled to the target lap
 * length, dropped where the ground is calmest and sampled at unequal arc lengths. Star-shaped curves cannot cross themselves,
 * which is what keeps the loop clean; the start gate goes on the straightest stretch, and the 2-3 tightest corners get a
 * high arch/hoop followed by a low gate (split-S / Immelmann style height changes).
 */
import type { Layout, LayoutCtx, LayoutGate } from './layout';
import { nearest2D, siteOk } from './layout';
import { gateSpec, pickKind } from './styles';
import { wrapAngle } from './spline';

const TAU = 2 * Math.PI;
const DENSE = 720;
/** Blob centres sampled per layout; cheap (48 terrain queries each) and it finds dry, calm ground on lake maps. */
const CENTRE_TRIES = 48;

interface Blob {
  x: Float64Array;
  z: Float64Array;
  /** Cumulative arc length, DENSE + 1 entries; last is the loop length. */
  s: Float64Array;
  maxR: number;
}

function makeBlob(c: LayoutCtx, target: number): Blob | null {
  const { rng, difficulty } = c;
  const kd = 0.7 + 0.6 * difficulty;
  const amp = [rng.range(0.08, 0.3), rng.range(0.05, 0.22), rng.range(0.02, 0.12), rng.range(0, 0.08)].map((a) => a * kd);
  const phase = amp.map(() => rng.range(0, TAU));
  const stretch = rng.range(1, 1.6);
  const axis = rng.range(0, Math.PI);
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const x = new Float64Array(DENSE);
  const z = new Float64Array(DENSE);
  for (let m = 0; m < DENSE; m++) {
    const th = (TAU * m) / DENSE;
    let r = 1;
    for (let k = 0; k < amp.length; k++) r += amp[k] * Math.cos((k + 2) * th + phase[k]);
    if (r < 0.3) return null;
    const px = r * Math.cos(th);
    const pz = r * Math.sin(th);
    const u = (px * ca + pz * sa) * stretch;
    const v = (-px * sa + pz * ca) / stretch;
    x[m] = u * ca - v * sa;
    z[m] = u * sa + v * ca;
  }
  const s = new Float64Array(DENSE + 1);
  for (let m = 0; m < DENSE; m++) {
    const n = (m + 1) % DENSE;
    s[m + 1] = s[m] + Math.hypot(x[n] - x[m], z[n] - z[m]);
  }
  const k = target / s[DENSE];
  let maxR = 0;
  for (let m = 0; m <= DENSE; m++) s[m] *= k;
  for (let m = 0; m < DENSE; m++) {
    x[m] *= k;
    z[m] *= k;
    maxR = Math.max(maxR, Math.hypot(x[m], z[m]));
  }
  return { x, z, s, maxR };
}

/** Index (in the blob's travel order) of the straightest stretch, judged by heading change over +-12 samples. */
function straightestIndex(b: Blob): number {
  let best = 0;
  let bestTurn = Infinity;
  for (let m = 0; m < DENSE; m += 4) {
    let turn = 0;
    for (let k = -12; k <= 12; k += 4) {
      const i0 = (m + k + DENSE) % DENSE;
      const i1 = (m + k + 4 + DENSE) % DENSE;
      const i2 = (m + k + 8 + DENSE) % DENSE;
      const h0 = Math.atan2(b.z[i1] - b.z[i0], b.x[i1] - b.x[i0]);
      const h1 = Math.atan2(b.z[i2] - b.z[i1], b.x[i2] - b.x[i1]);
      turn += Math.abs(wrapAngle(h1 - h0));
    }
    if (turn < bestTurn) {
      bestTurn = turn;
      best = m;
    }
  }
  return best;
}

function pointAt(b: Blob, from: number, dir: number, arc: number): [number, number] {
  const total = b.s[DENSE];
  let target = (b.s[from] + dir * arc) % total;
  if (target < 0) target += total;
  let lo = 0;
  let hi = DENSE;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (b.s[mid] <= target) lo = mid;
    else hi = mid;
  }
  const n = (lo + 1) % DENSE;
  const f = (target - b.s[lo]) / Math.max(b.s[lo + 1] - b.s[lo], 1e-9);
  return [b.x[lo] + (b.x[n] - b.x[lo]) * f, b.z[lo] + (b.z[n] - b.z[lo]) * f];
}

/** Picks the blob centre where the ground under the whole loop is calmest. */
function placeCentre(c: LayoutCtx, b: Blob): [number, number] | null {
  const room = c.spec.corridor * c.extent - b.maxR - 10;
  if (room < 0) return null;
  let best: [number, number] | null = null;
  let bestCost = Infinity;
  for (let t = 0; t < CENTRE_TRIES; t++) {
    const rr = room * Math.sqrt(c.rng.next());
    const a = c.rng.range(0, TAU);
    const x = c.cx + rr * Math.cos(a);
    const z = c.cz + rr * Math.sin(a);
    let cost = 0;
    for (let m = 0; m < DENSE; m += 15) {
      const px = x + b.x[m];
      const pz = z + b.z[m];
      cost += Math.max(0, c.sampler.slopeAt(px, pz) - 0.26) * 40;
      if (c.sampler.heightAt(px, pz) < c.waterFloor) cost += 50;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = [x, z];
    }
  }
  return best;
}

export function raceLayout(c: LayoutCtx): Layout | null {
  const { rng, difficulty } = c;
  const n = c.gateCount;
  const target = Math.min(Math.max(n * rng.range(46, 60), 560), 850);
  const blob = makeBlob(c, target);
  if (!blob) return null;
  const centre = placeCentre(c, blob);
  if (!centre) return null;
  const start = straightestIndex(blob);
  const dir = rng.sign();
  const spacing = target / n;
  const gates: LayoutGate[] = [];
  for (let k = 0; k < n; k++) {
    const nominal = k * spacing + (k === 0 ? 0 : rng.range(-0.15, 0.15) * spacing);
    let placed: [number, number] | null = null;
    for (const shift of [0, 5, -5, 10, -10, 16, -16]) {
      const p = pointAt(blob, start, dir, nominal + shift);
      const x = centre[0] + p[0];
      const z = centre[1] + p[1];
      if (siteOk(c, x, z, false)) {
        placed = [x, z];
        break;
      }
    }
    if (!placed) return null;
    const spec = gateSpec(k === 0 ? 'start' : pickKind('race', difficulty, rng), difficulty, rng);
    gates.push({ x: placed[0], z: placed[1], spec, clear: rng.range(0.45, 1.3), roll: 0 });
  }
  for (let i = 0; i < n; i++) if (nearest2D(gates, gates[i].x, gates[i].z, i) < 14) return null;
  addHeightChanges(c, gates);
  addTilts(c, gates);
  return { closed: true, gates };
}

function addHeightChanges(c: LayoutCtx, gates: LayoutGate[]): void {
  const n = gates.length;
  if (n < 7) return;
  const turn: number[] = gates.map((g, i) => {
    const a = gates[(i + n - 1) % n];
    const b = gates[(i + 1) % n];
    return Math.abs(wrapAngle(Math.atan2(b.z - g.z, b.x - g.x) - Math.atan2(g.z - a.z, g.x - a.x)));
  });
  const order = gates.map((_, i) => i).filter((i) => i >= 2 && i <= n - 3).sort((a, b) => turn[b] - turn[a]);
  const want = c.rng.int(2, 3);
  const chosen: number[] = [];
  for (const i of order) {
    if (chosen.length >= want) break;
    if (chosen.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) >= 3)) chosen.push(i);
  }
  for (const i of chosen) {
    const hi = c.rng.range(4, 7.5) + 2.5 * c.difficulty;
    gates[i].spec = gateSpec(c.rng.chance(0.5) ? 'arch' : 'hoop', c.difficulty, c.rng);
    gates[i].clear = hi;
    gates[i - 1].clear = hi * 0.45;
    gates[i + 1].spec = gateSpec('square', c.difficulty, c.rng);
    gates[i + 1].clear = c.rng.range(0.5, 0.9);
  }
}

function addTilts(c: LayoutCtx, gates: LayoutGate[]): void {
  if (c.difficulty < 0.45) return;
  const count = c.difficulty >= 0.8 ? 2 : c.rng.chance(c.difficulty) ? 1 : 0;
  for (let t = 0; t < count; t++) {
    const g = gates[c.rng.int(1, gates.length - 1)];
    if (g.spec.kind === 'square' && g.clear < 2) g.roll = c.rng.sign() * c.rng.range(0.15, 0.4);
  }
}
