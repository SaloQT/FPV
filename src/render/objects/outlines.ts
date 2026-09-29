/** 2D outlines (x, z) for flat plates. */
import type { Pt } from './polygon';

/** Counter-clockwise rectangle with rounded corners, `seg` arc segments per corner. */
export function roundedRect(cx: number, cz: number, hx: number, hz: number, r: number, seg = 4): Pt[] {
  const pts: Pt[] = [];
  const corners: Pt[] = [[hx - r, hz - r], [-(hx - r), hz - r], [-(hx - r), -(hz - r)], [hx - r, -(hz - r)]];
  for (let c = 0; c < 4; c++) {
    for (let k = 0; k <= seg; k++) {
      const a = ((c + k / seg) * Math.PI) / 2;
      pts.push([cx + corners[c][0] + r * Math.cos(a), cz + corners[c][1] + r * Math.sin(a)]);
    }
  }
  return pts;
}

export function circleOutline(cx: number, cz: number, r: number, n: number): Pt[] {
  return Array.from({ length: n }, (_, i): Pt => [cx + r * Math.cos((i / n) * Math.PI * 2), cz + r * Math.sin((i / n) * Math.PI * 2)]);
}
