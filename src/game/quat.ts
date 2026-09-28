import type { Quat, Vec3 } from '../contracts';

/** Hamilton product a * b (apply b first, then a). Safe when `out` aliases an input. */
export function quatMul(a: Quat, b: Quat, out: Quat): Quat {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Rotates a body-frame vector into the world frame. Safe when `out` aliases `v`. */
export function quatRotate(q: Quat, v: Vec3, out: Vec3): Vec3 {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  out[0] = v[0] + qw * tx + (qy * tz - qz * ty);
  out[1] = v[1] + qw * ty + (qz * tx - qx * tz);
  out[2] = v[2] + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** Shortest-arc spherical interpolation; falls back to a normalised lerp when the quaternions nearly coincide. */
export function quatSlerp(a: Quat, b: Quat, t: number, out: Quat): Quat {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0 = 1 - t;
  let s1 = t;
  if (dot < 0.9995) {
    const theta = Math.acos(dot);
    const inv = 1 / Math.sin(theta);
    s0 = Math.sin((1 - t) * theta) * inv;
    s1 = Math.sin(t * theta) * inv;
  }
  const x = a[0] * s0 + bx * s1;
  const y = a[1] * s0 + by * s1;
  const z = a[2] * s0 + bz * s1;
  const w = a[3] * s0 + bw * s1;
  const n = 1 / Math.hypot(x, y, z, w);
  out[0] = x * n;
  out[1] = y * n;
  out[2] = z * n;
  out[3] = w * n;
  return out;
}

/** Rotation about the body X axis; positive angles pitch the nose up. */
export function quatAxisX(angle: number, out: Quat): Quat {
  out[0] = Math.sin(angle / 2);
  out[1] = 0;
  out[2] = 0;
  out[3] = Math.cos(angle / 2);
  return out;
}

/** Yaw about +Y; positive turns counter-clockwise seen from above. */
export function quatYaw(yaw: number, out: Quat): Quat {
  out[0] = 0;
  out[1] = Math.sin(yaw / 2);
  out[2] = 0;
  out[3] = Math.cos(yaw / 2);
  return out;
}

/** Orientation whose -Z axis points along (fx, fy, fz) with +X kept horizontal (world +Y is "up"). */
export function quatLookAlong(fx: number, fy: number, fz: number, out: Quat): Quat {
  const fl = Math.hypot(fx, fy, fz);
  if (fl < 1e-12) {
    fx = 0;
    fy = 0;
    fz = -1;
  } else {
    fx /= fl;
    fy /= fl;
    fz /= fl;
  }
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  // u = r x f, with r = (rx, 0, rz)
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const m00 = rx, m01 = ux, m02 = -fx;
  const m11 = uy, m12 = -fy;
  const m20 = rz, m21 = uz, m22 = -fz;
  const m10 = 0;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[3] = 0.25 * s;
    out[0] = (m21 - m12) / s;
    out[1] = (m02 - m20) / s;
    out[2] = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out[3] = (m21 - m12) / s;
    out[0] = 0.25 * s;
    out[1] = (m01 + m10) / s;
    out[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out[3] = (m02 - m20) / s;
    out[0] = (m01 + m10) / s;
    out[1] = 0.25 * s;
    out[2] = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out[3] = (m10 - m01) / s;
    out[0] = (m02 + m20) / s;
    out[1] = (m12 + m21) / s;
    out[2] = 0.25 * s;
  }
  return out;
}
