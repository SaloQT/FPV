import type { Vec3 } from '../contracts';

export interface AeroParams {
  /** Drag area Cd*A for flow along each body axis (x right, y up/top-down, z back/front-on), m^2. */
  cdaX: number;
  cdaY: number;
  cdaZ: number;
  /** Linear (viscous/rotor-wash) drag, N per m/s. */
  linearDrag: number;
  /** Rotational damping about each body axis, Nm per rad/s. */
  angularDamping: Vec3;
  /** Quadratic rotational damping (frame + disc drag), Nm per (rad/s)^2. */
  angularDampingQuad: number;
}

/** Anisotropic quadratic body drag F_i = -0.5 rho CdA_i |v| v_i - c v_i for the air-relative body-frame velocity. */
export function bodyDrag(p: AeroParams, rho: number, vx: number, vy: number, vz: number, out: Vec3): void {
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const k = 0.5 * rho * speed;
  out[0] = -(k * p.cdaX + p.linearDrag) * vx;
  out[1] = -(k * p.cdaY + p.linearDrag) * vy;
  out[2] = -(k * p.cdaZ + p.linearDrag) * vz;
}

/** Aerodynamic damping torque for body rates (wx, wy, wz). */
export function angularDrag(p: AeroParams, wx: number, wy: number, wz: number, out: Vec3): void {
  const q = p.angularDampingQuad;
  out[0] = -(p.angularDamping[0] + q * Math.abs(wx)) * wx;
  out[1] = -(p.angularDamping[1] + q * Math.abs(wy)) * wy;
  out[2] = -(p.angularDamping[2] + q * Math.abs(wz)) * wz;
}
