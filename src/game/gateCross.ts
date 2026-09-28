import type { TrackGate, Vec3 } from '../contracts';

/** Orthonormal gate axes in world space: `forward` is the travel direction through the gate plane. */
export interface GateFrame {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export function makeGateFrame(): GateFrame {
  return { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };
}

/**
 * Yaw turns about +Y (0 faces -Z, positive counter-clockwise from above), pitch tilts the travel axis (positive climbs),
 * and roll turns right/up about `forward` (positive is clockwise seen from behind, so the top moves toward `right`).
 */
export function fillGateFrame(gate: TrackGate, out: GateFrame): GateFrame {
  const sy = Math.sin(gate.yaw), cy = Math.cos(gate.yaw);
  const sp = Math.sin(gate.pitch), cp = Math.cos(gate.pitch);
  const sr = Math.sin(gate.roll), cr = Math.cos(gate.roll);
  const rx = cy, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  out.forward[0] = -sy * cp;
  out.forward[1] = sp;
  out.forward[2] = -cy * cp;
  out.right[0] = rx * cr - ux * sr;
  out.right[1] = -uy * sr;
  out.right[2] = rz * cr - uz * sr;
  out.up[0] = ux * cr + rx * sr;
  out.up[1] = uy * cr;
  out.up[2] = uz * cr + rz * sr;
  return out;
}

/** True when the in-plane offset (u along right, v along up, metres from the opening centre) is in the clear opening. */
export function insideOpening(gate: TrackGate, u: number, v: number): boolean {
  const hw = gate.width / 2;
  const hh = gate.height / 2;
  switch (gate.kind) {
    case 'hoop':
    case 'dive':
      return (u * u) / (hw * hw) + (v * v) / (hh * hh) <= 1;
    case 'arch': {
      if (Math.abs(u) > hw || v < -hh) return false;
      const spring = Math.max(hh - hw, -hh);
      if (v <= spring) return true;
      const dv = v - spring;
      return u * u + dv * dv <= hw * hw;
    }
    default:
      return Math.abs(u) <= hw && Math.abs(v) <= hh;
  }
}

/**
 * Fraction (0..1] along prev -> pos at which the segment crosses the gate plane travelling forward inside the clear
 * opening, or -1 when it does not. Allocation-free; `frame` must be `fillGateFrame(gate)`.
 */
export function gateCrossing(gate: TrackGate, frame: GateFrame, prev: Vec3, pos: Vec3): number {
  const c = gate.pos;
  const f = frame.forward;
  const d0 = (prev[0] - c[0]) * f[0] + (prev[1] - c[1]) * f[1] + (prev[2] - c[2]) * f[2];
  const d1 = (pos[0] - c[0]) * f[0] + (pos[1] - c[1]) * f[1] + (pos[2] - c[2]) * f[2];
  if (!(d0 < 0 && d1 >= 0)) return -1;
  const t = d0 / (d0 - d1);
  const x = prev[0] + (pos[0] - prev[0]) * t - c[0];
  const y = prev[1] + (pos[1] - prev[1]) * t - c[1];
  const z = prev[2] + (pos[2] - prev[2]) * t - c[2];
  const r = frame.right;
  const u = frame.up;
  return insideOpening(gate, x * r[0] + y * r[1] + z * r[2], x * u[0] + y * u[1] + z * u[2]) ? t : -1;
}

const scratch = makeGateFrame();

/** Convenience form of `gateCrossing` that builds the frame itself. */
export function gateCrossed(gate: TrackGate, prev: Vec3, pos: Vec3): boolean {
  return gateCrossing(gate, fillGateFrame(gate, scratch), prev, pos) >= 0;
}
