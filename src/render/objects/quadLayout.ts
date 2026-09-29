/**
 * Dimensions of the 5 inch quad shared by the mesh builders, the animation and the tests. Frame coordinates have their origin at the
 * arm-plane centre (x right, y up, -z forward); body coordinates are frame minus the centre of mass, because QuadState.pos is the COM.
 */
import type { Vec3 } from '../../contracts';

/** Centre of mass in frame coordinates, from the physics part list (QUAD_5IN_6S). */
export const QUAD_COM: Vec3 = [0, 0.023249230769, 0.000593846154];
export const WHEELBASE = 0.22;
export const ARM_REACH = WHEELBASE / (2 * Math.SQRT2);
export const MOTOR_Y = 0.006;
export const PROP_Y = 0.022;

/** Seen from above, +1 counter-clockwise and -1 clockwise, for motors 0 FR, 1 RR, 2 RL, 3 FL (the physics QUAD_X_SPIN table). */
export const MOTOR_SPIN: readonly number[] = [-1, 1, -1, 1];
const CORNER_SIGN: readonly (readonly [number, number])[] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

/** Motor axis at the arm plane, frame coordinates. */
export const MOTOR_SLOT: readonly Vec3[] = CORNER_SIGN.map(([sx, sz]): Vec3 => [sx * ARM_REACH, 0, sz * ARM_REACH]);

/** Frame coordinates to body coordinates (origin at the centre of mass). */
export const toBody = (p: Vec3): Vec3 => [p[0] - QUAD_COM[0], p[1] - QUAD_COM[1], p[2] - QUAD_COM[2]];

/** Motor hub in body coordinates: matches the physics motorPos. */
export const MOTOR_BODY: readonly Vec3[] = MOTOR_SLOT.map((s) => toBody([s[0], MOTOR_Y, s[2]]));
/** Rotor plane centre in body coordinates. */
export const PROP_BODY: readonly Vec3[] = MOTOR_SLOT.map((s) => toBody([s[0], PROP_Y, s[2]]));

/** Which motors turn clockwise seen from above (they use the mirrored prop mesh). */
export const CLOCKWISE_MOTORS: readonly number[] = [0, 2];
export const COUNTER_CLOCKWISE_MOTORS: readonly number[] = [1, 3];

export const BOTTOM_PLATE = { y0: -0.0065, y1: -0.0015 } as const;
export const TOP_PLATE = { y0: 0.031, y1: 0.033 } as const;
/** Standoff centres (x, z), mirrored into four corners. */
export const STANDOFF = { x: 0.0205, z: 0.04 } as const;
export const BODY_HALF = { x: 0.0245, z: 0.055 } as const;

/** 6S 1300 mAh pack on the top plate: centre and half extents, frame coordinates. */
export const BATTERY = { centre: [0, 0.05, 0] as Vec3, half: [0.0175, 0.016, 0.0375] as Vec3 } as const;
export const STRAP_Z = 0.024;

/** FPV camera: pivot in frame coordinates and its fixed up-tilt. */
export const CAMERA = { pos: [0, 0.02, -0.062] as Vec3, tilt: (30 * Math.PI) / 180 } as const;

export const MOTOR_TOP_Y = 0.0195;
export const ARM_TOP_Y = BOTTOM_PLATE.y1;

/** Adapts an AO function written in frame coordinates to the builder, whose vertices are in body coordinates (frame minus COM). */
export const inFrame =
  (f: (x: number, y: number, z: number) => number) =>
  (x: number, y: number, z: number): number =>
    f(x + QUAD_COM[0], y + QUAD_COM[1], z + QUAD_COM[2]);

export function applyAffine(m: readonly number[], p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

export const smooth01 = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
