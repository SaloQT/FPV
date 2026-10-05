import { describe, expect, it } from 'vitest';
import { makeTrack } from '../game/testKit';
import { flatTerrain } from '../sim/testkit';
import { randomBrain } from './testBrains';
import { BrainRacer } from './racer';

const DT = 1 / 4000;

function racer(): BrainRacer {
  const ground = flatTerrain(0);
  return new BrainRacer(randomBrain([8], 9, 0.5), { ground, groundHeightAt: (x, z) => ground.heightAt(x, z), track: makeTrack(3), colliders: [] });
}

describe('BrainRacer', () => {
  it('sits disarmed on the pad until GO', () => {
    const r = racer();
    const start = [...r.physics.state.pos];
    for (let i = 0; i < 2000; i++) r.step(DT);
    expect(r.physics.state.armed).toBe(false);
    expect(r.time).toBe(0);
    expect(r.physics.state.pos[0]).toBeCloseTo(start[0], 6);
    expect(r.physics.state.pos[2]).toBeCloseTo(start[2], 6);
  });

  it('arms at GO, flies the real physics with finite state, and restarts cleanly', () => {
    const r = racer();
    r.go = true;
    for (let i = 0; i < 4000 * 3; i++) r.step(DT);
    const s = r.physics.state;
    expect(r.time).toBeCloseTo(3, 6);
    for (const v of [...s.pos, ...s.vel, ...s.quat]) expect(Number.isFinite(v)).toBe(true);
    expect(s.armed || s.crashed || r.crashes > 0).toBe(true);
    r.restart();
    expect(r.go).toBe(false);
    expect(r.time).toBe(0);
    expect(r.crashes).toBe(0);
    expect(r.timer.nextGate).toBe(0);
  });
});
