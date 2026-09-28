import { describe, expect, it } from 'vitest';
import { createPlacement, gatePlacement, padPlacement, respawnPlacement, RESPAWN_BACK_M, RESPAWN_MIN_AGL } from './checkpoint';
import { makeGate, makeTrack } from './testKit';

describe('respawn placement', () => {
  it('drops the quad 1.5 m before the gate along its travel direction, facing it', () => {
    const p = gatePlacement(makeGate({ pos: [4, 3, -20] }), undefined, createPlacement());
    expect(p.pos[0]).toBeCloseTo(4);
    expect(p.pos[1]).toBeCloseTo(3);
    expect(p.pos[2]).toBeCloseTo(-20 + RESPAWN_BACK_M);
    expect(p.yaw).toBe(0);
    expect(p.airborne).toBe(true);
  });

  it('follows a yawed gate: heading west means the quad starts to its east', () => {
    const p = gatePlacement(makeGate({ pos: [10, 2, 0], yaw: Math.PI / 2 }), undefined, createPlacement());
    expect(p.pos[0]).toBeCloseTo(10 + RESPAWN_BACK_M);
    expect(p.pos[2]).toBeCloseTo(0);
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('backs off along the pitched axis of a dive gate', () => {
    const p = gatePlacement(makeGate({ pos: [0, 10, -10], pitch: -0.5 }), undefined, createPlacement());
    expect(p.pos[1]).toBeCloseTo(10 + Math.sin(0.5) * RESPAWN_BACK_M);
  });

  it('keeps a few metres above the terrain', () => {
    const p = gatePlacement(makeGate({ pos: [0, 0.5, -10] }), () => 30, createPlacement());
    expect(p.pos[1]).toBeCloseTo(30 + RESPAWN_MIN_AGL);
  });

  it('does not lower a spawn that is already high', () => {
    const p = gatePlacement(makeGate({ pos: [0, 40, -10] }), () => 30, createPlacement());
    expect(p.pos[1]).toBeCloseTo(40);
  });

  it('uses the start pad, slightly lifted and disarmed, before any gate was passed', () => {
    const track = makeTrack(3, { start: { pos: [5, 12, 7], yaw: 1.2 } });
    const p = respawnPlacement(track, -1, undefined, createPlacement());
    expect(p.pos[0]).toBe(5);
    expect(p.pos[1]).toBeGreaterThan(12);
    expect(p.pos[1]).toBeLessThan(12.2);
    expect(p.pos[2]).toBe(7);
    expect(p.yaw).toBe(1.2);
    expect(p.airborne).toBe(false);
  });

  it('uses the last passed gate as the checkpoint', () => {
    const track = makeTrack(4);
    const p = respawnPlacement(track, 2, undefined, createPlacement());
    expect(p.pos[2]).toBeCloseTo(track.gates[2].pos[2] + RESPAWN_BACK_M);
    expect(p.airborne).toBe(true);
  });

  it('falls back to the origin without a track', () => {
    const p = padPlacement(null, createPlacement());
    expect(p.pos[0]).toBe(0);
    expect(p.pos[2]).toBe(0);
    expect(p.airborne).toBe(false);
  });
});
