/** Ray-tracing proxy of the quad: 11 analytic primitives moved rigidly with the body, updated in place every frame. */
import type { Quat, Vec3 } from '../../contracts';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { BATTERY, CAMERA, MOTOR_SLOT, toBody } from './quadLayout';

const CARBON: RTMaterial = { albedo: [0.03, 0.03, 0.034], roughness: 0.45, metalness: 0 };
const PACK: RTMaterial = { albedo: [0.02, 0.02, 0.022], roughness: 0.6, metalness: 0 };
const ALU: RTMaterial = { albedo: [0.9, 0.2, 0.02], roughness: 0.35, metalness: 1 };
const PLASTIC: RTMaterial = { albedo: [0.02, 0.02, 0.02], roughness: 0.5, metalness: 0 };

export const QUAD_RT_PRIMITIVES = 11;

const IDENTITY: Quat = [0, 0, 0, 1];

const tiltHalf = CAMERA.tilt / 2;
const CAMERA_ROT: Quat = [Math.sin(tiltHalf), 0, 0, Math.cos(tiltHalf)];

function rotateInto(out: Vec3, q: Quat, v: Vec3, origin: Vec3): void {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  out[0] = origin[0] + v[0] + w * tx + (y * tz - z * ty);
  out[1] = origin[1] + v[1] + w * ty + (z * tx - x * tz);
  out[2] = origin[2] + v[2] + w * tz + (x * ty - y * tx);
}

function mulInto(out: Quat, a: Quat, b: Quat): void {
  out[0] = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
  out[1] = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
  out[2] = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
  out[3] = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
}

export interface QuadRt {
  prims: RTPrimitive[];
  /** Moves every primitive to the body pose (`pos` is the centre of mass, `quat` maps body to world). */
  update(pos: Vec3, quat: Quat): void;
}

export function createQuadRt(): QuadRt {
  const prims: RTPrimitive[] = [];
  const local: { a: Vec3; b: Vec3; q: Quat }[] = [];
  const box = (centre: Vec3, half: Vec3, q: Quat, material: RTMaterial): void => {
    prims.push({ type: 'obb', center: [0, 0, 0], half, rot: [0, 0, 0, 1], material });
    local.push({ a: toBody(centre), b: centre, q });
  };
  const capsule = (a: Vec3, b: Vec3, radius: number, material: RTMaterial): void => {
    prims.push({ type: 'capsule', a: [0, 0, 0], b: [0, 0, 0], radius, material });
    local.push({ a: toBody(a), b: toBody(b), q: IDENTITY });
  };
  box([0, 0.0132, 0], [0.0245, 0.0198, 0.055], IDENTITY, CARBON);
  box(BATTERY.centre, BATTERY.half, IDENTITY, PACK);
  box(CAMERA.pos, [0.0125, 0.0115, 0.0105], CAMERA_ROT, PLASTIC);
  for (const s of MOTOR_SLOT) {
    const sx = Math.sign(s[0]);
    const sz = Math.sign(s[2]);
    capsule([sx * 0.026, -0.004, sz * 0.026], [s[0] - sx * 0.004, -0.004, s[2] - sz * 0.004], 0.007, CARBON);
    capsule([s[0], -0.0015, s[2]], [s[0], 0.0195, s[2]], 0.0142, ALU);
  }
  return {
    prims,
    update(pos, quat) {
      for (let i = 0; i < prims.length; i++) {
        const p = prims[i];
        const l = local[i];
        if (p.type === 'obb') {
          rotateInto(p.center, quat, l.a, pos);
          mulInto(p.rot, quat, l.q);
        } else if (p.type === 'capsule') {
          rotateInto(p.a, quat, l.a, pos);
          rotateInto(p.b, quat, l.b, pos);
        }
      }
    },
  };
}
