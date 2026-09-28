/**
 * Open (non-lap) layouts. Sprint: the best-of-40 straight line on calm ground with gates zig-zagging either side of it.
 * Freestyle: a wandering line that keeps turning the same way (around a bowl or hill), with big hoops and dive gates.
 */
import type { Layout, LayoutCtx, LayoutGate } from './layout';
import { localConcavity, nearestPair, siteOk } from './layout';
import { yawOf } from './spline';
import { bigHoopSpec, gateSpec, pickKind, targetTurnRadius } from './styles';

const TAU = 2 * Math.PI;

export function sprintLayout(c: LayoutCtx): Layout | null {
  const { rng, difficulty: d, sampler } = c;
  const n = c.gateCount;
  const step = rng.range(300, 470) / (n - 1);
  const amp = Math.min(rng.range(3, 6.5) * (0.6 + 0.8 * d), (step * step) / (9 * targetTurnRadius(d)));
  const reach = c.spec.corridor * c.extent;
  let best: [number, number][] | null = null;
  let bestCost = Infinity;
  for (let t = 0; t < 40; t++) {
    const r = reach * 0.8 * Math.sqrt(rng.next());
    const a = rng.range(0, TAU);
    const sx = c.cx + r * Math.cos(a);
    const sz = c.cz + r * Math.sin(a);
    const h = rng.range(0, TAU);
    const fx = Math.cos(h);
    const fz = Math.sin(h);
    const pts: [number, number][] = [];
    let cost = 0;
    let prevH = 0;
    for (let k = 0; k < n; k++) {
      const lat = (k % 2 === 0 ? 1 : -1) * amp * (k === 0 || k === n - 1 ? 0.3 : 1);
      const x = sx + fx * k * step - fz * lat;
      const z = sz + fz * k * step + fx * lat;
      if (!siteOk(c, x, z, false)) {
        cost = Infinity;
        break;
      }
      const hh = sampler.heightAt(x, z);
      cost += sampler.slopeAt(x, z) * 30 + (k ? Math.abs(hh - prevH) : 0);
      prevH = hh;
      pts.push([x, z]);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = pts;
    }
  }
  if (!best) return null;
  const gates: LayoutGate[] = best.map(([x, z], k) => ({
    x,
    z,
    spec: gateSpec(k === 0 ? 'start' : k === n - 1 ? 'finish' : pickKind('sprint', d, rng), d, rng),
    clear: rng.range(0.6, 1.5),
    roll: 0,
  }));
  return { closed: false, gates };
}

/** Random distinct integers in [lo, hi], no two closer than `gap` and none in `avoid`; fewer are returned when they do not fit. */
function pickSpread(rng: LayoutCtx['rng'], lo: number, hi: number, count: number, gap: number, avoid: number[] = []): number[] {
  const out: number[] = [];
  for (let t = 0; t < 40 && out.length < count; t++) {
    const i = rng.int(lo, hi);
    if (!avoid.includes(i) && out.every((j) => Math.abs(i - j) >= gap)) out.push(i);
  }
  return out;
}

/** Best of a few random start sites: dry, gentle and next to rugged ground (large ring concavity either way). */
function freestyleStart(c: LayoutCtx): [number, number] | null {
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  const reach = c.spec.corridor * c.extent * 0.8;
  for (let t = 0; t < 24; t++) {
    const r = reach * Math.sqrt(c.rng.next());
    const a = c.rng.range(0, TAU);
    const x = c.cx + r * Math.cos(a);
    const z = c.cz + r * Math.sin(a);
    if (!siteOk(c, x, z, false)) continue;
    const score = Math.abs(localConcavity(c.sampler, x, z, 60)) + c.rng.range(0, 8);
    if (score > bestScore) {
      bestScore = score;
      best = [x, z];
    }
  }
  return best;
}

export function freestyleLayout(c: LayoutCtx): Layout | null {
  const { rng, difficulty: d, sampler } = c;
  const n = c.gateCount;
  const first = freestyleStart(c);
  if (!first) return null;
  const pos: [number, number][] = [first];
  const mean = rng.range(Math.max(320, (n - 1) * 40), 800) / (n - 1);
  let heading = rng.range(0, TAU);
  let turn = rng.sign();
  for (let k = 1; k < n; k++) {
    const [px, pz] = pos[k - 1];
    let pick: [number, number, number] | null = null;
    let pickScore = -Infinity;
    for (let t = 0; t < 12; t++) {
      const dh = (t < 7 ? turn : -turn) * rng.range(0.15, 0.6) + rng.range(-0.15, 0.15);
      const step = mean * rng.range(0.8, 1.2);
      const x = px + step * Math.cos(heading + dh);
      const z = pz + step * Math.sin(heading + dh);
      if (!siteOk(c, x, z, false) || nearestPair(pos, x, z) < Math.min(30, mean * 0.7)) continue;
      const score = Math.abs(localConcavity(sampler, x, z, 25)) + rng.range(0, 6);
      if (score > pickScore) {
        pickScore = score;
        pick = [x, z, heading + dh];
      }
    }
    if (!pick) return null;
    pos.push([pick[0], pick[1]]);
    heading = pick[2];
    if (rng.chance(0.2)) turn = -turn;
  }
  // Dives are picked first: they are the style's signature gate and must never be lost to a coinciding big hoop.
  const dives = pickSpread(rng, 1, n - 2, n >= 8 ? 2 : 1, 3);
  const big = pickSpread(rng, 1, n - 1, rng.int(2, 3), 2, dives);
  const gates: LayoutGate[] = pos.map(([x, z], k) => {
    if (dives.includes(k)) {
      const a = pos[Math.max(k - 1, 0)];
      const b = pos[Math.min(k + 1, n - 1)];
      const spec = gateSpec('dive', d, rng);
      return { x, z, spec, clear: rng.range(3, 8), roll: 0, dive: { yaw: yawOf(b[0] - a[0], b[1] - a[1]), pitch: -rng.range(0.95, 1.13) } };
    }
    if (big.includes(k)) {
      const spec = bigHoopSpec(rng);
      return { x, z, spec, clear: rng.range(5, 15) - spec.height / 2, roll: 0 };
    }
    const kind = k === 0 ? 'arch' : pickKind('freestyle', d, rng);
    return { x, z, spec: gateSpec(kind, d, rng), clear: rng.range(1, 4), roll: 0 };
  });
  return { closed: false, gates };
}
