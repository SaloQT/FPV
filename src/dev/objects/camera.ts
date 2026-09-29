import type { Quat, Vec3 } from '../../contracts';

const DEG = Math.PI / 180;

/** Rotation whose body -Z axis points along (target - pos) with world +Y as the up hint. */
export function lookAtQuat(out: Quat, pos: Vec3, target: Vec3): void {
  let fx = target[0] - pos[0], fy = target[1] - pos[1], fz = target[2] - pos[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl; rz /= rl;
  const ux = -fy * rz, uy = rz * fx - rx * fz, uz = fy * rx;
  const m00 = rx, m10 = 0, m20 = rz, m01 = ux, m11 = uy, m21 = uz, m02 = -fx, m12 = -fy, m22 = -fz;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[0] = (m21 - m12) / s; out[1] = (m02 - m20) / s; out[2] = (m10 - m01) / s; out[3] = s / 4;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out[0] = s / 4; out[1] = (m01 + m10) / s; out[2] = (m02 + m20) / s; out[3] = (m21 - m12) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out[0] = (m01 + m10) / s; out[1] = s / 4; out[2] = (m12 + m21) / s; out[3] = (m02 - m20) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out[0] = (m02 + m20) / s; out[1] = (m12 + m21) / s; out[2] = s / 4; out[3] = (m10 - m01) / s;
  }
}

/** Point on the sphere around `target`: `az` degrees from +Z toward +X, `el` degrees above the horizon. */
export function orbitPosition(out: Vec3, target: Vec3, dist: number, azDeg: number, elDeg: number): void {
  const az = azDeg * DEG, el = elDeg * DEG;
  out[0] = target[0] + dist * Math.sin(az) * Math.cos(el);
  out[1] = target[1] + dist * Math.sin(el);
  out[2] = target[2] + dist * Math.cos(az) * Math.cos(el);
}

/** Quaternion [x, y, z, w] for yaw about +Y, then pitch about X (nose up positive), then roll about Z, all in degrees. */
export function eulerQuat(yawDeg: number, pitchDeg: number, rollDeg: number): Quat {
  const h = DEG / 2;
  const [sy, cy] = [Math.sin(yawDeg * h), Math.cos(yawDeg * h)];
  const [sp, cp] = [Math.sin(pitchDeg * h), Math.cos(pitchDeg * h)];
  const [sr, cr] = [Math.sin(rollDeg * h), Math.cos(rollDeg * h)];
  // q = qy * qx * qz, with qy * qx expanded by hand.
  return mulQ([cy * sp, sy * cp, -sy * sp, cy * cp], [0, 0, sr, cr]);
}

function mulQ(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
