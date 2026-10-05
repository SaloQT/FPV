import { describe, expect, it } from 'vitest';
import type { QuadState } from '../contracts';
import { STUCK_MOVE_M, STUCK_S, StuckWatch } from './stuck';

const quad = (): QuadState => ({ pos: [0, 5, 0], armed: true } as unknown as QuadState);

describe('stuck watch', () => {
  it('calls a quad stuck once it stays within STUCK_MOVE_M for STUCK_S', () => {
    const s = quad();
    const w = new StuckWatch();
    w.reset(s);
    let t = 0;
    while (t < STUCK_S - 0.1) {
      s.pos[0] += 0.01;
      expect(w.update(s, 0.05)).toBe(false);
      t += 0.05;
    }
    expect(w.update(s, 0.2)).toBe(true);
  });

  it('keeps watching a quad that tumbles but keeps moving', () => {
    const s = quad();
    const w = new StuckWatch();
    w.reset(s);
    for (let t = 0; t < 20; t += 0.05) {
      s.pos[0] += (STUCK_MOVE_M / STUCK_S) * 1.5 * 0.05;
      expect(w.update(s, 0.05)).toBe(false);
    }
  });

  it('calls a quad that disarms stuck at once', () => {
    const s = quad();
    const w = new StuckWatch();
    w.reset(s);
    expect(w.update(s, 0.01)).toBe(false);
    s.armed = false;
    expect(w.update(s, 0.01)).toBe(true);
  });
});
