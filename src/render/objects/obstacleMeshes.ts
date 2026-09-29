/** Track obstacle meshes baked in world space: cones, poles, flag poles, walls, rocks and stand-in trees. */
import type { TrackObstacle, Vec3 } from '../../contracts';
import { pole } from './gateMeshes';
import { KIND, type ClothFlag } from './materials';
import { MeshBuilder, affineMul, affineRotY, affineTranslate } from './meshBuilder';
import { bevelBox, lathe, surface } from './primitives';

/** Deterministic 0..1 value from an integer seed. */
export function seeded(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number, k: number): number => seeded(seed * 7919 + (xi + i) * 73856093 + (yi + j) * 19349663 + (zi + k) * 83492791);
  const l = (a: number, c: number, t: number): number => a + (c - a) * t;
  return (
    l(l(l(h(0, 0, 0), h(1, 0, 0), sx), l(h(0, 1, 0), h(1, 1, 0), sx), sy), l(l(h(0, 0, 1), h(1, 0, 1), sx), l(h(0, 1, 1), h(1, 1, 1), sx), sy), sz) * 2 - 1
  );
}

const ground = (b: MeshBuilder, h: number, size: number): void => {
  b.aoFn = (_x, y) => 0.55 + 0.45 * Math.min(1, Math.max(0, (y - h) / size));
};

function cone(b: MeshBuilder, o: TrackObstacle): void {
  const r = o.size[0];
  const h = o.size[1];
  b.kind = KIND.CONE;
  b.a2 = h;
  lathe(b, [[0.74 * r, 0.02], [0.2 * r, h - 0.02], [0.1 * r, h - 0.006], [0.06 * r, h], [0, h]], 18, { polar: true });
  b.a2 = 0;
  b.kind = KIND.CONE;
  b.a3 = 1;
  bevelBox(b, [0, 0.01, 0], [r, 0.01, r], 0.006);
  b.a3 = 0;
}

function wall(b: MeshBuilder, o: TrackObstacle, variant: number): void {
  const [w, h, d] = o.size;
  b.kind = KIND.WALL;
  b.a2 = variant;
  ground(b, o.pos[1], 0.5);
  bevelBox(b, [0, (h - 0.15) / 2, 0], [w / 2, (h + 0.15) / 2, d / 2], 0.012);
  b.a2 = 0;
}

function rock(b: MeshBuilder, o: TrackObstacle, seed: number): void {
  const [w, h, d] = o.size;
  const rx = w * 0.5;
  const ry = h * 0.62;
  const rz = d * 0.5;
  const cy = h * 0.4;
  b.kind = KIND.ROCK;
  b.a2 = seeded(seed);
  ground(b, o.pos[1], h * 0.5);
  surface(
    b,
    (u, v): Vec3 => {
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      const dx = Math.sin(ph) * Math.cos(th);
      const dy = Math.cos(ph);
      const dz = Math.sin(ph) * Math.sin(th);
      const k = 0.88 + 0.12 * valueNoise(dx * 1.7, dy * 1.7, dz * 1.7, seed) + 0.05 * valueNoise(dx * 5, dy * 5, dz * 5, seed + 3);
      return [rx * dx * k, Math.max(cy + ry * dy * k, -0.08 * h), rz * dz * k];
    },
    20,
    12,
    { wrapU: true, uvScale: [w * 1.5, h] },
  );
  b.a2 = 0;
}

function tree(b: MeshBuilder, o: TrackObstacle, seed: number): void {
  const r = o.size[0];
  const h = o.size[1];
  const canopy = Math.max(3.5 * r, 0.2 * h);
  b.kind = KIND.TRUNK;
  lathe(b, [[0, -0.1], [r * 1.15, -0.1], [r * 1.05, 0.25], [r * 0.6, h * 0.7], [0, h * 0.72]], 8, { polar: true });
  b.kind = KIND.LEAVES;
  b.a2 = seeded(seed);
  for (let k = 0; k < 4; k++) {
    const yb = h * (0.2 + 0.16 * k);
    const rad = canopy * (1 - 0.2 * k);
    const top = yb + h * 0.34;
    lathe(b, [[0, yb + h * 0.03], [rad, yb], [rad * 0.5, yb + (top - yb) * 0.5], [0, top]], 12, { polar: true, hardAngle: 1.2 });
  }
  b.a2 = 0;
}

/** Adds one obstacle at its world position; cloth flags (flagpole) are appended to `flags`. */
export function buildObstacle(b: MeshBuilder, o: TrackObstacle, index: number, flags: ClothFlag[]): void {
  const yaw = affineRotY(o.yaw);
  b.push(affineMul(affineTranslate(o.pos[0], o.pos[1], o.pos[2]), yaw));
  const saved = b.aoFn;
  switch (o.kind) {
    case 'cone':
      cone(b, o);
      break;
    case 'wall':
      wall(b, o, Math.floor(seeded(index) * 4));
      break;
    case 'rock':
      rock(b, o, index + 11);
      break;
    case 'tree':
      tree(b, o, index + 5);
      break;
    case 'pole':
      pole(b, 0, 0, o.size[1], 0, o.size[0], KIND.POLE);
      break;
    case 'flagpole':
      pole(b, 0, 0, o.size[1], 0, o.size[0], KIND.FLAGPOLE);
      break;
  }
  b.pop();
  b.aoFn = saved;
  if (o.kind === 'flagpole') {
    flags.push({ pos: [o.pos[0], o.pos[1] + o.size[1] - 0.03, o.pos[2]], width: 0.95, height: 0.6, colour: [0.85, 0.04, 0.03], seed: index });
  }
}
