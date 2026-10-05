/**
 * Particle-based hydraulic erosion (Beyer 2015). Each droplet rolls downhill with inertia, picks up sediment up to a
 * slope/speed/water dependent capacity through a smooth brush, and deposits it bilinearly when it slows or climbs.
 * Heights and gradients are bilinear on the current map; steps are one cell long.
 */

export interface DropletParams {
  droplets: number;
  lifetime: number;
  inertia: number;
  capacity: number;
  minSlope: number;
  erodeSpeed: number;
  depositSpeed: number;
  evaporation: number;
  gravity: number;
  /** Erosion brush radius in cells. */
  radius: number;
}

export interface Brush {
  offset: Int32Array;
  dx: Int32Array;
  dy: Int32Array;
  weight: Float32Array;
  radius: number;
}

/** Cone-weighted disc brush: weight = radius - distance for distance < radius, normalised to sum 1. */
export function makeBrush(radius: number, n: number): Brush {
  const dx: number[] = [];
  const dy: number[] = [];
  const w: number[] = [];
  let sum = 0;
  const r = Math.ceil(radius);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d >= radius) continue;
      dx.push(x);
      dy.push(y);
      w.push(radius - d);
      sum += radius - d;
    }
  }
  return {
    offset: Int32Array.from(dx.map((x, k) => dy[k] * n + x)),
    dx: Int32Array.from(dx),
    dy: Int32Array.from(dy),
    weight: Float32Array.from(w.map((v) => v / sum)),
    radius: r,
  };
}

/** Anything with a uniform `next()` in [0, 1). */
export interface Uniform {
  next(): number;
}

/** A pass runs in about 64 batches (progress and event-loop hand-backs), each clamped to 128..8192 droplets. */
const MAX_BATCH = 8192;
const MIN_BATCH = 128;
const BATCHES_PER_PASS = 64;

/**
 * Runs `p.droplets` droplets on the n x n map `h` in place. `visits` (optional) accumulates the water carried through each
 * cell. Yields between batches so callers can report progress or hand control back to an event loop.
 */
export function* erodeDroplets(
  h: Float32Array,
  n: number,
  p: DropletParams,
  rng: Uniform,
  visits: Float32Array | null,
  report: (fraction: number) => void,
): Generator<void> {
  const brush = makeBrush(p.radius, n);
  const { offset, dx: bdx, dy: bdy, weight } = brush;
  const bn = weight.length;
  const br = brush.radius;
  const inertia = p.inertia;
  const span = n - 3;

  const batch = Math.min(MAX_BATCH, Math.max(MIN_BATCH, Math.ceil(p.droplets / BATCHES_PER_PASS)));
  for (let done = 0; done < p.droplets; ) {
    const end = Math.min(p.droplets, done + batch);
    for (; done < end; done++) {
      let px = 1 + rng.next() * span;
      let py = 1 + rng.next() * span;
      let dirX = 0;
      let dirY = 0;
      let speed = 1;
      let water = 1;
      let sediment = 0;

      for (let life = 0; life < p.lifetime; life++) {
        const nx = px | 0;
        const ny = py | 0;
        const idx = ny * n + nx;
        const fx = px - nx;
        const fy = py - ny;
        const h00 = h[idx];
        const h10 = h[idx + 1];
        const h01 = h[idx + n];
        const h11 = h[idx + n + 1];
        const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
        const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
        const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
        if (visits !== null) visits[idx] += water;

        dirX = dirX * inertia - gx * (1 - inertia);
        dirY = dirY * inertia - gy * (1 - inertia);
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len < 1e-9) break;
        dirX /= len;
        dirY /= len;
        px += dirX;
        py += dirY;
        if (px < 1 || px >= n - 2 || py < 1 || py >= n - 2) break;

        const mx = px | 0;
        const my = py | 0;
        const mi = my * n + mx;
        const ux = px - mx;
        const uy = py - my;
        const hNew =
          h[mi] * (1 - ux) * (1 - uy) + h[mi + 1] * ux * (1 - uy) + h[mi + n] * (1 - ux) * uy + h[mi + n + 1] * ux * uy;
        const dh = hNew - hOld;
        const cap = Math.max(-dh, p.minSlope) * speed * water * p.capacity;

        if (sediment > cap || dh > 0) {
          const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * p.depositSpeed;
          sediment -= amount;
          if (amount !== 0) {
            h[idx] += amount * (1 - fx) * (1 - fy);
            h[idx + 1] += amount * fx * (1 - fy);
            h[idx + n] += amount * (1 - fx) * fy;
            h[idx + n + 1] += amount * fx * fy;
          }
        } else {
          const amount = Math.min((cap - sediment) * p.erodeSpeed, -dh);
          // Stalled droplets can have zero capacity. Avoid touching the whole brush when no material moves.
          if (amount === 0) {
            // Keep moving and recording visits; only the no-op height updates are skipped.
          } else if (nx >= br && ny >= br && nx < n - br && ny < n - br) {
            for (let k = 0; k < bn; k++) h[idx + offset[k]] -= amount * weight[k];
            sediment += amount;
          } else {
            for (let k = 0; k < bn; k++) {
              const cx = nx + bdx[k];
              const cy = ny + bdy[k];
              if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
              const e = amount * weight[k];
              h[cy * n + cx] -= e;
              sediment += e;
            }
          }
        }
        speed = Math.sqrt(Math.max(0, speed * speed + dh * p.gravity));
        water *= 1 - p.evaporation;
      }
    }
    report(done / p.droplets);
    yield;
  }
}
