/** Trees, rocks and walls scattered near (never on) the line: obstacles to fly around and past, with >= 4 m of clearance. */
import type { Vec3 } from '../../contracts';
import type { Placer } from './placer';
import type { Rng } from './rng';
import { pathTangent } from './spline';

/** Large obstacles wanted per style, and the share of trees and of rocks; the rest are walls. */
const MIX = {
  race: { count: 28, tree: 0.55, rock: 0.3 },
  sprint: { count: 16, tree: 0.55, rock: 0.3 },
  freestyle: { count: 22, tree: 0.5, rock: 0.4 },
  mountain: { count: 36, tree: 0.3, rock: 0.65 },
};

function tree(p: Placer, rng: Rng, x: number, z: number): boolean {
  const r = rng.range(0.22, 0.5);
  return p.add('tree', x, z, 0, [r, rng.range(5, 13), r]);
}

function rock(p: Placer, rng: Rng, x: number, z: number): boolean {
  const w = rng.range(1.4, 4.5);
  const size: Vec3 = [w, rng.range(0.8, 2.6), w * rng.range(0.6, 1.1)];
  return p.add('rock', x, z, rng.range(0, Math.PI), size);
}

/** A wall runs roughly parallel to the line, like a field boundary. */
function wall(p: Placer, rng: Rng, x: number, z: number, heading: number): boolean {
  const size: Vec3 = [rng.range(3, 8), rng.range(0.8, 1.6), rng.range(0.3, 0.5)];
  return p.add('wall', x, z, heading + rng.range(-0.25, 0.25), size);
}

/** A grove: the first tree plus a few neighbours a few metres away. */
function grove(p: Placer, rng: Rng, x: number, z: number): void {
  if (!tree(p, rng, x, z)) return;
  for (let k = rng.int(1, 4); k > 0; k--) {
    const a = rng.range(0, 2 * Math.PI);
    const d = rng.range(2.5, 7);
    tree(p, rng, x + d * Math.cos(a), z + d * Math.sin(a));
  }
}

export function scatterScenery(p: Placer, rng: Rng): void {
  const { path, closed, style } = p.track;
  const mix = MIX[style];
  const m = path.length;
  const t: Vec3 = [0, 0, 0];
  for (let tries = 0; tries < mix.count * 10 && !p.full; tries++) {
    if (placedLarge(p) >= mix.count) return;
    const i = rng.int(0, m - 1);
    pathTangent(path, i, closed, t);
    const len = Math.hypot(t[0], t[2]);
    if (len < 0.2) continue;
    const off = (5 + rng.next() * rng.next() * 30) * rng.sign();
    const x = path[i][0] - (t[2] / len) * off;
    const z = path[i][2] + (t[0] / len) * off;
    const r = rng.next();
    if (r < mix.tree) grove(p, rng, x, z);
    else if (r < mix.tree + mix.rock) rock(p, rng, x, z);
    else wall(p, rng, x, z, Math.atan2(-t[0], -t[2]) + Math.PI / 2);
  }
}

function placedLarge(p: Placer): number {
  let n = 0;
  for (const o of p.out) if (o.kind === 'tree' || o.kind === 'rock' || o.kind === 'wall') n++;
  return n;
}
