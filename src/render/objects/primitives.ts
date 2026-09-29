/** Solid primitives written into a MeshBuilder: chamfered box, surface of revolution, parametric surface, ellipsoid. */
import type { Vec3 } from '../../contracts';
import type { MeshBuilder } from './meshBuilder';

const AXES: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function at(c: Vec3, along: number, a: number, sa: number, va: number, b: number, sb: number, vb: number): Vec3 {
  const p: Vec3 = [c[0], c[1], c[2]];
  p[a] += sa * va;
  p[b] += sb * vb;
  p[3 - a - b] += along;
  return p;
}

/**
 * Axis-aligned box centred at `c` with half extents `h`. A positive `e` chamfers every edge and corner with blended normals so it
 * catches a soft highlight; `e` must stay below the smallest half extent.
 */
export function bevelBox(b: MeshBuilder, c: Vec3, h: Vec3, e = 0): void {
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      const p = (a + 1) % 3;
      const q = (a + 2) % 3;
      const n: Vec3 = [AXES[a][0] * s, AXES[a][1] * s, AXES[a][2] * s];
      const ids: number[] = [];
      for (const [sp, sq] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const pos: Vec3 = [c[0], c[1], c[2]];
        pos[a] += s * h[a];
        pos[p] += sp * (h[p] - e);
        pos[q] += sq * (h[q] - e);
        const up = sp * (h[p] - e);
        const uq = sq * (h[q] - e);
        // uv follows the face's visible axes: x-facing (z, y), y-facing (x, z), z-facing (x, y), so y is always up on walls.
        ids.push(b.vertex(pos, n, a === 2 ? up : uq, a === 2 ? uq : up));
      }
      b.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  if (e <= 0) return;
  for (let a = 0; a < 3; a++) {
    for (let bb = a + 1; bb < 3; bb++) {
      const t = 3 - a - bb;
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          const na: Vec3 = [AXES[a][0] * sa, AXES[a][1] * sa, AXES[a][2] * sa];
          const nb: Vec3 = [AXES[bb][0] * sb, AXES[bb][1] * sb, AXES[bb][2] * sb];
          const ids: number[] = [];
          for (const along of [-(h[t] - e), h[t] - e]) {
            ids.push(b.vertex(at(c, along, a, sa, h[a], bb, sb, h[bb] - e), na, along, 0));
            ids.push(b.vertex(at(c, along, a, sa, h[a] - e, bb, sb, h[bb]), nb, along, e));
          }
          b.quad(ids[0], ids[1], ids[3], ids[2]);
        }
      }
    }
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s = [sx, sy, sz];
        const ids: number[] = [];
        for (let a = 0; a < 3; a++) {
          const pos: Vec3 = [c[0] + s[0] * (h[0] - e), c[1] + s[1] * (h[1] - e), c[2] + s[2] * (h[2] - e)];
          pos[a] += s[a] * e;
          ids.push(b.vertex(pos, [AXES[a][0] * s[a], AXES[a][1] * s[a], AXES[a][2] * s[a]], 0, 0));
        }
        b.tri(ids[0], ids[1], ids[2]);
      }
    }
  }
}

export interface LatheOptions {
  /** Profile turns sharper than this (radians) keep a crease; gentler ones are smoothed. */
  hardAngle?: number;
  /** 'polar': uv = (angle in radians, y), used by shaders that carve slots by angle. Default is metric (arc length, profile length). */
  polar?: boolean;
  /** Start angle (radians) and sweep (radians, default a full turn). */
  startAngle?: number;
  sweep?: number;
}

/**
 * Surface of revolution about +Y. `profile` is a list of [radius, y] points; travelling upward with the surface on your right
 * gives outward normals, so a cylinder wall goes bottom to top and a top cap goes from the rim inward.
 */
export function lathe(b: MeshBuilder, profile: readonly (readonly [number, number])[], segments: number, o: LatheOptions = {}): void {
  const cosHard = Math.cos(o.hardAngle ?? 0.7);
  const start = o.startAngle ?? 0;
  const sweep = o.sweep ?? Math.PI * 2;
  const n = profile.length;
  const segN: [number, number][] = [];
  const segLen: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0];
    const dy = profile[i + 1][1] - profile[i][1];
    const len = Math.hypot(dr, dy) || 1;
    segN.push([dy / len, -dr / len]);
    segLen.push(len);
  }
  // rings[i] = [end-of-segment-(i-1) ring, start-of-segment-i ring], each holding (segments + 1) vertex ids.
  const rings: [number[], number[]][] = [];
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const nPrev = i > 0 ? segN[i - 1] : segN[0];
    const nNext = i < n - 1 ? segN[i] : segN[n - 2];
    const smooth = i > 0 && i < n - 1 && nPrev[0] * nNext[0] + nPrev[1] * nNext[1] > cosHard;
    const avg: [number, number] = [nPrev[0] + nNext[0], nPrev[1] + nNext[1]];
    const al = Math.hypot(avg[0], avg[1]) || 1;
    const make = (nn: [number, number]): number[] => {
      const ids: number[] = [];
      for (let k = 0; k <= segments; k++) {
        const th = start + (sweep * k) / segments;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const r = profile[i][0];
        ids.push(b.vertex([r * cs, profile[i][1], r * sn], [nn[0] * cs, nn[1], nn[0] * sn], o.polar ? th : th * r, o.polar ? profile[i][1] : arc));
      }
      return ids;
    };
    const a = make(smooth ? [avg[0] / al, avg[1] / al] : nPrev);
    rings.push([a, smooth || i === 0 || i === n - 1 ? a : make(nNext)]);
    if (i < n - 1) arc += segLen[i];
  }
  for (let i = 0; i < n - 1; i++) {
    const lo = rings[i][1];
    const hi = rings[i + 1][0];
    for (let k = 0; k < segments; k++) b.quad(lo[k], lo[k + 1], hi[k + 1], hi[k]);
  }
}

export interface SurfaceOptions {
  /** The first and last column of the grid are the same seam. */
  wrapU?: boolean;
  /** Analytic normal (u, v, position); default is the numeric derivative of `fn`. */
  normalFn?: (u: number, v: number, p: Vec3) => Vec3;
  uvScale?: [number, number];
}

/** Parametric surface fn(u, v) over the unit square sampled on an nu x nv grid, with normals from finite differences. */
export function surface(b: MeshBuilder, fn: (u: number, v: number) => Vec3, nu: number, nv: number, o: SurfaceOptions = {}): void {
  const eu = 0.25 / nu;
  const ev = 0.25 / nv;
  const [su, sv] = o.uvScale ?? [1, 1];
  const ids: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const p = fn(u, v);
      let n: Vec3;
      if (o.normalFn) n = o.normalFn(u, v, p);
      else {
        // Derivatives are taken slightly inside the v range so the two poles of a sphere-like grid keep a usable normal.
        const vc = Math.min(Math.max(v, ev), 1 - ev);
        const pu0 = fn(Math.max(u - eu, o.wrapU ? -1 : 0), vc), pu1 = fn(Math.min(u + eu, o.wrapU ? 2 : 1), vc);
        const pv0 = fn(u, Math.max(vc - ev, 0)), pv1 = fn(u, Math.min(vc + ev, 1));
        const du: Vec3 = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
        const dv: Vec3 = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
        n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
      }
      ids.push(b.vertex(p, n, u * su, v * sv));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const k = j * (nu + 1) + i;
      b.quad(ids[k], ids[k + 1], ids[k + nu + 2], ids[k + nu + 1]);
    }
  }
}

/** Ellipsoid with analytic normals; `nu` around, `nv` from pole to pole. */
export function ellipsoid(b: MeshBuilder, c: Vec3, r: Vec3, nu = 16, nv = 10): void {
  surface(
    b,
    (u, v) => {
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      return [c[0] + r[0] * Math.sin(ph) * Math.cos(th), c[1] + r[1] * Math.cos(ph), c[2] + r[2] * Math.sin(ph) * Math.sin(th)];
    },
    nu,
    nv,
    {
      wrapU: true,
      normalFn: (u, v) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI;
        return [(Math.sin(ph) * Math.cos(th)) / r[0], Math.cos(ph) / r[1], (Math.sin(ph) * Math.sin(th)) / r[2]];
      },
    },
  );
}
