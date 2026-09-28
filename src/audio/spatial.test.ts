import { describe, expect, it } from 'vitest';
import { PilotSpace, EAR_HEIGHT } from './spatial';

const DT = 1 / 60;

function run(space: PilotSpace, pos: number[], vel: number[], seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) space.update(pos, vel, DT);
}

describe('PilotSpace', () => {
  it('captures the pilot at the first quad position plus ear height', () => {
    const s = new PilotSpace();
    s.update([5, 1, -7], [0, 0, 0], DT);
    expect(s.captured).toBe(true);
    expect([s.px, s.py, s.pz]).toEqual([5, 1 + EAR_HEIGHT, -7]);
  });

  it('keeps an explicitly placed pilot and lets reset re-capture', () => {
    const s = new PilotSpace();
    s.setPilot(10, 2, 3);
    s.update([0, 0, 0], [0, 0, 0], DT);
    expect([s.px, s.py, s.pz]).toEqual([10, 2, 3]);
    s.reset();
    s.update([1, 0, 1], [0, 0, 0], DT);
    expect(s.px).toBe(1);
  });

  it('has no Doppler shift when static and none for purely tangential motion', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    run(s, [30, 0, 0], [0, 0, 0], 0.5);
    expect(s.doppler).toBeCloseTo(1, 9);
    run(s, [30, 0, 0], [0, 20, 20], 0.5);
    expect(s.doppler).toBeCloseTo(1, 9);
  });

  it('raises pitch when approaching, lowers it when receding, by c/(c-v)', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    run(s, [50, 0, 0], [-30, 0, 0], 1);
    expect(s.radialSpeed).toBeCloseTo(30, 3);
    expect(s.doppler).toBeCloseTo(343 / (343 - 30), 4);
    run(s, [50, 0, 0], [30, 0, 0], 1);
    expect(s.doppler).toBeCloseTo(343 / (343 + 30), 4);
  });

  it('smooths the radial speed instead of jumping', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    run(s, [50, 0, 0], [0, 0, 0], 0.1);
    s.update([50, 0, 0], [-30, 0, 0], DT);
    expect(s.radialSpeed).toBeGreaterThan(0);
    expect(s.radialSpeed).toBeLessThan(30);
  });

  it('grows distance and darkens the sound monotonically with range', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    let dist = 0, cut = Infinity;
    for (const x of [1, 5, 20, 80, 300, 1000]) {
      s.update([x, 0, 0], [0, 0, 0], DT);
      expect(s.distance).toBeGreaterThan(dist);
      expect(s.cutoff).toBeLessThanOrEqual(cut);
      dist = s.distance;
      cut = s.cutoff;
    }
    expect(s.cutoff).toBeLessThan(5000);
  });

  it('clamps the distance when the quad is at the pilot', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    s.update([0, 0, 0], [0, 0, 0], DT);
    expect(s.distance).toBeGreaterThanOrEqual(0.4);
    expect(Number.isFinite(s.relX + s.relY + s.relZ)).toBe(true);
  });

  it('puts a quad to the east on the right and a quad to the north ahead (listener yaw 0)', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    s.update([2, 0, 0], [0, 0, 0], DT);
    expect(s.relX).toBeCloseTo(2, 6);
    expect(s.relZ).toBeCloseTo(0, 6);
    s.update([0, 1, -2], [0, 0, 0], DT);
    expect(s.relZ).toBeCloseTo(-2, 6);
    expect(s.relY).toBeCloseTo(1, 6);
  });

  it('turns to face a distant quad so it ends up straight ahead', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    run(s, [80, 0, 0], [0, 0, 0], 20);
    expect(s.relX).toBeCloseTo(0, 1);
    expect(s.relZ).toBeCloseTo(-80, 1);
  });

  it('does not chase the bearing when the quad is close', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    run(s, [2, 0, 0], [0, 0, 0], 10);
    expect(s.yaw).toBe(0);
  });

  it('wraps the listener yaw across the +-pi seam without spinning', () => {
    const s = new PilotSpace();
    s.setPilot(0, 0, 0);
    run(s, [0, 0, 60], [0, 0, 0], 30);
    expect(Math.abs(s.yaw)).toBeGreaterThan(3.1);
    expect(Math.abs(s.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(s.relZ).toBeCloseTo(-60, 0);
    let last = s.yaw;
    for (let i = 0; i < 600; i++) {
      s.update([0.5 * Math.sin(i / 50), 0, 60], [0, 0, 0], DT);
      let d = Math.abs(s.yaw - last);
      if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d).toBeLessThan(0.05);
      last = s.yaw;
    }
  });
});
