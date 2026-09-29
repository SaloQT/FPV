/** Smooth polylines for the wires and the antenna. */
import type { Vec3 } from '../../contracts';

/** Uniform Catmull-Rom through `pts`, `per` samples per span; the end points are kept exactly. */
export function catmullRom(pts: readonly Vec3[], per: number): Vec3[] {
  const out: Vec3[] = [];
  const last = pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(last, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a: number): number =>
        0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3);
      out.push([at(0), at(1), at(2)]);
    }
  }
  out.push([pts[last][0], pts[last][1], pts[last][2]]);
  return out;
}
