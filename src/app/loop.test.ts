import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { present, simulate } from './frame';
import { createLoop } from './loop';
import type { AppCtx } from './state';

vi.mock('./frame', () => ({ simulate: vi.fn(), present: vi.fn() }));
vi.mock('./failure', () => ({ failApp: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('live loop GPU backpressure', () => {
  it('waits for GPU readiness, then samples current input with the full elapsed time', () => {
    let tick!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
    const state = {
      hidden: false, busy: false, latestInput: 0,
      renderer: { frameReady: true, displayPeriodMs: 1000 / 60 },
      store: { get: () => ({ frameCap: 0 }) },
    };
    const inputs: number[] = [];
    vi.mocked(simulate).mockImplementation(() => { inputs.push(state.latestInput); });
    const loop = createLoop(state as unknown as AppCtx);
    loop.start();
    tick(100);
    state.renderer.frameReady = false;
    state.latestInput = 1;
    tick(116);
    state.latestInput = 2;
    tick(132);
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledTimes(1);
    state.renderer.frameReady = true;
    tick(150);
    expect(inputs).toEqual([0, 2]);
    expect(simulate).toHaveBeenLastCalledWith(state, 0.05);
    expect(present).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});
