import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { parkMesh } from '../../render/park/mesh';
import { intersectPrim } from '../../render/rt/cpuReference';
import { partDistance } from './collision';
import { measureJoints, partAnchor, registerJoint, remapConstructionJoints } from './construction';
import { add, axisAngle, cross, inverseRotate, mul, pose, qmul, rotate, sub, unit, yawPoint } from './math';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import type { ParkData } from './types';

const color: Vec3 = [0.3, 0.4, 0.5];
const scene = (): ParkData => ({ recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, entrance: 0, launch: { pos: [0, 0, 0], yaw: 0 }, rides: [], nodes: [], paths: [], parts: [], bodies: [], lights: [], rooms: [], routes: [] });

describe('construction coordinate and contact contracts', () => {
  it('composes local component rotations and preserves explicitly parent-frame rods at arbitrary headings', () => {
    for (const yaw of [0, 0.73, -2.9]) {
      const park = scene(), origin: Vec3 = [792, 12, -831], b = new Parts(park, origin, yaw), localRot = axisAngle([1, 0, 0], 0.42);
      const component = b.box([2, 4, 8], [1, 0.2, 2], color, { localRot });
      const tip: Vec3 = [0.3, 0.2, 1.4];
      const expected = yawPoint(origin, yaw, add([2, 4, 8], rotate(localRot, tip)));
      const actual = add(component.pos, rotate(component.rot, tip));
      for (let k = 0; k < 3; k++) expect(actual[k]).toBeCloseTo(expected[k], 11);
      const a: Vec3 = [-3, 0.2, 7], c: Vec3 = [2, 5, -4], rod = b.rod(a, c, 0.12, color);
      for (const [end, point] of [[-1, a], [1, c]] as const) {
        const surface = add(rod.pos, rotate(rod.rot, [0, end * rod.half[1], 0])), goal = yawPoint(origin, yaw, point);
        for (let k = 0; k < 3; k++) expect(surface[k]).toBeCloseTo(goal[k], 11);
      }
      expect(() => b.box([0, 0, 0], [1, 1, 1], color, { localRot, rot: localRot })).toThrow(/mix/);
      expect(() => b.rod(a, c, 0.12, color, { localRot })).toThrow(/endpoints/);
      expect(() => b.rod(a, a, 0.12, color)).toThrow(/Invalid/);
      expect(() => b.part('cylinder', [0, 0, 0], [1, 2, 0.6], color)).toThrow(/circular/);
    }
  });

  it('detects an actual displaced contact and survives part pruning without silently rebinding it', () => {
    const park = scene(), b = new Parts(park), unused = b.box([20, 0, 0], [1, 1, 1], color);
    const base = b.box([0, 0, 0], [2, 0.5, 2], color), post = b.rod([0, 0.5, 0], [0, 3, 0], 0.2, color);
    registerJoint(park, { name: 'post / bearing plate', kind: 'fixed', a: partAnchor(base, [0, 0.5, 0]), b: partAnchor(post, [0, 0.5, 0]), rationale: 'Post end bears on the top face of the plate.' });
    expect(measureJoints(park)[0].pass).toBe(true);
    registerJoint(park, { name: 'invalid coincident markers', kind: 'fixed', a: partAnchor(base, [0, 10, 0]), b: partAnchor(post, [0, 10, 0]), rationale: 'A coincident marker outside both solids must fail the material test.' });
    expect(measureJoints(park)[1].anchorError).toBeGreaterThan(0); expect(measureJoints(park)[1].pass).toBe(false); park.joints!.pop();
    const old = park.parts; park.parts = old.filter(p => p !== unused); remapConstructionJoints(park, old);
    expect(measureJoints(park)[0].pass).toBe(true);
    post.pos[1] += 0.001; expect(measureJoints(park)[0].pass).toBe(false); expect(measureJoints(park)[0].lateralError).toBeCloseTo(0.001);
    const previous = park.parts; park.parts = [base]; expect(() => remapConstructionJoints(park, previous)).toThrow(/connected part/);
  });

  it('checks shared bearing axes throughout rotation and measures declared sliding travel', () => {
    const park = scene(), fixed = new Parts(park).rod([0, -1, 0], [0, 1, 0], 0.2, color), rotor = new Parts(park, [0, 0, 0], 0, 0).rod([0, -0.5, 0], [0, 0.5, 0], 0.3, color);
    registerJoint(park, { name: 'shaft / rotating sleeve', kind: 'hinge', a: partAnchor(fixed, [0, 0, 0], [0, 1, 0]), b: partAnchor(rotor, [0, 0, 0], [0, 1, 0]), rationale: 'Bearing permits rotation about the common shaft axis.' });
    const body = pose(); for (const angle of [0, 0.7, 2.9, 6]) { body.rot = axisAngle([0, 1, 0], angle); expect(measureJoints(park, [body])[0].pass).toBe(true); }
    body.rot = qmul(body.rot, axisAngle([0, 0, 1], 0.01)); expect(measureJoints(park, [body])[0].pass).toBe(false);
    park.joints = []; body.rot = [0, 0, 0, 1];
    registerJoint(park, { name: 'shaft / sliding sleeve', kind: 'slider', a: partAnchor(fixed, [0, 0, 0], [0, 1, 0]), b: partAnchor(rotor, [0, 0, 0], [0, 1, 0]), min: -0.1, max: 0.3, rationale: 'Declared axial guide travel, not a visual gap allowance.' });
    body.pos[1] = 0.3; expect(measureJoints(park, [body])[0].pass).toBe(true);
    body.pos[1] = 0.3001; expect(measureJoints(park, [body])[0].pass).toBe(false);
  });

  it('uses the same exact prism boundary in raster triangles, collision and ray tracing at all orientations', () => {
    const vertices = parkMesh('gable'); expect(vertices.length / 7).toBe(24);
    for (const yaw of [0, 0.91, 2.73]) for (const half of [[3, 1.2, 0.1], [0.12, 2, 4]] as Vec3[]) {
      const part = new Parts(scene(), [127, 12.2, -51], yaw).part('gable', [0, 0, 0], half, color, { localRot: axisAngle([1, 0, 0], 0.51) });
      for (let i = 0; i < vertices.length; i += 21) {
        const triangle = [0, 7, 14].map(o => [vertices[i + o] * half[0], vertices[i + o + 1] * half[1], vertices[i + o + 2] * half[2]] as Vec3);
        const center = mul(add(add(triangle[0], triangle[1]), triangle[2]), 1 / 3);
        const normal = unit(cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]))), result: Vec3 = [0, 0, 0];
        expect(partDistance(part, center, result)).toBeCloseTo(0, 10);
        for (let k = 0; k < 3; k++) expect(result[k]).toBeCloseTo(normal[k], 10);
        const worldNormal = rotate(part.rot, normal), origin = add(part.pos, rotate(part.rot, add(center, mul(normal, 0.7))));
        const ray = { type: 'gable' as const, center: part.pos, half: part.half, rot: part.rot, material: { albedo: color, metalness: 0, roughness: 0.8 } };
        expect(intersectPrim(ray, origin, mul(worldNormal, -1), 10)).toBeCloseTo(0.7, 10);
        const hitLocal = inverseRotate(part.rot, sub(add(origin, mul(worldNormal, -0.7)), part.pos));
        expect(partDistance(part, hitLocal, result)).toBeCloseTo(0, 10);
      }
    }
  });
});
