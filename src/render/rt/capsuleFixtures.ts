/** Hardware parity regressions for thin capsules; source rays are rounded to float32 by the harness. */
import type { Vec3 } from '../../contracts';
import type { RTPrimitive } from '../contracts';

export interface CapsuleProbe { primitive: RTPrimitive; origin: Vec3; direction: Vec3; hit: boolean; distance?: number }
const material = { albedo: [0.13, 0.085, 0.05] as Vec3, roughness: 0.95, metalness: 0 };

export function capsuleRegressionCases(): CapsuleProbe[] {
  const cases: CapsuleProbe[] = [{
    primitive: { type: 'capsule', a: [-387.8878456841191, 20.9592414642416, -255.01750856595797], b: [-386.9999091717039, 21.11299344323522, -256.436175891604], radius: 0.031552260852605554, material },
    origin: [-375.2139892578125, 14.922133445739746, -264.8288879394531], direction: [-0.7470952868461609, 0.39167842268943787, 0.53706294298172], hit: true,
  }];
  for (const radius of [0.02, 0.08, 0.23]) for (const length of [0, 0.15, 4]) {
    const a: Vec3 = [730, 22, -820], b: Vec3 = [730, 22 + length, -820], primitive: RTPrimitive = { type: 'capsule', a, b, radius, material };
    cases.push(
      { primitive, origin: [730, 2, -820], direction: [0, 1, 0], hit: true, distance: 20 - radius },
      { primitive, origin: [730, 42 + length, -820], direction: [0, -1, 0], hit: true, distance: 20 - radius },
      { primitive, origin: [670, 22 + length / 2, -820], direction: [1, 0, 0], hit: true, distance: 60 - radius },
      { primitive, origin: [670, 22 + length / 2, -820 + radius * 1.1], direction: [1, 0, 0], hit: false },
      { primitive, origin: [730, 22 + length / 2, -820], direction: [1, 0, 0], hit: false },
      { primitive, origin: [730, 42 + length, -820], direction: [0, 1, 0], hit: false },
    );
  }
  return cases;
}
