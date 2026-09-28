import { describe, expect, it } from 'vitest';
import type { Quat } from '../contracts';
import { formatClock, formatDistance, formatHours, formatSplit, formatTime, formatTimeCentis, toKmh } from '../game/units';
import { cameraPitchRoll, estimateCells, formatMixed, formatVolts, horizonOffsetPx, mixedKey, quatPitchRoll } from './hudFormat';

function axisAngle(x: number, y: number, z: number, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

describe('time and unit formatters', () => {
  it('formats lap times as m:ss.mmm and shows dashes when there is no time', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(83.4567)).toBe('1:23.457');
    expect(formatTime(600)).toBe('10:00.000');
    expect(formatTime(NaN)).toBe('-:--.---');
    expect(formatTime(-1)).toBe('-:--.---');
    expect(formatTime(Infinity)).toBe('-:--.---');
  });

  it('carries rounding into the next unit', () => {
    expect(formatTime(59.9996)).toBe('1:00.000');
    expect(formatTimeCentis(59.996)).toBe('1:00.00');
  });

  it('formats the running lap clock in centiseconds', () => {
    expect(formatTimeCentis(0)).toBe('0:00.00');
    expect(formatTimeCentis(12.345)).toBe('0:12.35');
    expect(formatTimeCentis(NaN)).toBe('-:--.--');
  });

  it('formats the flight timer in whole seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(61)).toBe('1:01');
    expect(formatClock(-4)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
  });

  it('formats split deltas with an explicit sign', () => {
    expect(formatSplit(0.1234)).toBe('+0.123');
    expect(formatSplit(-0.5)).toBe('-0.500');
    expect(formatSplit(0)).toBe('+0.000');
    expect(formatSplit(-0.0001)).toBe('+0.000');
    expect(formatSplit(12.3456)).toBe('+12.346');
    expect(formatSplit(NaN)).toBe('');
  });

  it('formats distances, hours and speed', () => {
    expect(formatDistance(842.4)).toBe('842 m');
    expect(formatDistance(1234)).toBe('1.23 km');
    expect(formatDistance(NaN)).toBe('-');
    expect(formatHours(6.5)).toBe('06:30');
    expect(formatHours(24)).toBe('00:00');
    expect(formatHours(-1)).toBe('23:00');
    expect(formatHours(23.999)).toBe('00:00');
    expect(toKmh(10)).toBeCloseTo(36, 10);
  });
});

describe('HUD number formatting', () => {
  it('shows 0.1 resolution below 10 and whole numbers above', () => {
    expect(formatMixed(mixedKey(3.24))).toBe('3.2');
    expect(formatMixed(mixedKey(0))).toBe('0.0');
    expect(formatMixed(mixedKey(-0.04))).toBe('0.0');
    expect(formatMixed(mixedKey(-4.26))).toBe('-4.3');
    expect(formatMixed(mixedKey(9.94))).toBe('9.9');
    expect(formatMixed(mixedKey(9.96))).toBe('10');
    expect(formatMixed(mixedKey(27.4))).toBe('27');
    expect(formatMixed(mixedKey(-27.6))).toBe('-28');
    expect(formatMixed(mixedKey(123.5))).toBe('124');
  });

  it('keys are equal exactly when the text is', () => {
    expect(mixedKey(27.2)).toBe(mixedKey(26.9));
    expect(mixedKey(27.2)).not.toBe(mixedKey(27.6));
    expect(mixedKey(NaN)).toBe(0);
    expect(mixedKey(Infinity)).toBe(0);
  });

  it('formats cell voltage with two decimals', () => {
    expect(formatVolts(387)).toBe('3.87V');
    expect(formatVolts(420)).toBe('4.20V');
  });

  it('guesses the pack size from a charged battery, also under load', () => {
    expect(estimateCells(25.2)).toBe(6);
    expect(estimateCells(23.1)).toBe(6);
    expect(estimateCells(16.8)).toBe(4);
    expect(estimateCells(12.6)).toBe(3);
    expect(estimateCells(4.2)).toBe(1);
    expect(estimateCells(0)).toBe(1);
    expect(estimateCells(NaN)).toBe(1);
  });
});

describe('quatPitchRoll', () => {
  it('is level for the identity', () => {
    const a = quatPitchRoll([0, 0, 0, 1], { pitch: 9, roll: 9 });
    expect(a.pitch).toBeCloseTo(0, 12);
    expect(a.roll).toBeCloseTo(0, 12);
  });

  it('nose up is positive pitch (rotation about body +X)', () => {
    const a = quatPitchRoll(axisAngle(1, 0, 0, 0.4), { pitch: 0, roll: 0 });
    expect(a.pitch).toBeCloseTo(0.4, 10);
    expect(a.roll).toBeCloseTo(0, 10);
  });

  it('right wing down is positive roll (rotation about body -Z)', () => {
    const a = quatPitchRoll(axisAngle(0, 0, -1, 0.5), { pitch: 0, roll: 0 });
    expect(a.roll).toBeCloseTo(0.5, 10);
    expect(a.pitch).toBeCloseTo(0, 10);
  });

  it('ignores yaw', () => {
    const a = quatPitchRoll(axisAngle(0, 1, 0, 2.2), { pitch: 0, roll: 0 });
    expect(a.pitch).toBeCloseTo(0, 10);
    expect(a.roll).toBeCloseTo(0, 10);
  });

  it('keeps roll past 90 degrees and when inverted', () => {
    expect(quatPitchRoll(axisAngle(0, 0, -1, 2), { pitch: 0, roll: 0 }).roll).toBeCloseTo(2, 10);
    expect(Math.abs(quatPitchRoll(axisAngle(0, 0, 1, Math.PI), { pitch: 0, roll: 0 }).roll)).toBeCloseTo(Math.PI, 10);
  });

  it('clamps pitch at straight up despite rounding', () => {
    const a = quatPitchRoll(axisAngle(1, 0, 0, Math.PI / 2 + 1e-9), { pitch: 0, roll: 0 });
    expect(a.pitch).toBeLessThanOrEqual(Math.PI / 2);
    expect(Number.isNaN(a.pitch)).toBe(false);
  });
});

describe('cameraPitchRoll', () => {
  const at = (q: Quat, tilt: number) => cameraPitchRoll(q, tilt, { pitch: 9, roll: 9 });

  it('is the body attitude with no tilt', () => {
    const q = axisAngle(1, 0, 0, 0.4);
    expect(at(q, 0).pitch).toBeCloseTo(0.4, 10);
    expect(at(axisAngle(0, 0, -1, 0.5), 0).roll).toBeCloseTo(0.5, 10);
  });

  it('looks up by exactly the tilt when the quad is level, and adds it to the pitch of an unbanked quad', () => {
    expect(at([0, 0, 0, 1], 0.5).pitch).toBeCloseTo(0.5, 10);
    expect(at([0, 0, 0, 1], 0.5).roll).toBeCloseTo(0, 10);
    expect(at(axisAngle(1, 0, 0, 0.3), 0.5).pitch).toBeCloseTo(0.8, 10);
  });

  it('a banked quad with an up-tilted camera looks lower than body pitch plus tilt', () => {
    const a = at(axisAngle(0, 0, -1, Math.PI / 3), Math.PI / 6);
    expect(a.pitch).toBeCloseTo(Math.asin(0.5 * 0.5), 10);
    expect(a.roll).toBeCloseTo(Math.atan2(Math.sin(Math.PI / 3), Math.cos(Math.PI / 6) * 0.5), 10);
  });

  it('looks down by the tilt on a quad flying inverted, and stays finite past vertical', () => {
    expect(at(axisAngle(0, 0, 1, Math.PI), 0.5).pitch).toBeCloseTo(-0.5, 10);
    expect(Number.isNaN(at(axisAngle(1, 0, 0, Math.PI / 2 - 0.5 + 1e-9), 0.5).pitch)).toBe(false);
  });

  it('ignores yaw and writes into the object it is given', () => {
    const out = { pitch: 0, roll: 0 };
    expect(cameraPitchRoll(axisAngle(0, 1, 0, 2.2), 0.4, out)).toBe(out);
    expect(out.pitch).toBeCloseTo(0.4, 10);
    expect(out.roll).toBeCloseTo(0, 10);
  });
});

describe('horizonOffsetPx', () => {
  it('is zero when level and grows with pitch', () => {
    expect(horizonOffsetPx(0, 1.7, 720)).toBe(0);
    expect(horizonOffsetPx(0.3, 1.7, 720)).toBeGreaterThan(0);
    expect(horizonOffsetPx(-0.3, 1.7, 720)).toBeCloseTo(-horizonOffsetPx(0.3, 1.7, 720), 10);
  });

  it('puts the horizon at the frame edge when pitched by half the field of view', () => {
    const fov = 1.6;
    expect(horizonOffsetPx(fov / 2, fov, 800)).toBeCloseTo(400, 6);
  });

  it('stays finite when pitched straight up', () => {
    expect(Number.isFinite(horizonOffsetPx(Math.PI / 2, 1.7, 720))).toBe(true);
  });
});
