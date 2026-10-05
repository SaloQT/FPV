/**
 * The brain's observation vector, built from the true quad state and the track (layout in spec.ts). env.wgsl builds the same
 * vector on the GPU during training; observe.test.ts pins the slots and gpu parity checks the two agree.
 */
import type { QuadState, TrackGate, Vec3 } from '../contracts';
import { trackGateFrame, type GateFrame } from '../world/track/gate';
import {
  AGL_MAX, AGL_SCALE, CELL_VOLT_CENTRE, DIST_MAX, DIST_SCALE, MOTOR_SCALE, OBS, OBS_SIZE, RATE_SCALE, VEL_SCALE, gateShape,
} from './spec';

/** A gate with its frame precomputed (the frame only depends on the gate's angles). */
export interface ObsGate {
  pos: Vec3;
  frame: GateFrame;
  width: number;
  height: number;
  shape: number;
}

export function obsGates(gates: readonly TrackGate[]): ObsGate[] {
  return gates.map((g) => ({ pos: [g.pos[0], g.pos[1], g.pos[2]], frame: trackGateFrame(g), width: g.width, height: g.height, shape: gateShape(g.kind) }));
}

export interface ObsContext {
  gates: readonly ObsGate[];
  closed: boolean;
  /** Index of the gate to fly through next. */
  next: number;
  /** Ground height under the quad (the physics ground: terrain plus the start pad). */
  groundY: number;
  prevAction: ArrayLike<number>;
  cells: number;
}

/** Index of the gate after `next`, or -1 on an open track's last gate. */
export function gateAfter(next: number, count: number, closed: boolean): number {
  if (next + 1 < count) return next + 1;
  return closed ? 0 : -1;
}

/** Writes the observation into `out` (length OBS_SIZE). Allocation-free. */
export function observe(s: QuadState, c: ObsContext, out: Float32Array | Float64Array): void {
  const [qx, qy, qz, qw] = s.quat;
  // Body -> world rotation, row-major (same as quatToMat3); world -> body is its transpose.
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const r0 = 1 - 2 * (yy + zz), r1 = 2 * (xy - wz), r2 = 2 * (xz + wy);
  const r3 = 2 * (xy + wz), r4 = 1 - 2 * (xx + zz), r5 = 2 * (yz - wx);
  const r6 = 2 * (xz - wy), r7 = 2 * (yz + wx), r8 = 1 - 2 * (xx + yy);
  const toBody = (x: number, y: number, z: number, o: number, k: number): void => {
    out[o] = (r0 * x + r3 * y + r6 * z) * k;
    out[o + 1] = (r1 * x + r4 * y + r7 * z) * k;
    out[o + 2] = (r2 * x + r5 * y + r8 * z) * k;
  };
  if (out.length !== OBS_SIZE) throw new Error(`observation buffer must hold ${OBS_SIZE} values`);
  out.fill(0);
  toBody(s.vel[0], s.vel[1], s.vel[2], OBS.vel, VEL_SCALE);
  out[OBS.rate] = s.angVel[0] * RATE_SCALE;
  out[OBS.rate + 1] = s.angVel[1] * RATE_SCALE;
  out[OBS.rate + 2] = s.angVel[2] * RATE_SCALE;
  out[OBS.up] = r3;
  out[OBS.up + 1] = r4;
  out[OBS.up + 2] = r5;
  const agl = s.pos[1] - c.groundY;
  out[OBS.agl] = (agl < 0 ? 0 : agl > AGL_MAX ? AGL_MAX : agl) * AGL_SCALE;

  const n = c.gates.length;
  if (n > 0) {
    const g1 = c.gates[((c.next % n) + n) % n];
    const dx = g1.pos[0] - s.pos[0], dy = g1.pos[1] - s.pos[1], dz = g1.pos[2] - s.pos[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1e-6) toBody(dx, dy, dz, OBS.g1Dir, 1 / d);
    out[OBS.g1Dist] = (d > DIST_MAX ? DIST_MAX : d) * DIST_SCALE;
    const f = g1.frame.forward, u = g1.frame.up;
    toBody(f[0], f[1], f[2], OBS.g1Fwd, 1);
    toBody(u[0], u[1], u[2], OBS.g1Up, 1);
    out[OBS.g1Size] = g1.width * 0.25;
    out[OBS.g1Size + 1] = g1.height * 0.25;
    out[OBS.g1Shape] = g1.shape;
    const along = -(dx * f[0] + dy * f[1] + dz * f[2]);
    out[OBS.g1Along] = (along > DIST_MAX ? DIST_MAX : along < -DIST_MAX ? -DIST_MAX : along) * DIST_SCALE;
    const after = gateAfter(((c.next % n) + n) % n, n, c.closed);
    if (after >= 0) {
      const g2 = c.gates[after];
      const ex = g2.pos[0] - g1.pos[0], ey = g2.pos[1] - g1.pos[1], ez = g2.pos[2] - g1.pos[2];
      const e = Math.sqrt(ex * ex + ey * ey + ez * ez);
      toBody(ex, ey, ez, OBS.g2Rel, (e > DIST_MAX ? DIST_MAX / e : 1) * DIST_SCALE);
      const f2 = g2.frame.forward;
      toBody(f2[0], f2[1], f2[2], OBS.g2Fwd, 1);
      out[OBS.g2Valid] = 1;
    }
  }
  for (let i = 0; i < 4; i++) {
    out[OBS.prevAct + i] = c.prevAction[i];
    out[OBS.motor + i] = s.motorOmega[i] * MOTOR_SCALE;
  }
  out[OBS.battery] = s.batteryVoltage / c.cells - CELL_VOLT_CENTRE;
}
