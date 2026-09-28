/**
 * Priority-flood depression filling with epsilon (Barnes, Lehman & Mulla 2014). Besides the filled surface it yields a pop
 * order that is a valid topological order of the drainage (receivers precede donors) and the flood parent of every cell.
 */

/** Height increment between a cell and the cell that flooded it; makes flats and filled pits strictly drain to the outlet. */
export const FLOOD_EPSILON = 1e-3;

export class FloodWorkspace {
  readonly n: number;
  /** Depression-free surface (>= input, strictly decreasing along recv chains). */
  readonly filled: Float32Array;
  /** Cells in ascending filled height; every flood parent precedes its children. */
  readonly order: Int32Array;
  /** Flood parent (a lower or equal neighbour), or -1 for map-edge outlets. */
  readonly recv: Int32Array;
  private readonly closed: Uint8Array;
  private readonly heapKey: Float32Array;
  private readonly heapId: Int32Array;
  private source: Float32Array = new Float32Array(0);
  private size = 0;
  private count = 0;

  constructor(n: number) {
    this.n = n;
    const cells = n * n;
    this.filled = new Float32Array(cells);
    this.order = new Int32Array(cells);
    this.recv = new Int32Array(cells);
    this.closed = new Uint8Array(cells);
    this.heapKey = new Float32Array(cells);
    this.heapId = new Int32Array(cells);
  }

  fill(height: Float32Array): void {
    this.begin(height);
    this.advance(Infinity);
  }

  /** Seeds the flood from the map edge; follow with `advance` until it reports completion. Lets callers slice the work. */
  begin(height: Float32Array): void {
    const n = this.n;
    const { filled, recv, closed, heapKey, heapId } = this;
    this.source = height;
    closed.fill(0);
    let size = 0;

    for (let j = 0; j < n; j++) {
      const edgeRow = j === 0 || j === n - 1;
      for (let i = 0; i < n; i += edgeRow ? 1 : n - 1) {
        const id = j * n + i;
        closed[id] = 1;
        filled[id] = height[id];
        recv[id] = -1;
        let p = size++;
        const key = height[id];
        while (p > 0) {
          const q = (p - 1) >> 1;
          if (heapKey[q] <= key) break;
          heapKey[p] = heapKey[q];
          heapId[p] = heapId[q];
          p = q;
        }
        heapKey[p] = key;
        heapId[p] = id;
      }
    }
    this.size = size;
    this.count = 0;
  }

  /** Pops up to `budget` cells; returns true once the whole map is flooded. */
  advance(budget: number): boolean {
    const n = this.n;
    const { filled, order, recv, closed, heapKey, heapId, source: height } = this;
    let size = this.size;
    let count = this.count;
    const stop = count + budget;
    const mask = n - 1;
    const shift = Math.round(Math.log2(n));
    while (size > 0 && count < stop) {
      const id = heapId[0];
      const fk = heapKey[0];
      size--;
      if (size > 0) {
        const key = heapKey[size];
        const val = heapId[size];
        let p = 0;
        for (;;) {
          let c = 2 * p + 1;
          if (c >= size) break;
          if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c++;
          if (heapKey[c] >= key) break;
          heapKey[p] = heapKey[c];
          heapId[p] = heapId[c];
          p = c;
        }
        heapKey[p] = key;
        heapId[p] = val;
      }
      order[count++] = id;

      const ci = id & mask;
      const cj = id >>> shift;
      const j0 = cj > 0 ? cj - 1 : 0;
      const j1 = cj < n - 1 ? cj + 1 : n - 1;
      const i0 = ci > 0 ? ci - 1 : 0;
      const i1 = ci < n - 1 ? ci + 1 : n - 1;
      for (let nj = j0; nj <= j1; nj++) {
        for (let ni = i0; ni <= i1; ni++) {
          const nb = (nj << shift) + ni;
          if (closed[nb] === 1) continue;
          closed[nb] = 1;
          recv[nb] = id;
          const h = height[nb];
          const lifted = fk + FLOOD_EPSILON;
          const key = h > lifted ? h : lifted;
          filled[nb] = key;
          let p = size++;
          while (p > 0) {
            const q = (p - 1) >> 1;
            if (heapKey[q] <= key) break;
            heapKey[p] = heapKey[q];
            heapId[p] = heapId[q];
            p = q;
          }
          heapKey[p] = key;
          heapId[p] = nb;
        }
      }
    }
    this.size = size;
    this.count = count;
    return size === 0;
  }
}
