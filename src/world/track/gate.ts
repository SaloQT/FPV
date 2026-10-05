/**
 * Gate geometry shared by the renderer, the colliders and the game logic.
 *
 * Frame: `forward` is the travel direction (yaw and pitch), `right` is horizontal for an unrolled gate, `up = right x forward`.
 * Roll then turns right/up about `forward`; positive roll is clockwise seen from behind (the top moves toward `right`).
 *
 * Opening shapes by kind: square / start / finish / flag are the full width x height rectangle (a flag gate is two poles a
 * `width` apart), hoop and dive are the inscribed ellipse, arch is a rectangle capped by a semicircle of radius width / 2.
 */
import type { TrackGate, Vec3 } from '../../contracts';

export interface GateFrame {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

/** Side length of the tube the gate frames are built from (rendered and collided). */
export const GATE_TUBE = 0.06;

export function trackGateFrame(gate: TrackGate, out: GateFrame = { right: [0, 0, 0], up: [0, 0, 0], forward: [0, 0, 0] }): GateFrame {
  const sy = Math.sin(gate.yaw);
  const cy = Math.cos(gate.yaw);
  const sp = Math.sin(gate.pitch);
  const cp = Math.cos(gate.pitch);
  const sr = Math.sin(gate.roll);
  const cr = Math.cos(gate.roll);
  const rx = cy;
  const rz = -sy;
  const ux = sy * sp;
  const uy = cp;
  const uz = cy * sp;
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

/** Height of the arch springing line above the opening centre (the round part is a semicircle of radius width / 2). */
export function archSpring(gate: TrackGate): number {
  return Math.max(gate.height / 2 - gate.width / 2, -gate.height / 2);
}

/** True when the in-plane point (u along right, v along up, metres from the opening centre) is inside the clear opening. */
export function insideOpening(gate: TrackGate, u: number, v: number): boolean {
  const hw = gate.width / 2;
  const hh = gate.height / 2;
  switch (gate.kind) {
    case 'hoop':
    case 'dive':
    case 'drop':
      return (u * u) / (hw * hw) + (v * v) / (hh * hh) <= 1;
    case 'arch': {
      if (Math.abs(u) > hw || v < -hh) return false;
      const vs = archSpring(gate);
      if (v <= vs) return true;
      const dv = v - vs;
      return u * u + dv * dv <= hw * hw;
    }
    default:
      return Math.abs(u) <= hw && Math.abs(v) <= hh;
  }
}

const scratch: GateFrame = { right: [0, 0, 0], up: [0, 0, 0], forward: [0, 0, 0] };

/** True when the segment prevPos -> pos crosses the gate plane in the travel direction inside the clear opening. */
export function gatePassed(gate: TrackGate, prevPos: Vec3, pos: Vec3): boolean {
  const f = trackGateFrame(gate, scratch);
  const c = gate.pos;
  const d0 = (prevPos[0] - c[0]) * f.forward[0] + (prevPos[1] - c[1]) * f.forward[1] + (prevPos[2] - c[2]) * f.forward[2];
  const d1 = (pos[0] - c[0]) * f.forward[0] + (pos[1] - c[1]) * f.forward[1] + (pos[2] - c[2]) * f.forward[2];
  if (!(d0 < 0 && d1 >= 0)) return false;
  const t = d0 / (d0 - d1);
  const hx = prevPos[0] + (pos[0] - prevPos[0]) * t - c[0];
  const hy = prevPos[1] + (pos[1] - prevPos[1]) * t - c[1];
  const hz = prevPos[2] + (pos[2] - prevPos[2]) * t - c[2];
  const u = hx * f.right[0] + hy * f.right[1] + hz * f.right[2];
  const v = hx * f.up[0] + hy * f.up[1] + hz * f.up[2];
  return insideOpening(gate, u, v);
}

/** Points (u, v) on the edge of the clear opening: the corners and edge mid-points of a rectangle, or evenly spaced on a curve. */
export function gateOutline(gate: TrackGate, out: [number, number][] = []): [number, number][] {
  out.length = 0;
  const hw = gate.width / 2;
  const hh = gate.height / 2;
  if (gate.kind === 'hoop' || gate.kind === 'dive' || gate.kind === 'drop') {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      out.push([hw * Math.cos(a), hh * Math.sin(a)]);
    }
    return out;
  }
  out.push([-hw, -hh], [0, -hh], [hw, -hh], [-hw, 0], [hw, 0]);
  if (gate.kind === 'arch') {
    const vs = archSpring(gate);
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI;
      out.push([hw * Math.cos(a), vs + hw * Math.sin(a)]);
    }
  } else out.push([-hw, hh], [0, hh], [hw, hh]);
  return out;
}
