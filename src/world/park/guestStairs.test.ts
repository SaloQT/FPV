import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { parkMesh } from '../../render/park/mesh';
import { GUEST_ANKLE_Y, GUEST_HIP_Y, GUEST_KNEE_Y, guestContactLeg, guestGaitRate, guestLegPose } from './guestPose';
import { GuestStairFlight, STAIR_HEADWAY, STAIR_LANDING_BLEND, STAIR_LANE } from './guestStairs';
import { axisAngle, clamp, inverseRotate, rotate } from './math';
import type { ParkPart } from './types';

function fixture(yaw = 0.71, rise = 0.19, count = 9) {
  const rot = axisAngle([0, 1, 0], yaw), origin: Vec3 = [17, 12.2, -23], parts: ParkPart[] = [];
  for (let i = 0; i < count; i++) {
    const p = rotate(rot, [0, (i + 0.5) * rise, -(i + 0.5) * 0.35]);
    parts.push({ shape: 'box', pos: [origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]], rot, half: [1.4, rise / 2, 0.175],
      color: [0.3, 0.3, 0.3], roughness: 0.9, metalness: 0, emissive: 0, solid: true, detail: 0, body: -1, walkSurface: { kind: 'tread', ride: 0 } });
  }
  const flight = new GuestStairFlight(parts);
  const point = (t: number): Vec3 => [flight.origin[0] + flight.forward[0] * t, flight.bottom + clamp(t / flight.length, 0, 1) * (flight.top - flight.bottom), flight.origin[2] + flight.forward[2] * t];
  return { flight, parts, point, yaw };
}
const turn = (p: Vec3, cs: [number, number]): Vec3 => [p[0], p[1] * cs[0] - p[2] * cs[1], p[1] * cs[1] + p[2] * cs[0]];

describe('actual stair tread contacts', () => {
  it('derives support faces from rotated generated solids, not the boarding ramp', () => {
    const { flight, parts, point } = fixture();
    for (let i = 0; i < parts.length; i++) {
      const tread = flight.treads[i]; expect(tread.min).toBeCloseTo(i * 0.35, 10); expect(tread.max).toBeCloseTo((i + 1) * 0.35, 10);
      expect(flight.support((tread.min + tread.max) / 2)).toBe(parts[i].pos[1] + parts[i].half[1]);
      expect(point((tread.min + tread.max) / 2)[1]).not.toBe(tread.top);
    }
    expect(flight.bottom).toBeCloseTo(12.2, 10); expect(flight.top).toBeCloseTo(12.2 + 9 * 0.19, 10);
  });

  it('keeps transformed shoes clear of all tread tops and risers in ascent and descent at every LOD', () => {
    const meshes = [parkMesh('guest', 6), parkMesh('guest', 12), parkMesh('guestHero', 24)];
    const { flight, parts, point, yaw } = fixture(), targets = new Float64Array(8);
    for (const mesh of meshes) {
      const shoes: { p: Vec3; right: boolean }[] = [], seen = new Set<string>();
      for (let i = 0; i < mesh.length; i += 7) {
        const code = Math.floor(mesh[i + 6]); if (code >> 4 !== 3) continue;
        const key = `${mesh[i]},${mesh[i + 1]},${mesh[i + 2]},${code & 1}`; if (seen.has(key)) continue; seen.add(key);
        shoes.push({ p: [mesh[i], mesh[i + 1], mesh[i + 2]], right: !!(code & 1) });
      }
      for (const height of [1.05, 1.55, 1.95]) for (const depth of [0.88, 1.2]) for (const direction of [1, -1]) {
        const rotation = axisAngle([0, 1, 0], yaw + (direction < 0 ? Math.PI : 0));
        for (let sample = 0; sample <= 180; sample++) {
          const t = -0.6 + (flight.length + 1.2) * sample / 180, root = point(t), time = sample / 60;
          expect(flight.contacts(root, yaw + (direction < 0 ? Math.PI : 0), height, time, 0.65, targets)).toBe(true);
          const poses = [guestContactLeg(targets, false, 0.65), guestContactLeg(targets, true, 0.65)]; let contact = Infinity, minimum = Infinity;
          for (const { p, right } of shoes) {
            const pose = poses[+right], local: Vec3 = [p[0] * 1.15 * height, (p[1] + pose.ankle[0] - GUEST_ANKLE_Y - pose.drop) * height, (p[2] * depth + pose.ankle[1]) * height], world = rotate(rotation, local);
            for (let k = 0; k < 3; k++) world[k] += root[k];
            const projection = flight.project(world), top = flight.support(projection);
            if (p[1] === 0) { contact = Math.min(contact, Math.abs(world[1] - top)); minimum = Math.min(minimum, world[1] - top); }
            // Exact OBB interior test also catches shoe uppers passing through a riser face.
            for (const part of parts) {
              const v = inverseRotate(part.rot, [world[0] - part.pos[0], world[1] - part.pos[1], world[2] - part.pos[2]]);
              const signed = Math.max(Math.abs(v[0]) - part.half[0], Math.abs(v[1]) - part.half[1], Math.abs(v[2]) - part.half[2]);
              expect(signed, `tread penetration, h=${height}, t=${t}, direction=${direction}`).toBeGreaterThanOrEqual(-2e-6);
            }
          }
          expect(minimum).toBeGreaterThanOrEqual(-2e-6); expect(contact).toBeLessThan(2e-6);
          for (const pose of poses) {
            const upper = turn([0, GUEST_KNEE_Y - GUEST_HIP_Y, 0], pose.hip), lower = turn(turn([0, GUEST_ANKLE_Y - GUEST_KNEE_Y, 0], pose.knee), pose.hip);
            expect(GUEST_HIP_Y + upper[1] + lower[1]).toBeCloseTo(pose.ankle[0], 8); expect(upper[2] + lower[2]).toBeCloseTo(pose.ankle[1], 8);
          }
        }
      }
    }
  }, 30000);

  it('has continuous targets and pelvis at tread exchanges and both level-gait boundaries', () => {
    const { flight, point, yaw } = fixture(), a = new Float64Array(8), b = new Float64Array(8), height = 1.75;
    const boundaries = [-0.35 - STAIR_LANDING_BLEND, -0.35, ...Array.from({ length: 12 }, (_, i) => i * 0.35), flight.length + 0.35, flight.length + 0.35 + STAIR_LANDING_BLEND];
    for (const direction of [1, -1]) for (const t of boundaries) {
      const pose = (s: number, out: Float64Array) => {
        if (!flight.contacts(point(s), yaw + (direction < 0 ? Math.PI : 0), height, 0.21, 0.65, out)) {
          out.fill(0);
          for (let side = 0; side < 2; side++) { const leg = guestLegPose(0.21, 0.65, height, !!side); out[side * 2] = leg.ankle[0] - GUEST_ANKLE_Y - leg.drop; out[side * 2 + 1] = leg.ankle[1]; }
        }
        return guestContactLeg(out, false, 0.65).drop;
      };
      const da = pose(t - 1e-7, a), db = pose(t + 1e-7, b);
      for (let k = 0; k < 4; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-5);
      expect(Math.abs(da - db)).toBeLessThan(1e-5);
    }
  });

  it('settles both shoes on support when blocked and keeps the pelvis above the supporting leg', () => {
    const { flight, point, yaw } = fixture(), targets = new Float64Array(8);
    for (const direction of [1, -1]) for (const height of [1.05, 1.95]) for (let i = 0; i < 80; i++) {
      const t = 0.7 + i / 80 * 1.4, root = point(t);
      expect(flight.contacts(root, yaw + (direction < 0 ? Math.PI : 0), height, 0.2, 0, targets, 0)).toBe(true);
      for (const right of [false, true]) {
        const pose = guestContactLeg(targets, right, 0), ankleT = t - direction * pose.ankle[1] * height;
        const floor = flight.support(ankleT), sole = root[1] + (pose.ankle[0] - GUEST_ANKLE_Y - pose.drop) * height;
        expect(sole).toBeGreaterThanOrEqual(floor - 1e-8);
        expect(root[1] + (GUEST_HIP_Y - pose.drop) * height - Math.min(targets[0], targets[2]) * height - root[1]).toBeGreaterThan(height * 0.38);
      }
    }
  });

  it('bounds every animated mesh by the lane and following clearances, including arms and shoe reach', () => {
    const { flight, point, yaw } = fixture(), targets = new Float64Array(8); let maxX = 0, minZ = Infinity, maxZ = -Infinity;
    for (const mesh of [parkMesh('guest', 6), parkMesh('guest', 12), parkMesh('guestHero', 24)]) for (const height of [1.05, 1.95]) for (const depth of [0.88, 1.2]) for (const direction of [1, -1]) for (let sample = 0; sample < 64; sample++) {
      const t = -1.1 + sample / 63 * (flight.length + 2.2), time = sample / 13, speed = 1.5 - 0.85 * flight.weight(point(t));
      flight.contacts(point(t), yaw + (direction < 0 ? Math.PI : 0), height, time, speed, targets);
      const poses = [guestContactLeg(targets, false, speed), guestContactLeg(targets, true, speed)];
      for (let i = 0; i < mesh.length; i += 7) {
        const code = Math.floor(mesh[i + 6]), joint = code & 15, weight = (mesh[i + 6] - code) * 2, p: Vec3 = [mesh[i] * 1.15, mesh[i + 1], mesh[i + 2] * depth]; let v: Vec3 = [...p];
        if (joint >= 4 && joint <= 9) {
          const leg = poses[joint & 1];
          if (joint >= 8) { v[1] += leg.ankle[0] - GUEST_ANKLE_Y - leg.drop; v[2] += leg.ankle[1]; }
          else {
            if (joint >= 6) { const child = turn([p[0], p[1] - GUEST_KNEE_Y, p[2]], leg.knee); child[1] += GUEST_KNEE_Y; for (let k = 0; k < 3; k++) v[k] += (child[k] - p[k]) * weight; }
            v[1] -= GUEST_HIP_Y; v = turn(v, leg.hip); v[1] += GUEST_HIP_Y - leg.drop;
          }
        } else if (joint === 2 || joint === 3 || joint === 10 || joint === 11) {
          if (joint >= 10) { const child = turn([p[0], p[1] - 0.615, p[2]], [Math.cos(0.12), Math.sin(0.12)]); child[1] += 0.615; for (let k = 0; k < 3; k++) v[k] += (child[k] - p[k]) * weight; }
          const angle = -Math.cos(time * guestGaitRate(height) + (joint & 1 ? Math.PI : 0)) * Math.min(speed, 1.2) * 0.42;
          v[1] -= 0.785; v = turn(v, [Math.cos(angle), Math.sin(angle)]); v[1] += 0.785 - poses[0].drop;
        }
        maxX = Math.max(maxX, Math.abs(v[0] * height)); minZ = Math.min(minZ, v[2] * height); maxZ = Math.max(maxZ, v[2] * height);
      }
    }
    expect(2 * maxX + 0.08, `half-width ${maxX}`).toBeLessThan(2 * STAIR_LANE);
    expect(maxZ - minZ + 0.08, `longitudinal envelope ${minZ}..${maxZ}`).toBeLessThan(STAIR_HEADWAY);
    // Narrowest generated stair handrails: centre ±1.35 m, radius .035 m.
    expect(STAIR_LANE + maxX + 0.05).toBeLessThan(1.35 - 0.035);
  });
});
