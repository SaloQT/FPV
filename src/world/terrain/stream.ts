/**
 * Stream-power fluvial erosion (dh/dt = U - K A^0.5 S) solved with the implicit scheme of Braun & Willett (2013): each
 * cell is relaxed toward its receiver in upstream order, which is unconditionally stable for any K dt. Carves the large,
 * dendritic valley networks that short-lived droplets cannot; droplets then add gullies and sediment on top.
 */
import { FloodWorkspace } from './flood';

export interface StreamParams {
  iterations: number;
  /** Dimensionless K*dt: cell relaxation factor is k * erodibility * sqrt(upstream cells) / step length in cells. */
  k: number;
  /** Explicit hillslope diffusion coefficient per iteration (<= 0.2), softens the trench walls. */
  diffusion: number;
  /** Height drop (metres) between the outermost interior cells and the map edge, which keeps the boundary an open outlet. */
  edgeDrop: number;
}

const SQRT2 = Math.SQRT2;

export function* streamPowerErode(
  h: Float32Array,
  n: number,
  uplift: Float32Array,
  erodibility: Float32Array,
  p: StreamParams,
  report: (fraction: number) => void,
): Generator<void> {
  const cells = n * n;
  const ws = new FloodWorkspace(n);
  const area = new Float32Array(cells);
  const tmp = p.diffusion > 0 ? new Float32Array(cells) : null;
  const { order, recv } = ws;

  for (let it = 0; it < p.iterations; it++) {
    openBoundary(h, n, p.edgeDrop);
    ws.fill(h);
    area.fill(1);
    for (let k = cells - 1; k > 0; k--) {
      const id = order[k];
      const r = recv[id];
      if (r >= 0) area[r] += area[id];
    }
    for (let k = 0; k < cells; k++) {
      const id = order[k];
      const r = recv[id];
      if (r < 0) continue;
      const diff = id - r;
      const step = diff === 1 || diff === -1 || diff === n || diff === -n ? 1 : SQRT2;
      const f = (p.k * erodibility[id] * Math.sqrt(area[id])) / step;
      h[id] = (h[id] + uplift[id] + f * h[r]) / (1 + f);
    }
    if (tmp !== null) diffuse(h, tmp, n, p.diffusion);
    report((it + 1) / p.iterations);
    yield;
  }
}

function diffuse(h: Float32Array, tmp: Float32Array, n: number, kd: number): void {
  tmp.set(h);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1, id = j * n + 1; i < n - 1; i++, id++) {
      tmp[id] = h[id] + kd * (h[id - 1] + h[id + 1] + h[id - n] + h[id + n] - 4 * h[id]);
    }
  }
  h.set(tmp);
}

/** Edge cells follow their inner neighbour, so no rim builds up and every edge cell is a gentle outlet. */
function openBoundary(h: Float32Array, n: number, drop: number): void {
  const last = n - 1;
  for (let i = 1; i < last; i++) {
    h[i] = h[n + i] - drop;
    h[last * n + i] = h[(last - 1) * n + i] - drop;
  }
  for (let j = 1; j < last; j++) {
    h[j * n] = h[j * n + 1] - drop;
    h[j * n + last] = h[j * n + last - 1] - drop;
  }
  h[0] = h[n + 1] - 1.5 * drop;
  h[last] = h[n + last - 1] - 1.5 * drop;
  h[last * n] = h[(last - 1) * n + 1] - 1.5 * drop;
  h[last * n + last] = h[(last - 1) * n + last - 1] - 1.5 * drop;
}
