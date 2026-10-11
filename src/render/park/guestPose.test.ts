import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { GUEST_ANKLE_Y, GUEST_HIP_Y, GUEST_KNEE_Y, GUEST_SEAT_Y, guestGaitRate, guestLegPose, guestPoseDefines, guestSeatAngle } from '../../world/park/guestPose';
import { resolveShader } from '../shaderLib';
import { parkMesh } from './mesh';

const turn = (p: Vec3, cs: [number, number]): Vec3 => [p[0], p[1] * cs[0] - p[2] * cs[1], p[1] * cs[1] + p[2] * cs[0]];
const meshes = () => [parkMesh('guest', 6), parkMesh('guest', 12), parkMesh('guestHero', 24)];

describe('guest anatomical contacts', () => {
  it('uses one anatomical contract for CPU contacts and both GPU animation frames', () => {
    const shader = resolveShader('park/parts.wgsl', guestPoseDefines());
    expect(shader).not.toContain('${GUEST_');
    for (const [name, value] of Object.entries(guestPoseDefines())) expect(shader).toContain(`const ${name} : f32 = ${value};`);
    expect(shader).toContain('limb(shaped.pos, shaped.normal, joint, weight, a.anim, a.half.y, a.half.w, a.color.w, a.pos.w)');
    expect(shader).toContain('limb(shaped.pos, shaped.normal, joint, weight, a.previousAnim, a.half.y, a.half.w, a.color.w, a.pos.w)');
  });

  it('reaches both ankle targets with fixed-length bones and keeps the stance foot still in world space', () => {
    for (const height of [1.05, 1.55, 1.95]) for (const speed of [0, 0.4, 1.2, 1.5]) for (let i = 0; i < 96; i++) {
      const rate = guestGaitRate(height), time = (i + 0.25) / 96 * Math.PI * 2 / rate;
      for (const right of [false, true]) {
        const p = guestLegPose(time, speed, height, right), upper = turn([0, GUEST_KNEE_Y - GUEST_HIP_Y, 0], p.hip);
        const lower = turn(turn([0, GUEST_ANKLE_Y - GUEST_KNEE_Y, 0], p.knee), p.hip);
        expect(Math.hypot(...upper)).toBeCloseTo(0.24, 10); expect(Math.hypot(...lower)).toBeCloseTo(0.24, 10);
        expect(GUEST_HIP_Y + upper[1] + lower[1]).toBeCloseTo(p.ankle[0], 9);
        expect(upper[2] + lower[2]).toBeCloseTo(p.ankle[1], 9);
        expect(p.ankle[0] - p.drop).toBeGreaterThanOrEqual(GUEST_ANKLE_Y - 1e-10);
        if (p.stance) {
          expect(p.ankle[0] - p.drop).toBeCloseTo(GUEST_ANKLE_Y, 10);
          const dt = 1e-5, next = guestLegPose(time + dt, speed, height, right);
          expect((next.ankle[1] - p.ankle[1]) * height - speed * dt).toBeCloseTo(0, 10);
        }
      }
    }
  });

  it('places actual shoe soles on pavement across every LOD and the entire stance/swing cycle', () => {
    for (const mesh of meshes()) {
      const soles = [Infinity, Infinity];
      for (let i = 0; i < mesh.length; i += 7) {
        const code = Math.floor(mesh[i + 6]); if ((code >> 4) !== 3) continue;
        expect(code & 15).toBeGreaterThanOrEqual(8); expect(code & 15).toBeLessThanOrEqual(9);
        soles[code & 1] = Math.min(soles[code & 1], mesh[i + 1]);
      }
      expect(soles).toEqual([0, 0]);
      for (let i = 0; i < 64; i++) {
        const heights = soles.map((sole, right) => { const p = guestLegPose(i / 64, 1.7, 1.05, !!right); return sole + p.ankle[0] - GUEST_ANKLE_Y - p.drop; });
        expect(Math.min(...heights)).toBeCloseTo(0, 9);
        expect(Math.max(...heights)).toBeLessThanOrEqual(0.070001);
      }
    }
  });

  it('keeps shoulder and thigh attachment rings inside the torso through walking and seating', () => {
    for (const mesh of meshes()) for (const angle of [-0.504, 0, 0.504, 0.7, 1.45, 2, 2.2]) {
      const cs: [number, number] = [Math.cos(angle), Math.sin(angle)];
      for (const joint of [2, 3, 4, 5]) {
        const arm = joint < 4, side = joint % 2 ? 1 : -1, material = arm ? 0 : 2, pivot = arm ? 0.785 : GUEST_HIP_Y;
        let top = -Infinity, inner: Vec3 = [Infinity, 0, 0];
        for (let i = 0; i < mesh.length; i += 7) {
          const code = Math.floor(mesh[i + 6]); if ((code & 15) !== joint || (code >> 4) !== material) continue;
          if (mesh[i + 1] > top + 1e-6) { top = mesh[i + 1]; inner = [mesh[i], top, mesh[i + 2]]; }
          else if (Math.abs(mesh[i + 1] - top) < 1e-6 && Math.abs(mesh[i]) < Math.abs(inner[0])) inner = [mesh[i], top, mesh[i + 2]];
        }
        const p = turn([inner[0], inner[1] - pivot, inner[2]], cs); p[1] += pivot;
        // Cross-section of the actual trunk mesh at this attachment, intersected in the horizontal plane.
        let outer = -Infinity;
        for (let i = 0; i < mesh.length; i += 21) {
          const code = Math.floor(mesh[i + 6]); if ((code & 15) !== 0 || (code >> 4) !== material) continue;
          const a = [mesh[i], mesh[i + 1], mesh[i + 2]], b = [mesh[i + 7], mesh[i + 8], mesh[i + 9]], c = [mesh[i + 14], mesh[i + 15], mesh[i + 16]];
          const by = b[1] - a[1], bz = b[2] - a[2], cy = c[1] - a[1], cz = c[2] - a[2], det = by * cz - bz * cy;
          if (Math.abs(det) < 1e-10) continue;
          const y = p[1] - a[1], z = p[2] - a[2], u = (y * cz - z * cy) / det, v = (by * z - bz * y) / det;
          if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) outer = Math.max(outer, side * (a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0])));
        }
        // Far LOD folds pelvis into the connected upper legs; its torso starts at .52.
        if (!arm && mesh.length / 7 < 1000) continue;
        expect(outer, `joint ${joint}, angle ${angle}, LOD ${mesh.length / 7}`).toBeGreaterThan(Math.abs(p[0]));
      }
    }
    const hero = parkMesh('guestHero', 24); let pelvisBottom = Infinity;
    for (let i = 0; i < hero.length; i += 7) if (Math.floor(hero[i + 6]) === 32) pelvisBottom = Math.min(pelvisBottom, hero[i + 1]);
    expect(pelvisBottom).toBeCloseTo(GUEST_SEAT_Y, 7);
  });

  it('keeps the actual seated shoe surfaces above low cabin floors without moving the pelvis off its cushion', () => {
    for (const mesh of meshes()) for (const height of [1.05, 1.75, 1.95]) for (const clearance of [0.23, 0.32, 0.33, 0.45, 0.55, 1.1]) {
      const angle = guestSeatAngle(height, clearance), cs: [number, number] = [Math.cos(angle), Math.sin(angle)]; let lowest = Infinity;
      for (let i = 0; i < mesh.length; i += 7) {
        const code = Math.floor(mesh[i + 6]); if (code >> 4 !== 3) continue;
        const child = turn([mesh[i] * 1.15, mesh[i + 1] - GUEST_KNEE_Y, mesh[i + 2] * 1.2], [cs[0], -cs[1]]);
        child[1] += GUEST_KNEE_Y - GUEST_HIP_Y;
        const worldY = clearance - GUEST_SEAT_Y * height + (turn(child, cs)[1] + GUEST_HIP_Y) * height;
        lowest = Math.min(lowest, worldY);
      }
      expect(lowest).toBeGreaterThanOrEqual(-1e-6);
      if (angle > 1.45) expect(lowest).toBeCloseTo(0, 6);
    }
  });
});
