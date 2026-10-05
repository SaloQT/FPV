import { describe, expect, it } from 'vitest';
import { makeQuadState, makeTrack } from '../game/testKit';
import { gateAfter, observe, obsGates } from './observe';
import { OBS, OBS_SIZE } from './spec';

describe('observe', () => {
  const track = makeTrack(3);
  const gates = obsGates(track.gates);
  const prev = [0.1, -0.2, 0.3, -1];

  it('sees a level quad with the next gate 10 m straight ahead', () => {
    const s = makeQuadState({ pos: [0, 2, 0], vel: [0, 0, -5], motorOmega: [1750, 1750, 1750, 1750], batteryVoltage: 24 });
    const o = new Float64Array(OBS_SIZE);
    observe(s, { gates, closed: false, next: 0, groundY: 0, prevAction: prev, cells: 6 }, o);
    expect([o[OBS.vel], o[OBS.vel + 1], o[OBS.vel + 2]]).toEqual([0, 0, -0.5]);
    expect([o[OBS.up], o[OBS.up + 1], o[OBS.up + 2]]).toEqual([0, 1, 0]);
    expect(o[OBS.agl]).toBeCloseTo(0.2);
    expect([o[OBS.g1Dir], o[OBS.g1Dir + 1], o[OBS.g1Dir + 2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, -1]);
    expect(o[OBS.g1Dist]).toBeCloseTo(0.5);
    expect(o[OBS.g1Fwd + 2]).toBeCloseTo(-1);
    expect(o[OBS.g1Along]).toBeCloseTo(-0.5);
    expect(o[OBS.g1Size]).toBe(1);
    expect(o[OBS.g2Valid]).toBe(1);
    expect(o[OBS.g2Rel + 2]).toBeCloseTo(-0.5);
    expect(Array.from(o.slice(OBS.prevAct, OBS.prevAct + 4))).toEqual(prev);
    expect(o[OBS.motor]).toBeCloseTo(0.5);
    expect(o[OBS.battery]).toBeCloseTo(0.2);
  });

  it('turns the world into body axes: yawed 90 degrees left, the gate ahead of the world is to the right', () => {
    const q = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] as [number, number, number, number];
    const o = new Float64Array(OBS_SIZE);
    observe(makeQuadState({ pos: [0, 2, 0], quat: q }), { gates, closed: false, next: 0, groundY: 0, prevAction: prev, cells: 6 }, o);
    expect(o[OBS.g1Dir]).toBeCloseTo(1);
    expect(o[OBS.g1Dir + 2]).toBeCloseTo(0);
  });

  it('has no gate after the last one of an open track, and wraps on a circuit', () => {
    expect(gateAfter(2, 3, false)).toBe(-1);
    expect(gateAfter(2, 3, true)).toBe(0);
    const o = new Float64Array(OBS_SIZE);
    observe(makeQuadState({ pos: [0, 2, -25] }), { gates, closed: false, next: 2, groundY: 0, prevAction: prev, cells: 6 }, o);
    expect(o[OBS.g2Valid]).toBe(0);
  });
});
