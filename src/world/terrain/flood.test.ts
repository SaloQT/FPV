import { describe, expect, it } from 'vitest';
import { FLOOD_EPSILON, FloodWorkspace } from './flood';
import { accumulateFlow } from './hydrology';
import { Noise2D } from './noise';

const N = 64;

function drain(gen: Generator<void>): void {
  while (gen.next().done !== true) {
    // run to completion
  }
}

function rolling(seed: number, n = N): Float32Array {
  const noise = new Noise2D(seed);
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) h[j * n + i] = 30 * noise.simplex(i * 0.09, j * 0.09) + 8 * noise.simplex(i * 0.31 + 50, j * 0.31);
  }
  return h;
}

/** A shallow plateau at 5 with a 4-deep pit in the middle and a low map edge, so the pit only drains after being filled. */
function pitField(): Float32Array {
  const h = new Float32Array(N * N).fill(5);
  for (let k = 0; k < N; k++) {
    h[k] = 1;
    h[(N - 1) * N + k] = 1;
    h[k * N] = 1;
    h[k * N + N - 1] = 1;
  }
  for (let j = 28; j < 36; j++) for (let i = 28; i < 36; i++) h[j * N + i] = 1;
  return h;
}

describe('FloodWorkspace (priority flood with epsilon)', () => {
  it('never lowers a cell and keeps edge cells as they are', () => {
    const h = rolling(1);
    const ws = new FloodWorkspace(N);
    ws.fill(h);
    for (let k = 0; k < h.length; k++) expect(ws.filled[k]).toBeGreaterThanOrEqual(h[k]);
    for (let k = 0; k < N; k++) {
      expect(ws.filled[k]).toBe(h[k]);
      expect(ws.filled[k * N]).toBe(h[k * N]);
    }
  });

  it('fills a pit up to its pour point and leaves the rest of the surface alone', () => {
    const h = pitField();
    const ws = new FloodWorkspace(N);
    ws.fill(h);
    const pit = 32 * N + 32;
    expect(ws.filled[pit]).toBeGreaterThanOrEqual(5);
    expect(ws.filled[pit]).toBeLessThan(5 + 40 * FLOOD_EPSILON);
    expect(ws.filled[10 * N + 10]).toBeGreaterThanOrEqual(5);
  });

  it('pops every cell exactly once, parents before children, in non-decreasing filled height', () => {
    const h = rolling(2);
    const ws = new FloodWorkspace(N);
    ws.fill(h);
    const position = new Int32Array(N * N).fill(-1);
    for (let k = 0; k < ws.order.length; k++) {
      expect(position[ws.order[k]]).toBe(-1);
      position[ws.order[k]] = k;
    }
    for (let id = 0; id < N * N; id++) {
      const r = ws.recv[id];
      if (r < 0) continue;
      expect(position[r]).toBeLessThan(position[id]);
    }
    for (let k = 1; k < ws.order.length; k++) {
      // Barnes' epsilon lifts children above their parent, so pop order is ascending up to that epsilon.
      expect(ws.filled[ws.order[k]]).toBeGreaterThanOrEqual(ws.filled[ws.order[k - 1]] - FLOOD_EPSILON);
    }
  });

  it('gives every interior cell a strictly lower flood parent, so no flats or pits remain', () => {
    const h = rolling(3);
    const ws = new FloodWorkspace(N);
    ws.fill(h);
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const id = j * N + i;
        const r = ws.recv[id];
        expect(r).toBeGreaterThanOrEqual(0);
        expect(ws.filled[r]).toBeLessThan(ws.filled[id]);
        expect(Math.abs((r % N) - i)).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.floor(r / N) - j)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('marks exactly the edge cells as outlets', () => {
    const ws = new FloodWorkspace(N);
    ws.fill(rolling(4));
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const edge = i === 0 || j === 0 || i === N - 1 || j === N - 1;
        expect(ws.recv[j * N + i] === -1).toBe(edge);
      }
    }
  });

  it('gives the same result when the flood is advanced in slices', () => {
    const h = rolling(5);
    const whole = new FloodWorkspace(N);
    whole.fill(h);
    const sliced = new FloodWorkspace(N);
    sliced.begin(h);
    let calls = 0;
    while (!sliced.advance(300)) calls++;
    expect(calls).toBeGreaterThan(5);
    expect(Array.from(sliced.order)).toEqual(Array.from(whole.order));
    expect(Array.from(sliced.filled)).toEqual(Array.from(whole.filled));
    expect(Array.from(sliced.recv)).toEqual(Array.from(whole.recv));
  });
});

describe('accumulateFlow', () => {
  it('conserves drainage: all cells end up in sinks that have no lower neighbour', () => {
    const ws = new FloodWorkspace(N);
    ws.fill(rolling(6));
    const area = new Float32Array(N * N);
    drain(accumulateFlow(ws, area, () => {}));
    let sunk = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const id = j * N + i;
        let lower = false;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ni = i + di;
            const nj = j + dj;
            if ((di === 0 && dj === 0) || ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
            if (ws.filled[nj * N + ni] < ws.filled[id]) lower = true;
          }
        }
        if (!lower) sunk += area[id];
      }
    }
    expect(sunk).toBeCloseTo(N * N, -1);
    for (const a of area) expect(a).toBeGreaterThanOrEqual(1);
  });

  it('concentrates flow in a valley: a V-shaped trough collects the whole map along its floor', () => {
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = 2 * Math.abs(i - N / 2 + 0.5) + 0.05 * (N - 1 - j);
    const ws = new FloodWorkspace(N);
    ws.fill(h);
    const area = new Float32Array(N * N);
    drain(accumulateFlow(ws, area, () => {}));
    const outlet = (N - 1) * N + N / 2;
    const bank = (N - 1) * N + 4;
    expect(area[outlet] + area[outlet - 1]).toBeCloseTo(N * N, -1);
    expect(area[bank]).toBeLessThan(area[outlet] / 10);
  });

  it('reports non-decreasing progress ending at 1 and yields in several slices', () => {
    const ws = new FloodWorkspace(N);
    ws.fill(rolling(7));
    const seen: number[] = [];
    let yields = 0;
    const gen = accumulateFlow(ws, new Float32Array(N * N), (f) => seen.push(f));
    while (gen.next().done !== true) yields++;
    expect(yields).toBeGreaterThanOrEqual(8);
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1]);
    expect(seen[seen.length - 1]).toBeCloseTo(1, 6);
  });
});
