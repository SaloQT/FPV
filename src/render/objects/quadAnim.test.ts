import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../../contracts';
import { QUAD_X_SPIN } from '../../sim/presets';
import {
  BLUR_ALPHA,
  HIDE_DISTANCE,
  POSE_JUMP,
  SOLID_FULL,
  SOLID_GONE,
  blurAlpha,
  cameraInsideQuad,
  createPose,
  createRotors,
  ledLevel,
  packModel,
  solidFraction,
  stepPose,
  stepRotors,
} from './quadAnim';

const IDENTITY: Quat = [0, 0, 0, 1];

describe('prop phase', () => {
  it('integrates the speed magnitude and never jumps when the speed changes', () => {
    const r = createRotors();
    const start = Float64Array.from(r.phase);
    stepRotors(r, [100, 100, 100, 100], 0.001);
    stepRotors(r, [100, 100, 100, 100], 0.001);
    stepRotors(r, [400, 400, 400, 400], 0.001);
    for (let i = 0; i < 4; i++) expect(r.phase[i]).toBeCloseTo(start[i] + 0.6, 9);
  });

  it('turns each prop the way the physics module spins its motor', () => {
    const r = createRotors();
    stepRotors(r, [50, 50, 50, 50], 0.01);
    for (let i = 0; i < 4; i++) {
      expect(Math.sign(r.angle[i] - r.prevAngle[i])).toBe(QUAD_X_SPIN[i]);
      expect(Math.abs(r.angle[i] - r.prevAngle[i])).toBeCloseTo(0.5, 9);
    }
  });

  it('spins the same way when the reported speed is negative', () => {
    const a = createRotors();
    const b = createRotors();
    stepRotors(a, [30, 30, 30, 30], 0.02);
    stepRotors(b, [-30, -30, -30, -30], 0.02);
    expect(Array.from(b.angle)).toEqual(Array.from(a.angle));
  });

  it('wraps the phase and keeps the previous angle one step behind', () => {
    const r = createRotors();
    stepRotors(r, [1000, 1000, 1000, 1000], 0.1);
    const before = Float64Array.from(r.angle);
    stepRotors(r, [1000, 1000, 1000, 1000], 0.1);
    for (let i = 0; i < 4; i++) {
      expect(r.phase[i]).toBeGreaterThanOrEqual(0);
      expect(r.phase[i]).toBeLessThan(Math.PI * 2);
      expect(r.prevAngle[i]).toBe(before[i]);
    }
  });

  it('does not move at zero speed or zero dt', () => {
    const r = createRotors();
    const a = Float64Array.from(r.angle);
    stepRotors(r, [0, 0, 0, 0], 0.016);
    stepRotors(r, [900, 900, 900, 900], 0);
    expect(Array.from(r.angle)).toEqual(Array.from(a));
  });

  it('survives a non-finite speed or dt without poisoning the phase', () => {
    const r = createRotors();
    stepRotors(r, [Number.NaN, Infinity, -Infinity, 10], Number.NaN);
    stepRotors(r, [Number.NaN, 50, 50, 50], 0.01);
    for (let i = 0; i < 4; i++) {
      expect(Number.isFinite(r.phase[i])).toBe(true);
      expect(Number.isFinite(r.solid[i])).toBe(true);
      expect(Number.isFinite(r.blur[i])).toBe(true);
    }
  });
});

describe('blade to blur cross-fade', () => {
  it('is fully solid below the threshold and gone above the upper one', () => {
    expect(solidFraction(0)).toBe(1);
    expect(solidFraction(SOLID_FULL)).toBe(1);
    expect(solidFraction(SOLID_GONE)).toBe(0);
    expect(solidFraction(2500)).toBe(0);
    expect(blurAlpha(0)).toBe(0);
    expect(blurAlpha(2500)).toBeCloseTo(BLUR_ALPHA, 9);
    expect(BLUR_ALPHA).toBeGreaterThanOrEqual(0.15);
    expect(BLUR_ALPHA).toBeLessThanOrEqual(0.3);
  });

  it('is monotonic and always leaves something drawn', () => {
    let lastSolid = 1;
    let lastBlur = 0;
    for (let w = 0; w <= 3000; w += 0.5) {
      const s = solidFraction(w);
      const b = blurAlpha(w);
      expect(s).toBeLessThanOrEqual(lastSolid + 1e-12);
      expect(b).toBeGreaterThanOrEqual(lastBlur - 1e-12);
      expect(s + b / BLUR_ALPHA).toBeGreaterThan(0.85);
      lastSolid = s;
      lastBlur = b;
    }
  });

  it('the rotors publish the fractions of their own motor', () => {
    const r = createRotors();
    stepRotors(r, [0, 45, 300, 2500], 0.001);
    expect(r.solid[0]).toBe(1);
    expect(r.solid[1]).toBeGreaterThan(0.2);
    expect(r.solid[1]).toBeLessThan(0.9);
    expect(r.solid[2]).toBe(0);
    expect(r.blur[3]).toBeCloseTo(BLUR_ALPHA, 9);
  });
});

describe('LED level', () => {
  it('is steady while armed', () => {
    for (const t of [0, 0.2, 0.77, 12.3]) expect(ledLevel(true, t)).toBe(1);
  });

  it('blinks while disarmed and is exactly dark between blinks', () => {
    let lit = 0;
    let dark = 0;
    for (let t = 0; t < 3; t += 0.01) {
      const v = ledLevel(false, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > 0.5) lit++;
      if (v === 0) dark++;
    }
    expect(lit).toBeGreaterThan(10);
    expect(dark).toBeGreaterThan(lit);
  });
});

describe('model matrix and pose', () => {
  it('packs translation and a column-major rotation about +Y like the shader rotY', () => {
    const out = new Float32Array(16);
    const s = Math.SQRT1_2;
    packModel(out, [1, 2, 3], [0, s, 0, s]);
    // Adding 0 turns a rounded -0 into +0 so toEqual does not tell them apart.
    const rounded = (from: number, to: number): number[] => Array.from(out.slice(from, to)).map((v) => Math.round(v * 1e6) / 1e6 + 0);
    // A quarter turn counter-clockwise seen from above carries +X to -Z and +Z to +X.
    expect(rounded(0, 3)).toEqual([0, 0, -1]);
    expect(rounded(8, 11)).toEqual([1, 0, 0]);
    expect(Array.from(out.slice(12))).toEqual([1, 2, 3, 1]);
  });

  it('the first pose has no motion, the next keeps the previous one', () => {
    const p = createPose();
    stepPose(p, [0, 1, 0], IDENTITY);
    expect(Array.from(p.prevModel)).toEqual(Array.from(p.model));
    stepPose(p, [0.1, 1, 0], IDENTITY);
    expect(p.prevModel[12]).toBe(0);
    expect(p.model[12]).toBeCloseTo(0.1, 6);
  });

  it('drops the previous pose after a teleport so no smear is drawn', () => {
    const p = createPose();
    stepPose(p, [0, 1, 0], IDENTITY);
    stepPose(p, [POSE_JUMP + 5, 1, 0], IDENTITY);
    expect(Array.from(p.prevModel)).toEqual(Array.from(p.model));
  });

  it('hides the quad only when the camera is inside the first person radius', () => {
    const q: Vec3 = [3, 4, 5];
    expect(cameraInsideQuad([3, 4, 5], q)).toBe(true);
    expect(cameraInsideQuad([3, 4 + HIDE_DISTANCE * 0.9, 5], q)).toBe(true);
    expect(cameraInsideQuad([3, 4 + HIDE_DISTANCE * 1.1, 5], q)).toBe(false);
  });
});
