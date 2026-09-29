import { describe, expect, it } from 'vitest';
import { KIND } from './materials';
import { VERTEX_FLOATS } from './meshBuilder';
import { checkMesh } from './meshCheck';
import { PROP_BLADES, PROP_RADIUS, bladePoint, buildPropMesh, pitchAngleAt } from './propeller';

describe('propeller', () => {
  it('spans the physics prop diameter', () => {
    const { vertices } = buildPropMesh(false);
    let maxR = 0;
    for (let i = 0; i < vertices.length; i += VERTEX_FLOATS) maxR = Math.max(maxR, Math.hypot(vertices[i], vertices[i + 2]));
    expect(maxR).toBeGreaterThan(PROP_RADIUS * 0.99);
    expect(maxR).toBeLessThan(PROP_RADIUS * 1.02);
  });

  it('leads with the edge toward -Z and trails lower so a counter-clockwise rotor pushes the air down', () => {
    for (const v of [0.2, 0.5, 0.8]) {
      const trailing = bladePoint(0, v);
      const leading = bladePoint(0.5, v);
      expect(leading[2]).toBeLessThan(trailing[2]);
      expect(trailing[1]).toBeLessThan(leading[1]);
    }
    expect(pitchAngleAt(0.02)).toBeGreaterThan(pitchAngleAt(0.06));
  });

  it('closes the section at the trailing edge and the tip', () => {
    for (const v of [0.1, 0.6]) {
      const a = bladePoint(0, v);
      const b = bladePoint(1, v);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-9);
    }
    const tipA = bladePoint(0.3, 1);
    const tipB = bladePoint(0.7, 1);
    expect(Math.hypot(tipA[0] - tipB[0], tipA[1] - tipB[1], tipA[2] - tipB[2])).toBeLessThan(1e-6);
  });

  it('winds outward with finite, unit normals and stays in the tri-count budget', () => {
    for (const mirrored of [false, true]) {
      const mesh = buildPropMesh(mirrored);
      const r = checkMesh(mesh);
      expect(r.worstAgreement).toBeGreaterThan(0);
      expect(r.triangles).toBeGreaterThan(1200);
      expect(r.triangles).toBeLessThan(2600);
    }
  });

  it('blade normals face up on the upper surface and down on the lower one', () => {
    const { vertices } = buildPropMesh(false);
    let checked = 0;
    for (let i = 0; i < vertices.length; i += VERTEX_FLOATS) {
      if (vertices[i + 8] !== KIND.PROP) continue;
      const u = vertices[i + 6];
      const v = vertices[i + 7];
      const side = u > 0.2 && u < 0.4 ? -1 : u > 0.6 && u < 0.8 ? 1 : 0;
      if (side === 0 || v < 0.1 || v > 0.85) continue;
      const r = Math.hypot(vertices[i], vertices[i + 2]);
      const beta = pitchAngleAt(r);
      const nDotUp = vertices[i + 4] * Math.cos(beta) + vertices[i + 5] * Math.sin(beta);
      expect(nDotUp * side).toBeGreaterThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('the clockwise mesh is the z mirror of the counter-clockwise one', () => {
    const a = buildPropMesh(false);
    const b = buildPropMesh(true);
    expect(b.vertices.length).toBe(a.vertices.length);
    for (let i = 0; i < a.vertices.length; i += VERTEX_FLOATS) {
      expect(b.vertices[i]).toBeCloseTo(a.vertices[i], 6);
      expect(b.vertices[i + 1]).toBeCloseTo(a.vertices[i + 1], 6);
      expect(b.vertices[i + 2]).toBeCloseTo(-a.vertices[i + 2], 6);
      expect(b.vertices[i + 5]).toBeCloseTo(-a.vertices[i + 5], 6);
    }
  });

  it('is three blades around the hub', () => {
    expect(PROP_BLADES).toBe(3);
    const { vertices } = buildPropMesh(false);
    const tips = [0, 0, 0];
    for (let i = 0; i < vertices.length; i += VERTEX_FLOATS) {
      if (vertices[i + 8] !== KIND.PROP) continue;
      const r = Math.hypot(vertices[i], vertices[i + 2]);
      if (r < PROP_RADIUS * 0.95) continue;
      const a = (Math.atan2(-vertices[i + 2], vertices[i]) + 2 * Math.PI) % (2 * Math.PI);
      tips[Math.round(a / ((2 * Math.PI) / 3)) % 3]++;
    }
    expect(tips.every((t) => t > 0)).toBe(true);
  });
});
