import { describe, expect, it } from 'vitest';
import { MARK, PASS_NAMES, sectionMs } from './gpuTimer';

describe('GPU timer sections', () => {
  it('has one mark per section boundary in frame order', () => {
    expect(PASS_NAMES.length + 1).toBe(Object.keys(MARK).length);
    const order = [MARK.FrameBegin, MARK.PreEnd, MARK.GBufferEnd, MARK.RtEnd, MARK.LightingEnd, MARK.OverlayEnd, MARK.FrameEnd];
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('converts nanosecond timestamps to milliseconds', () => {
    const t = [1_000_000_000n, 1_500_000n + 1_000_000_000n, 1_000_000_000n + 4_500_000n];
    expect(sectionMs(t, 0, 1)).toBeCloseTo(1.5, 6);
    expect(sectionMs(t, 0, 2)).toBeCloseTo(4.5, 6);
  });

  it('rejects a section whose clock went backwards or was never written', () => {
    expect(sectionMs([5n, 3n], 0, 1)).toBeNull();
    expect(sectionMs([0n, 9n], 0, 1)).toBeNull();
    expect(sectionMs([7n, 7n], 0, 1)).toBeNull();
  });
});
