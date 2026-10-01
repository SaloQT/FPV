import { describe, expect, it } from 'vitest';
import { estimateRefreshHz, measureRefresh, RefreshMeter, snapRefreshHz, summariseRefresh, type MeasureHost } from './refresh';

function ramp(hz: number, n: number, jitter = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(1000 / hz + (((i * 37) % 11) - 5) * jitter);
  return out;
}

describe('snapRefreshHz', () => {
  it('snaps noisy measurements to the common rates', () => {
    expect(snapRefreshHz(59.6)).toBe(60);
    expect(snapRefreshHz(143.1)).toBe(144);
    expect(snapRefreshHz(164.2)).toBe(165);
    expect(snapRefreshHz(238)).toBe(240);
    expect(snapRefreshHz(75.4)).toBe(75);
    expect(snapRefreshHz(359)).toBe(360);
  });

  it('keeps an unusual rate (rounded) instead of forcing it onto a common one', () => {
    expect(snapRefreshHz(110.2)).toBe(110);
    expect(snapRefreshHz(30)).toBe(30);
  });
});

describe('estimateRefreshHz', () => {
  it('recovers the rate from jittered intervals', () => {
    expect(estimateRefreshHz(ramp(144, 60, 0.05))).toBeGreaterThan(140);
    expect(estimateRefreshHz(ramp(144, 60, 0.05))).toBeLessThan(148);
    expect(estimateRefreshHz(ramp(60, 60, 0.1))).toBeCloseTo(60, 0);
  });

  it('ignores missed refreshes and hitches (only ever longer intervals)', () => {
    const a = ramp(240, 60);
    for (let i = 0; i < 60; i += 4) a[i] = 2000 / 240;
    for (let i = 1; i < 60; i += 17) a[i] = 90;
    expect(Math.round(estimateRefreshHz(a))).toBe(240);
  });

  it('refuses to guess from too few samples or nonsense', () => {
    expect(estimateRefreshHz(ramp(60, 10))).toBe(0);
    expect(estimateRefreshHz(new Array<number>(40).fill(0))).toBe(0);
  });
});

describe('summariseRefresh', () => {
  it('falls back to 60 Hz and says so when nothing was measured', () => {
    const r = summariseRefresh([]);
    expect(r).toMatchObject({ hz: 60, source: 'fallback', rawHz: 0 });
  });

  it('reports the snapped and the raw rate', () => {
    const r = summariseRefresh(ramp(165, 60, 0.04));
    expect(r.hz).toBe(165);
    expect(r.source).toBe('measured');
    expect(Math.abs(r.rawHz - 165)).toBeLessThan(4);
  });
});

describe('RefreshMeter', () => {
  it('skips the settling intervals and is done after 60 usable ones', () => {
    const m = new RefreshMeter();
    let t = 100;
    for (let i = 0; i < 64; i++) { m.push(t); t += 1000 / 120; }
    expect(m.done).toBe(false);
    for (let i = 0; i < 6; i++) { m.push(t); t += 1000 / 120; }
    expect(m.done).toBe(true);
    expect(m.result().hz).toBe(120);
  });
});

describe('measureRefresh', () => {
  function fakeHost(periodMs: number, hiddenAfter = Infinity): MeasureHost {
    let t = 0;
    let n = 0;
    let pending: ((t: number) => void) | null = null;
    const host: MeasureHost = {
      raf(cb) { pending = cb; queueMicrotask(() => { const p = pending; pending = null; n++; t += periodMs; p?.(t); }); return n; },
      cancel() { pending = null; },
      hidden: () => n > hiddenAfter,
      now: () => t,
    };
    return host;
  }

  it('measures a 144 Hz display', async () => {
    expect(await measureRefresh(fakeHost(1000 / 144))).toMatchObject({ hz: 144, source: 'measured' });
  });

  it('falls back when the tab is hidden during the measurement', async () => {
    expect(await measureRefresh(fakeHost(1000 / 144, 10))).toMatchObject({ hz: 60, source: 'fallback' });
  });

  it('does not hang when no animation frame ever arrives (hidden tab)', async () => {
    const host: MeasureHost = { raf: () => 1, cancel: () => undefined, hidden: () => true, now: () => 0 };
    const started = Date.now();
    const r = await measureRefresh(host);
    expect(r).toMatchObject({ source: 'fallback', hz: 60 });
    expect(Date.now() - started).toBeLessThan(4500);
  }, 8000);

  it('falls back when frames arrive too slowly to measure (timeout)', async () => {
    expect(await measureRefresh(fakeHost(1000))).toMatchObject({ source: 'fallback' });
  });
});
