/**
 * Mountain line: a long walk that hugs a valley floor (drainage) or a ridge crest, one gate every 75-190 m, alternating sides of
 * the line, with the height above ground drifting between 8 and 40 m. Gates where the ground falls away along the line become
 * dive gates aimed down the slope.
 */
import type { Layout, LayoutCtx, LayoutGate } from './layout';
import { localConcavity, nearestPair, siteOk } from './layout';
import { yawOf } from './spline';
import { gateSpec, pickKind } from './styles';

const TAU = 2 * Math.PI;
const TURNS = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];

/** Preferred start: dry ground on the chosen feature (valley floor or crest), close enough to the centre to have room to run. */
function pickStart(c: LayoutCtx, mode: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  const reach = c.spec.corridor * c.extent;
  for (let t = 0; t < 40; t++) {
    const r = reach * 0.7 * Math.sqrt(c.rng.next());
    const a = c.rng.range(0, TAU);
    const x = c.cx + r * Math.cos(a);
    const z = c.cz + r * Math.sin(a);
    if (!siteOk(c, x, z, false)) continue;
    const score = mode * localConcavity(c.sampler, x, z, 60) - r * 0.02;
    if (score > bestScore) {
      bestScore = score;
      best = [x, z];
    }
  }
  return best;
}

function walk(c: LayoutCtx, mode: number, step: number): [number, number][] | null {
  const { rng, sampler } = c;
  const start = pickStart(c, mode);
  if (!start) return null;
  const reach = c.spec.corridor * c.extent;
  const pos: [number, number][] = [start];
  let heading = rng.range(0, TAU);
  for (let k = 1; k < c.gateCount; k++) {
    const [px, pz] = pos[k - 1];
    let pick: [number, number, number] | null = null;
    let pickScore = -Infinity;
    for (const spread of [0.6, 1.5]) {
      for (const dh of TURNS) {
        for (const len of [step, step * 0.7, step * 1.25]) {
          const h = heading + dh * spread + rng.range(-0.08, 0.08);
          const x = px + len * Math.cos(h);
          const z = pz + len * Math.sin(h);
          if (!siteOk(c, x, z, false) || nearestPair(pos, x, z) < Math.max(60, step * 0.6)) continue;
          const toCentre = Math.atan2(c.cz - z, c.cx - x);
          const home = Math.hypot(x - c.cx, z - c.cz) > reach * 0.6 ? Math.cos(h - toCentre) * 25 : 0;
          const score = mode * localConcavity(sampler, x, z, 45) - Math.abs(dh) * 4 + home + rng.range(0, 4);
          if (score > pickScore) {
            pickScore = score;
            pick = [x, z, h];
          }
        }
      }
      if (pick) break;
    }
    if (!pick) return null;
    pos.push([pick[0], pick[1]]);
    heading = pick[2];
  }
  return pos;
}

export function mountainLayout(c: LayoutCtx): Layout | null {
  const { rng, sampler, difficulty: d } = c;
  const n = c.gateCount;
  const mode = rng.chance(0.5) ? 1 : -1;
  const pos = walk(c, mode, rng.range(1700, 2800) / (n - 1));
  if (!pos) return null;
  const dir = pos.map((p, k) => {
    const a = pos[Math.max(k - 1, 0)];
    const b = pos[Math.min(k + 1, n - 1)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  });
  const site: { x: number; z: number; h: number; fall: number }[] = [];
  for (let k = 0; k < n; k++) {
    let [x, z] = pos[k];
    const h = dir[k];
    const side = k % 2 === 0 ? 1 : -1;
    for (const off of [rng.range(8, 22), 6, 0]) {
      const ox = x - Math.sin(h) * off * side;
      const oz = z + Math.cos(h) * off * side;
      if (off === 0 || siteOk(c, ox, oz, false)) {
        x = ox;
        z = oz;
        break;
      }
    }
    const fall = Math.atan2(sampler.heightAt(x, z) - sampler.heightAt(x + 14 * Math.cos(h), z + 14 * Math.sin(h)), 14);
    site.push({ x, z, h, fall });
  }
  const dives = pickDives(site.map((q) => q.fall), rng.int(2, 4));
  let agl = rng.range(12, 30);
  const gates: LayoutGate[] = [];
  for (let k = 0; k < n; k++) {
    const { x, z, h, fall } = site[k];
    if (dives.has(k)) {
      const pitch = -Math.min(Math.max(fall * 0.9, 0.3), 0.95);
      gates.push({ x, z, spec: gateSpec('dive', d, rng), clear: rng.range(4, 10), roll: 0, dive: { yaw: yawOf(Math.cos(h), Math.sin(h)), pitch } });
      continue;
    }
    agl = Math.min(Math.max(agl + rng.range(-9, 9), 8), 40);
    const spec = gateSpec(pickKind('mountain', d, rng), d, rng);
    gates.push({ x, z, spec, clear: agl - spec.height / 2, roll: 0 });
  }
  return { closed: false, gates };
}

/** The `want` gates (never first or last, at least 3 apart) where the ground falls away most along the line, if it falls at all. */
function pickDives(fall: number[], want: number): Set<number> {
  const order = fall.map((_, k) => k).filter((k) => k >= 2 && k <= fall.length - 2 && fall[k] > 0.12).sort((a, b) => fall[b] - fall[a]);
  const chosen = new Set<number>();
  for (const k of order) {
    if (chosen.size >= want) break;
    let clear = true;
    for (const j of chosen) if (Math.abs(j - k) < 3) clear = false;
    if (clear) chosen.add(k);
  }
  return chosen;
}
