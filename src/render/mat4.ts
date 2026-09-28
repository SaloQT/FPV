/** Column-major 4x4 helpers writing into caller-owned Float32Array/number[] (no allocation). WebGPU clip space: z in [0,1]. */

export type M4 = Float32Array | number[];

export function mat4Identity(o: M4): M4 {
  for (let i = 0; i < 16; i++) o[i] = i % 5 === 0 ? 1 : 0;
  return o;
}

/** out = a * b (column-major). `out` must not alias a or b. */
export function mat4Mul(out: M4, a: M4, b: M4): M4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/** General inverse; returns false (and leaves identity) if singular. `out` must not alias `m`. */
export function mat4Invert(out: M4, m: M4): boolean {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) { mat4Identity(out); return false; }
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

/** Reverse-Z, infinite-far perspective (depth 1 at `near`, 0 at infinity), WebGPU clip z in [0,1]. */
export function mat4PerspectiveReverseZ(out: M4, fovY: number, aspect: number, near: number): M4 {
  const f = 1 / Math.tan(fovY * 0.5);
  for (let i = 0; i < 16; i++) out[i] = 0;
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  out[14] = near;
  return out;
}

/** World->camera matrix from camera position and camera->world quaternion [x,y,z,w] (camera looks down -Z). */
export function mat4ViewFromPosQuat(out: M4, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): M4 {
  const n = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
  qx *= n; qy *= n; qz *= n; qw *= n;
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  // Rotation R (camera->world), columns r0,r1,r2. View = [R^T | -R^T p].
  const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wz), r02 = 2 * (xz + wy);
  const r10 = 2 * (xy + wz), r11 = 1 - 2 * (xx + zz), r12 = 2 * (yz - wx);
  const r20 = 2 * (xz - wy), r21 = 2 * (yz + wx), r22 = 1 - 2 * (xx + yy);
  out[0] = r00; out[1] = r01; out[2] = r02; out[3] = 0;
  out[4] = r10; out[5] = r11; out[6] = r12; out[7] = 0;
  out[8] = r20; out[9] = r21; out[10] = r22; out[11] = 0;
  out[12] = -(r00 * px + r10 * py + r20 * pz);
  out[13] = -(r01 * px + r11 * py + r21 * pz);
  out[14] = -(r02 * px + r12 * py + r22 * pz);
  out[15] = 1;
  return out;
}

/** Camera->world matrix (inverse of the view matrix) built directly from the same inputs. */
export function mat4WorldFromPosQuat(out: M4, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): M4 {
  const n = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
  qx *= n; qy *= n; qz *= n; qw *= n;
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  out[0] = 1 - 2 * (yy + zz); out[1] = 2 * (xy + wz); out[2] = 2 * (xz - wy); out[3] = 0;
  out[4] = 2 * (xy - wz); out[5] = 1 - 2 * (xx + zz); out[6] = 2 * (yz + wx); out[7] = 0;
  out[8] = 2 * (xz + wy); out[9] = 2 * (yz - wx); out[10] = 1 - 2 * (xx + yy); out[11] = 0;
  out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
  return out;
}
