// Hillshaded terrain image for the top-down views: height tint (lowland green to rock grey to snow) times a light from the
// north-west, water in blue. Pure: returns RGBA bytes for an n x n grid.

const TINT = [
  [0, [52, 74, 46]],
  [0.35, [86, 98, 60]],
  [0.65, [112, 104, 92]],
  [0.85, [150, 146, 140]],
  [1, [214, 214, 218]],
];

function tint(f) {
  const x = Math.min(Math.max(f, 0), 1);
  for (let k = 1; k < TINT.length; k++) {
    if (x <= TINT[k][0]) {
      const [a0, ca] = TINT[k - 1];
      const [a1, cb] = TINT[k];
      const s = (x - a0) / (a1 - a0);
      return [ca[0] + (cb[0] - ca[0]) * s, ca[1] + (cb[1] - ca[1]) * s, ca[2] + (cb[2] - ca[2]) * s];
    }
  }
  return TINT[TINT.length - 1][1];
}

/** RGBA for terrain { n, step, height, min, max, water }; `exaggerate` steepens the shading of gentle maps. */
export function hillshade(terrain, exaggerate = 2) {
  const { n, step, height, min, max } = terrain;
  const water = terrain.water ?? -Infinity;
  const out = new Uint8ClampedArray(n * n * 4);
  const range = Math.max(max - min, 1);
  // Light from the north-west (screen up-left: -x, -z), 45 degrees up.
  const lx = -Math.SQRT1_2 * Math.SQRT1_2, ly = Math.SQRT1_2, lz = -Math.SQRT1_2 * Math.SQRT1_2;
  const h = (i, j) => height[Math.min(Math.max(j, 0), n - 1) * n + Math.min(Math.max(i, 0), n - 1)];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = h(i, j);
      const dx = ((h(i + 1, j) - h(i - 1, j)) / (2 * step)) * exaggerate;
      const dz = ((h(i, j + 1) - h(i, j - 1)) / (2 * step)) * exaggerate;
      // Normal of the surface y = h(x, z): (-dx, 1, -dz), normalised.
      const inv = 1 / Math.hypot(dx, 1, dz);
      const shade = Math.max(0, (-dx * lx + ly - dz * lz) * inv);
      const o = (j * n + i) * 4;
      if (v < water) {
        const d = Math.min((water - v) / 12, 1);
        out[o] = 34 - 14 * d; out[o + 1] = 70 - 24 * d; out[o + 2] = 112 - 20 * d; out[o + 3] = 255;
        continue;
      }
      const c = tint((v - min) / range);
      const k = 0.3 + 0.75 * shade;
      out[o] = c[0] * k; out[o + 1] = c[1] * k; out[o + 2] = c[2] * k; out[o + 3] = 255;
    }
  }
  return out;
}

/** Ground height of the downsampled grid at world (x, z), bilinear, clamped at the border. */
export function gridHeight(terrain, x, z) {
  const { n, step, height, origin } = terrain;
  const fx = Math.min(Math.max((x - origin[0]) / step, 0), n - 1);
  const fz = Math.min(Math.max((z - origin[1]) / step, 0), n - 1);
  const i = Math.min(Math.floor(fx), n - 2), j = Math.min(Math.floor(fz), n - 2);
  const a = fx - i, b = fz - j;
  const h00 = height[j * n + i], h10 = height[j * n + i + 1], h01 = height[(j + 1) * n + i], h11 = height[(j + 1) * n + i + 1];
  return (h00 * (1 - a) + h10 * a) * (1 - b) + (h01 * (1 - a) + h11 * a) * b;
}

/** World-space bounds of what matters on a world's map: path, gates, start and obstacles, padded. */
export function trackBounds(world, pad = 30) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const take = (x, z) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; };
  for (const p of world.path) take(p[0], p[2]);
  for (const g of world.gates) take(g.pos[0], g.pos[2]);
  take(world.start.pos[0], world.start.pos[2]);
  if (!Number.isFinite(x0)) { const t = world.terrain; const e = (t.n - 1) * t.step; return { x0: t.origin[0], z0: t.origin[1], x1: t.origin[0] + e, z1: t.origin[1] + e }; }
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
}
