import type { Vec3 } from '../../contracts';
import { GUEST_ANKLE_Y, GUEST_HIP_X, GUEST_HIP_Y, GUEST_KNEE_Y, GUEST_SEATED_ANGLE, guestStraddleYaw, guestContactLeg, guestGaitRate, guestGripArm, guestHeadScale, guestLegPose, guestSeatSetback } from '../../world/park/guestPose';
import { parkMesh } from './mesh';

/**
 * Reference copy of the guest vertex shader's body shaping and bone bending, run on the CPU so tests can
 * measure where every vertex of the real guest meshes ends up. It must follow src/render/shaders/park/parts.wgsl.
 */
export interface GuestLook { width: number; depth: number; head: number; headDepth: number }
/** Extremes of the shader's random body build: slimmest, broadest, and the middle. */
export const GUEST_LOOKS: Record<'slim' | 'mid' | 'broad', GuestLook> = {
  slim: { width: 0.88, depth: 0.88, head: 0.82, headDepth: 0.95 },
  mid: { width: 1.015, depth: 1.04, head: 0.88, headDepth: 1 },
  broad: { width: 1.15, depth: 1.2, head: 0.94, headDepth: 1.05 },
};
export type GuestPoseState =
  | { kind: 'walk'; time: number; speed: number }
  | { kind: 'seated'; blend: number; seatAngle?: number; /** 1 for a rider straddling a mount, 0 otherwise. */ straddle?: number; /** How far the seat pan reaches in front of the seat origin, metres. */ panFront?: number }
  | { kind: 'contact'; targets: ArrayLike<number>; speed?: number };
export type GuestLod = 'far' | 'near' | 'hero';
export const GUEST_LOD_SIDES: Record<GuestLod, [shape: 'guest' | 'guestHero', sides: number]> = { far: ['guest', 6], near: ['guest', 12], hero: ['guestHero', 24] };
const meshCache = new Map<GuestLod, Float32Array>();
export function guestMesh(lod: GuestLod): Float32Array {
  let mesh = meshCache.get(lod);
  if (!mesh) { const [shape, sides] = GUEST_LOD_SIDES[lod]; mesh = parkMesh(shape, sides); meshCache.set(lod, mesh); }
  return mesh;
}
export const GUEST_LODS: GuestLod[] = ['far', 'near', 'hero'];

const bendX = (p: Vec3, c: number, s: number): Vec3 => [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Body shaping applied to the rest pose: one build below the shoulders, blending to a head shape across the neck. */
export function shapeGuest(p: Vec3, n: Vec3, look: GuestLook, height = 1.75): { pos: Vec3; normal: Vec3 } {
  const t = Math.min(1, Math.max(0, (p[1] - 0.8) / 0.1)), blend = smoothstep(t), derivative = 60 * t * (1 - t), grow = guestHeadScale(height);
  const head = look.head * grow, headDepth = look.headDepth * grow;
  const sx = look.width + (head - look.width) * blend, sz = look.depth + (headDepth - look.depth) * blend;
  const slopeX = (head - look.width) * derivative, slopeZ = (headDepth - look.depth) * derivative;
  // The head also grows upward from the base of the neck, by the same factor.
  const ky = 1 + (grow - 1) * blend, stretch = ky + (grow - 1) * derivative * (p[1] - 0.84);
  const normal: Vec3 = [n[0] / sx, (n[1] - p[0] * slopeX * n[0] / sx - p[2] * slopeZ * n[2] / sz) / stretch, n[2] / sz], length = Math.hypot(...normal);
  return { pos: [p[0] * sx, 0.84 + (p[1] - 0.84) * ky, p[2] * sz], normal: normal.map(x => x / length) as Vec3 };
}

/** Skins one mesh vertex into guest-local normalized space (feet at y = 0, head top at y = 1, before scaling by the guest's height). A seated guest also sits forward on the cushion. */
export function skinGuestVertex(p: Vec3, n: Vec3, jointCode: number, state: GuestPoseState, height: number, look: GuestLook, seatAngle = GUEST_SEATED_ANGLE): Vec3 {
  const v = bendBones(p, n, jointCode, state, height, look, seatAngle);
  // A rider astride a mount has no seat back to sit clear of.
  if (state.kind === 'seated') v[2] -= guestSeatSetback(height, state.panFront) / height * state.blend * (1 - (state.straddle ?? 0));
  return v;
}

function bendBones(p: Vec3, n: Vec3, jointCode: number, state: GuestPoseState, height: number, look: GuestLook, seatAngle = GUEST_SEATED_ANGLE): Vec3 {
  const packed = Math.floor(jointCode), joint = packed & 15, weight = (jointCode - packed) * 2;
  const shaped = shapeGuest(p, n, look, height);
  let pos = shaped.pos;
  const arm = joint === 2 || joint === 3 || joint === 10 || joint === 11, leg = joint >= 4 && joint <= 9, right = (joint & 1) === 1;
  let drop = 0, walk: ReturnType<typeof guestLegPose> | undefined;
  if (state.kind === 'walk' && state.speed > 0.00001) walk = guestLegPose(state.time, state.speed, height, right);
  if (state.kind === 'contact') walk = guestContactLeg(state.targets, right, state.speed ?? 1.2);
  if (walk) {
    drop = walk.drop;
    if (leg) {
      if (joint >= 8) return [pos[0], pos[1] + walk.ankle[0] - GUEST_ANKLE_Y - drop, pos[2] + walk.ankle[1]];
      if (joint >= 6) {
        const bent = bendX([pos[0], pos[1] - GUEST_KNEE_Y, pos[2]], walk.knee[0], walk.knee[1]);
        pos = pos.map((x, k) => x + (bent[k] + (k === 1 ? GUEST_KNEE_Y : 0) - x) * weight) as Vec3;
      }
      const b = bendX([pos[0], pos[1] - GUEST_HIP_Y, pos[2]], walk.hip[0], walk.hip[1]);
      return [b[0], b[1] + GUEST_HIP_Y - drop, b[2]];
    }
  }
  if (joint === 1) return [pos[0], pos[1] - drop, pos[2]];
  if (!arm && !leg) return [pos[0], pos[1] - drop, pos[2]];
  const seated = state.kind === 'seated' ? state.blend : 0;
  const speed = state.kind === 'walk' ? state.speed : state.kind === 'contact' ? state.speed ?? 1.2 : 0;
  const time = state.kind === 'walk' ? state.time : 0;
  const rate = guestGaitRate(height);
  const gait = Math.cos(time * rate + (right ? Math.PI : 0)) * Math.min(speed, 1.2) * 0.42;
  const fold = Math.max(GUEST_SEATED_ANGLE, seatAngle);
  const grip = arm && seated > 0 ? guestGripArm(height, state.kind === 'seated' ? state.panFront : undefined) : [0.7, 1.15];
  const angle = (arm ? -gait : gait) * (1 - seated) + (arm ? grip[0] : fold) * seated;
  const pivotY = arm ? 0.785 : 0.525;
  if (joint >= 6 && joint <= 11) {
    const childY = arm ? 0.615 : 0.285, bend = arm ? 0.12 * (1 - seated) + grip[1] * seated : -Math.max(0, gait) * 0.75 * (1 - seated) - fold * seated;
    const bent = bendX([pos[0], pos[1] - childY, pos[2]], Math.cos(bend), Math.sin(bend));
    pos = pos.map((x, k) => x + (bent[k] + (k === 1 ? childY : 0) - x) * weight) as Vec3;
  }
  const b = bendX([pos[0], pos[1] - pivotY, pos[2]], Math.cos(angle), Math.sin(angle));
  const out: Vec3 = [b[0], b[1] + pivotY - drop, b[2]];
  if (leg && state.kind === 'seated' && state.straddle) {
    // Each leg swings outward about the vertical through its hip.
    const side = right ? 1 : -1, psi = -side * guestStraddleYaw(height) * state.straddle * seated, hx = side * GUEST_HIP_X, dx = out[0] - hx;
    out[0] = hx + Math.cos(psi) * dx + Math.sin(psi) * out[2]; out[2] = -Math.sin(psi) * dx + Math.cos(psi) * out[2];
  }
  return out;
}

/** All skinned vertices of a LOD as an array of positions (three per triangle), with each vertex's joint, material and rest position. */
export function skinGuestMesh(lod: GuestLod, state: GuestPoseState, height: number, look: GuestLook, seatAngle = GUEST_SEATED_ANGLE): { pos: Vec3; joint: number; material: number; rest: Vec3 }[] {
  const mesh = guestMesh(lod), out: { pos: Vec3; joint: number; material: number; rest: Vec3 }[] = [];
  for (let i = 0; i < mesh.length; i += 7) {
    const code = mesh[i + 6], packed = Math.floor(code), rest: Vec3 = [mesh[i], mesh[i + 1], mesh[i + 2]];
    out.push({ pos: skinGuestVertex(rest, [mesh[i + 3], mesh[i + 4], mesh[i + 5]], code, state, height, look, seatAngle), joint: packed & 15, material: packed >> 4, rest });
  }
  return out;
}
