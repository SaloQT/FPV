/**
 * Multiple-flow-direction drainage accumulation (Freeman 1991) on a priority-flooded surface. Spreading each cell's water
 * over all lower neighbours in proportion to slope^p gives smooth hillslope divergence and sharp valley convergence,
 * without the grid-aligned streaks of single-direction (D8) routing.
 */
import { FloodWorkspace } from './flood';

/** The pass yields to the caller 16 times, so progress stays smooth on big maps. */
const SLICES_SHIFT = 4;
const NEIGHBOUR_DX = Int32Array.of(-1, 0, 1, -1, 1, -1, 0, 1);
const NEIGHBOUR_DY = Int32Array.of(-1, -1, -1, 0, 0, 1, 1, 1);
const NEIGHBOUR_INV_DIST = Float32Array.of(1 / Math.SQRT2, 1, 1 / Math.SQRT2, 1, 1, 1 / Math.SQRT2, 1, 1 / Math.SQRT2);

/**
 * Fills `area` with the number of upstream cells (self included) draining through each cell. `ws` must already hold the
 * fill of the surface; a cell only donates to strictly lower neighbours, all of which precede it in pop order.
 */
export function* accumulateFlow(ws: FloodWorkspace, area: Float32Array, report: (fraction: number) => void): Generator<void> {
  const cells = ws.n * ws.n;
  const slice = cells >> SLICES_SHIFT;
  area.fill(1);
  for (let end = cells; end > 0; end -= slice) {
    const from = Math.max(end - slice, 0);
    distribute(ws, area, from, end);
    report((cells - from) / cells);
    yield;
  }
}

function distribute(ws: FloodWorkspace, area: Float32Array, from: number, to: number): void {
  const n = ws.n;
  const { filled, order } = ws;
  const shift = Math.round(Math.log2(n));
  const mask = n - 1;
  const share = new Float32Array(8);

  for (let k = to - 1; k >= from; k--) {
    const id = order[k];
    const ci = id & mask;
    const cj = id >>> shift;
    const h = filled[id];
    let total = 0;
    for (let d = 0; d < 8; d++) {
      const ni = ci + NEIGHBOUR_DX[d];
      const nj = cj + NEIGHBOUR_DY[d];
      let w = 0;
      if (ni >= 0 && nj >= 0 && ni < n && nj < n) {
        const drop = (h - filled[(nj << shift) + ni]) * NEIGHBOUR_INV_DIST[d];
        if (drop > 0) w = drop * Math.sqrt(drop);
      }
      share[d] = w;
      total += w;
    }
    if (total <= 0) continue;
    const scale = area[id] / total;
    for (let d = 0; d < 8; d++) {
      const w = share[d];
      if (w > 0) area[((cj + NEIGHBOUR_DY[d]) << shift) + ci + NEIGHBOUR_DX[d]] += w * scale;
    }
  }
}
