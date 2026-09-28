import type { TrackData, TrackGate, Vec3 } from '../contracts';
import { fillGateFrame, makeGateFrame } from './gateCross';

/** A respawn drops the quad this far before the last gate it cleared, so the pilot re-flies through it. */
export const RESPAWN_BACK_M = 1.5;
/** Minimum clearance above the terrain for an in-air checkpoint spawn. */
export const RESPAWN_MIN_AGL = 1.5;
/** The pad spawn sits a hair above the ground so the collision solver does not start inside it. */
export const PAD_LIFT_M = 0.05;

export type GroundHeightFn = (x: number, z: number) => number;

export interface Placement {
  pos: Vec3;
  /** Heading in radians (see COORDINATES: 0 faces -Z, positive counter-clockwise). */
  yaw: number;
  /** True for a mid-air checkpoint spawn: the session arms and holds hover throttle instead of waiting on the pad. */
  airborne: boolean;
}

export function createPlacement(): Placement {
  return { pos: [0, 0, 0], yaw: 0, airborne: false };
}

export function padPlacement(track: TrackData | null, out: Placement): Placement {
  const start = track?.start;
  out.pos[0] = start?.pos[0] ?? 0;
  out.pos[1] = (start?.pos[1] ?? 0) + PAD_LIFT_M;
  out.pos[2] = start?.pos[2] ?? 0;
  out.yaw = start?.yaw ?? 0;
  out.airborne = false;
  return out;
}

const frame = makeGateFrame();

/** 1.5 m before the gate along its travel axis, facing the direction of travel, at least 1.5 m above the ground. */
export function gatePlacement(gate: TrackGate, groundAt: GroundHeightFn | undefined, out: Placement): Placement {
  const f = fillGateFrame(gate, frame).forward;
  const x = gate.pos[0] - f[0] * RESPAWN_BACK_M;
  const z = gate.pos[2] - f[2] * RESPAWN_BACK_M;
  let y = gate.pos[1] - f[1] * RESPAWN_BACK_M;
  if (groundAt !== undefined) y = Math.max(y, groundAt(x, z) + RESPAWN_MIN_AGL);
  out.pos[0] = x;
  out.pos[1] = y;
  out.pos[2] = z;
  out.yaw = gate.yaw;
  out.airborne = true;
  return out;
}

/** The last cleared gate is the checkpoint; with none (or no track) the quad returns to the start pad. */
export function respawnPlacement(track: TrackData | null, lastGate: number, groundAt: GroundHeightFn | undefined, out: Placement): Placement {
  const gate = track !== null && lastGate >= 0 ? track.gates[lastGate] : undefined;
  return gate === undefined ? padPlacement(track, out) : gatePlacement(gate, groundAt, out);
}
