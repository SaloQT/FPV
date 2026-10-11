import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rng } from '../../sim/math3d';
import { OBS_SIZE } from '../spec';
import { DEFAULT_PPO, PpoTrainer } from './ppo';

// A synchronous fake queue captures each submitted compute pass's permutation.
// This checks scheduling/RNG consumption without depending on GPU timings.
function fakeTrainer() {
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 1, MAP_READ: 2 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
  const events: string[] = [], consumed: Uint32Array[] = [];
  const makeBuffer = (size: number) => ({
    size, data: new ArrayBuffer(size),
    mapAsync: async () => { events.push('map'); },
    getMappedRange() { return this.data; },
    unmap() {}, destroy() {},
  });
  type Buffer = ReturnType<typeof makeBuffer>;
  const perm = makeBuffer(256 * 2 * 4);
  const device = {
    createBuffer: ({ size }: { size: number }) => makeBuffer(size),
    createCommandEncoder: () => {
      let compute = false;
      const copies: (() => void)[] = [];
      return {
        beginComputePass: () => { compute = true; return { end() {} }; },
        clearBuffer: (b: Buffer) => copies.push(() => new Uint8Array(b.data).fill(0)),
        copyBufferToBuffer: (a: Buffer, offA: number, b: Buffer, offB: number, n: number) => copies.push(() => new Uint8Array(b.data, offB, n).set(new Uint8Array(a.data, offA, n))),
        finish: () => ({ compute, copies }),
      };
    },
    queue: {
      writeBuffer: (b: Buffer, off: number, data: ArrayBufferView) => {
        events.push(b === perm ? 'permutation' : 'uniform');
        new Uint8Array(b.data, off, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      },
      submit: (commands: { compute: boolean; copies: (() => void)[] }[]) => {
        events.push('submit');
        for (const command of commands) {
          if (command.compute) consumed.push(new Uint32Array(perm.data.slice(0)));
          for (const copy of command.copies) copy();
        }
      },
    },
  };
  const cfg = { ...DEFAULT_PPO, envs: 128, steps: 2, epochs: 2, seed: 7 };
  const obsR = makeBuffer(3 * 128 * OBS_SIZE * 4), params = makeBuffer(16);
  const trainer = Object.assign(Object.create(PpoTrainer.prototype) as object, {
    device, cfg, iteration: 0, envSteps: 0, samples: 256, rng: new Rng(cfg.seed * 7919 + 13),
    perm, permData: new Uint32Array(256 * 2), permutationReady: false,
    lrBuf: makeBuffer(16), metrics: makeBuffer(128), obsR,
    bufs: { obsTmp: makeBuffer(128 * OBS_SIZE * 4), mObs: params, mU: params, mData: params },
    actor: { params, count: 4, grad: params }, critic: { params, grad: params },
    staging: [makeBuffer(256), makeBuffer(256)], stagingIndex: 0,
    profiler: null, pendingInit: null, rollout: [], finish: [], update: [], probeSteps: [],
  }) as unknown as PpoTrainer;
  return { trainer, consumed, events };
}

function expectedPermutations(count: number): Uint32Array[] {
  const rng = new Rng(7 * 7919 + 13);
  return Array.from({ length: count }, () => {
    const p = new Uint32Array(512);
    for (let e = 0; e < 2; e++) {
      const o = e * 256;
      for (let i = 0; i < 256; i++) p[o + i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [p[o + i], p[o + j]] = [p[o + j], p[o + i]];
      }
    }
    return p;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('PPO permutation prefetch', () => {
  it('uploads the future permutation only after submitting current training', async () => {
    const { trainer, events } = fakeTrainer();
    await trainer.iterate();
    expect(events).toEqual(['uniform', 'permutation', 'submit', 'map', 'permutation']);
    events.length = 0;
    await trainer.iterate();
    expect(events).toEqual(['uniform', 'submit', 'map', 'permutation']);
  });

  it('preserves the consumed RNG/permutation sequence when training and gradient probes are interleaved', async () => {
    const { trainer, consumed } = fakeTrainer();
    await trainer.iterate();
    await trainer.probeGradients();
    await trainer.iterate();
    await trainer.iterate();
    await trainer.probeGradients();
    expect(consumed).toEqual(expectedPermutations(5));
  });
});
