/** Camera-facing glow ribbons along LED strips: two vertices per strip point, expanded in the vertex shader. */
import type { GlowStrip } from './gateMeshes';
import type { MeshData } from './meshBuilder';

/** pos3, tangent3, side, gate index. */
export const GLOW_FLOATS = 8;
export const GLOW_STRIDE = GLOW_FLOATS * 4;

export function buildGlowMesh(strips: readonly GlowStrip[]): MeshData {
  let points = 0;
  let segments = 0;
  for (const s of strips) {
    points += s.pts.length;
    segments += Math.max(0, s.pts.length - 1);
  }
  const vertices = new Float32Array(points * 2 * GLOW_FLOATS);
  const indices = new Uint32Array(segments * 6);
  let v = 0;
  let i = 0;
  for (const s of strips) {
    const n = s.pts.length;
    const first = v;
    for (let k = 0; k < n; k++) {
      const a = s.pts[Math.max(0, k - 1)];
      const c = s.pts[Math.min(n - 1, k + 1)];
      const tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      for (const side of [-1, 1]) {
        vertices.set([s.pts[k][0], s.pts[k][1], s.pts[k][2], tx / tl, ty / tl, tz / tl, side, s.gate], v * GLOW_FLOATS);
        v++;
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const a = first + k * 2;
      indices.set([a, a + 1, a + 3, a, a + 3, a + 2], i);
      i += 6;
    }
  }
  return { vertices, indices };
}
