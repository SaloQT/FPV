import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../../contracts';
import { CUT_ANGLE_RAD, CUT_DISTANCE_M, createHistoryTracker, frameContinuous, isCameraCut, pickResolved, quatAngle, sanitizeDebug } from './index';

const ID: Quat = [0, 0, 0, 1];
const O: Vec3 = [0, 0, 0];
const yaw = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

describe('sanitizeDebug', () => {
  it('keeps the known modes and maps everything else to 0', () => {
    expect([0, 1, 2, 3].map(sanitizeDebug)).toEqual([0, 1, 2, 3]);
    expect([-1, 4, 1.5, NaN, Infinity].map(sanitizeDebug)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('pickResolved', () => {
  it('feeds the composite the raw render-res image only in debug mode 1', () => {
    expect(pickResolved(1, 'taa', 'raw')).toBe('raw');
    for (const m of [0, 2, 3] as const) expect(pickResolved(m, 'taa', 'raw')).toBe('taa');
  });
});

describe('frameContinuous', () => {
  it('accepts the next frame and a same-frame re-encode only', () => {
    expect(frameContinuous(10, 11)).toBe(true);
    expect(frameContinuous(10, 10)).toBe(true);
    expect(frameContinuous(10, 12)).toBe(false);
    expect(frameContinuous(10, 9)).toBe(false);
    expect(frameContinuous(10, 0)).toBe(false);
  });
});

describe('quatAngle / isCameraCut', () => {
  it('measures the rotation angle, sign-invariant', () => {
    expect(quatAngle(ID, yaw(0.5))).toBeCloseTo(0.5, 6);
    expect(quatAngle(ID, [0, -yaw(0.5)[1], 0, -yaw(0.5)[3]])).toBeCloseTo(0.5, 6);
    expect(quatAngle(ID, ID)).toBe(0);
  });

  it('flags a teleport and a half-turn but not fast flight', () => {
    expect(isCameraCut(O, ID, [CUT_DISTANCE_M - 1, 0, 0], ID)).toBe(false);
    expect(isCameraCut(O, ID, [CUT_DISTANCE_M + 1, 0, 0], ID)).toBe(true);
    expect(isCameraCut(O, ID, O, yaw(CUT_ANGLE_RAD - 0.1))).toBe(false);
    expect(isCameraCut(O, ID, O, yaw(CUT_ANGLE_RAD + 0.1))).toBe(true);
  });
});

describe('createHistoryTracker', () => {
  it('resets on the first frame only, then follows continuous frames', () => {
    const t = createHistoryTracker();
    expect(t.step(0, O, ID)).toBe(true);
    expect(t.step(1, O, ID)).toBe(false);
    expect(t.step(2, [1, 0, 0], yaw(0.1))).toBe(false);
    expect(t.repeated).toBe(false);
  });

  it('treats the same frameIndex as a capture re-encode: no reset, flagged as repeated', () => {
    const t = createHistoryTracker();
    t.step(5, O, ID);
    t.step(6, O, ID);
    expect(t.step(6, O, ID)).toBe(false);
    expect(t.repeated).toBe(true);
    expect(t.step(7, O, ID)).toBe(false);
    expect(t.repeated).toBe(false);
  });

  it('does not report a repeat right after an invalidation', () => {
    const t = createHistoryTracker();
    t.step(3, O, ID);
    t.invalidate();
    expect(t.step(3, O, ID)).toBe(true);
    expect(t.repeated).toBe(false);
  });

  it('resets on frameIndex gaps and rewinds', () => {
    const t = createHistoryTracker();
    t.step(10, O, ID);
    expect(t.step(12, O, ID)).toBe(true);
    expect(t.step(13, O, ID)).toBe(false);
    expect(t.step(2, O, ID)).toBe(true);
  });

  it('resets after invalidate (output size change) exactly once', () => {
    const t = createHistoryTracker();
    t.step(0, O, ID);
    t.step(1, O, ID);
    t.invalidate();
    expect(t.step(2, O, ID)).toBe(true);
    expect(t.step(3, O, ID)).toBe(false);
  });

  it('resets on a camera teleport or a large rotation and recovers next frame', () => {
    const t = createHistoryTracker();
    t.step(0, O, ID);
    expect(t.step(1, [100, 0, 0], ID)).toBe(true);
    expect(t.step(2, [100, 0, 0], ID)).toBe(false);
    expect(t.step(3, [100, 0, 0], yaw(3))).toBe(true);
    expect(t.step(4, [100, 0, 0], yaw(3))).toBe(false);
  });

  it('does not alias the caller arrays', () => {
    const t = createHistoryTracker();
    const p: Vec3 = [0, 0, 0];
    const q: Quat = [0, 0, 0, 1];
    t.step(0, p, q);
    p[0] = 500;
    expect(t.step(1, p, q)).toBe(true);
  });
});
