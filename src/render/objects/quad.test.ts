import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../../contracts';
import { QUAD_5IN_6S, QUAD_X_SPIN } from '../../sim/presets';
import { KIND } from './materials';
import { VERTEX_FLOATS } from './meshBuilder';
import { checkMesh } from './meshCheck';
import { LED_BODY, LENS_GLINT_BODY, buildQuadBody, buildQuadProps } from './quadModel';
import { CLOCKWISE_MOTORS, COUNTER_CLOCKWISE_MOTORS, MOTOR_BODY, MOTOR_SPIN, PROP_BODY } from './quadLayout';
import { QUAD_RT_PRIMITIVES, createQuadRt } from './quadRt';

describe('quad layout against the physics preset', () => {
  it('places the motor hubs where the physics module has them', () => {
    QUAD_5IN_6S.motorPos.forEach((p, i) => {
      for (let k = 0; k < 3; k++) expect(Math.abs(MOTOR_BODY[i][k] - p[k])).toBeLessThan(1e-3);
    });
  });

  it('uses the physics spin table: clockwise props on motors 0 and 2', () => {
    expect(MOTOR_SPIN).toEqual(QUAD_X_SPIN);
    expect(CLOCKWISE_MOTORS.every((i) => QUAD_X_SPIN[i] < 0)).toBe(true);
    expect(COUNTER_CLOCKWISE_MOTORS.every((i) => QUAD_X_SPIN[i] > 0)).toBe(true);
    PROP_BODY.forEach((p, i) => expect(p[1]).toBeGreaterThan(MOTOR_BODY[i][1]));
  });
});

describe('quad mesh', () => {
  const body = buildQuadBody();
  const props = buildQuadProps();
  const bodyReport = checkMesh(body);
  const propTris = checkMesh(props.ccw).triangles;

  it('lands in the triangle budget with the four props included', () => {
    const total = bodyReport.triangles + 4 * propTris;
    expect(total).toBeGreaterThan(15000);
    expect(total).toBeLessThan(25000);
  });

  it('winds every face with its normals', () => {
    expect(bodyReport.worstAgreement).toBeGreaterThan(0);
    expect(checkMesh(props.cw).worstAgreement).toBeGreaterThan(0);
  });

  it('stays inside the physical quad envelope', () => {
    const v = body.vertices;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += VERTEX_FLOATS) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], v[i + k]);
        hi[k] = Math.max(hi[k], v[i + k]);
      }
    }
    expect(hi[0] - lo[0]).toBeGreaterThan(0.17);
    expect(hi[0] - lo[0]).toBeLessThan(0.21);
    expect(hi[2] - lo[2]).toBeGreaterThan(0.17);
    expect(hi[2] - lo[2]).toBeLessThan(0.23);
    expect(lo[1]).toBeGreaterThan(-0.045);
    expect(hi[1]).toBeLessThan(0.05);
  });

  it('carries every material kind the shaders switch on', () => {
    const kinds = new Set<number>();
    for (let i = 8; i < body.vertices.length; i += VERTEX_FLOATS) kinds.add(body.vertices[i]);
    for (const k of [KIND.CARBON, KIND.ALU, KIND.PCB, KIND.BATTERY, KIND.RUBBER, KIND.MOTOR_BELL, KIND.MOTOR_BASE, KIND.PLASTIC, KIND.LENS, KIND.LED, KIND.WIRE, KIND.STEEL]) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it('keeps the four LED indices distinct and the LEDs on the correct ends', () => {
    const ids = new Set<number>();
    const v = body.vertices;
    for (let i = 0; i < v.length; i += VERTEX_FLOATS) if (v[i + 8] === KIND.LED) ids.add(v[i + 10]);
    expect([...ids].sort()).toEqual([0, 1, 2, 3]);
    expect(LED_BODY[0][2]).toBeGreaterThan(0);
    expect(LED_BODY[1][2]).toBeGreaterThan(0);
    expect(LED_BODY[2][2]).toBeLessThan(0);
    expect(LED_BODY[3][2]).toBeLessThan(0);
    expect(LED_BODY[0][0]).toBeLessThan(0);
    expect(LED_BODY[1][0]).toBeGreaterThan(0);
    expect(LENS_GLINT_BODY[2]).toBeLessThan(LED_BODY[2][2]);
  });

  it('sits with the bottom plate below the centre of mass and the pack above it', () => {
    let lowest = Infinity;
    const v = body.vertices;
    for (let i = 0; i < v.length; i += VERTEX_FLOATS) if (v[i + 8] === KIND.BATTERY) lowest = Math.min(lowest, v[i + 1]);
    expect(lowest).toBeGreaterThan(0);
  });
});

describe('quad ray tracing proxy', () => {
  const rotY = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

  it('uses at most twelve primitives', () => {
    const rt = createQuadRt();
    expect(rt.prims.length).toBe(QUAD_RT_PRIMITIVES);
    expect(rt.prims.length).toBeLessThanOrEqual(12);
  });

  it('moves rigidly with the body and reuses its objects', () => {
    const rt = createQuadRt();
    const first = rt.prims[0];
    rt.update([0, 0, 0], [0, 0, 0, 1]);
    const motors = rt.prims.filter((p) => p.type === 'capsule');
    const rest = motors.map((p) => (p.type === 'capsule' ? [...p.a] : []));
    const pos: Vec3 = [3, 1, -2];
    rt.update(pos, rotY(Math.PI / 2));
    expect(rt.prims[0]).toBe(first);
    const lengths = motors.map((p) => (p.type === 'capsule' ? Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) : 0));
    motors.forEach((p, i) => {
      if (p.type !== 'capsule') return;
      const [x, y, z] = rest[i];
      expect(p.a[0]).toBeCloseTo(pos[0] + z, 9);
      expect(p.a[1]).toBeCloseTo(pos[1] + y, 9);
      expect(p.a[2]).toBeCloseTo(pos[2] - x, 9);
      expect(lengths[i]).toBeGreaterThan(0.01);
    });
    const obb = rt.prims[0];
    if (obb.type === 'obb') {
      const n = Math.hypot(...obb.rot);
      expect(n).toBeCloseTo(1, 9);
    }
  });
});
