import type { CameraState, QuadState, Quat, Vec3 } from '../contracts';
import type { OrbitDelta } from '../input/pointer';
import type { GroundHeightFn } from './checkpoint';
import { quatAxisX, quatLookAlong, quatMul, quatRotate } from './quat';
import { DEG } from './units';

export type CameraMode = 'fpv' | 'chase' | 'free';
export const CAMERA_MODES: readonly CameraMode[] = ['fpv', 'chase', 'free'];

export const CAMERA_NEAR = 0.05;
export const CAMERA_FAR = 20000;
/** The FPV camera sits this far from the quad's centre in body axes: a little above and ahead of it. */
export const FPV_MOUNT: Readonly<Vec3> = [0, 0.02, -0.05];
export const CHASE_DISTANCE = 1.6;
export const CHASE_HEIGHT = 0.6;
export const MIN_ORBIT_M = 0.6;
export const MAX_ORBIT_M = 80;
/** Clearance the third-person cameras keep above the terrain. */
export const CAMERA_MIN_AGL = 0.25;

export interface CameraSettings {
  /** Vertical field of view in degrees. */
  fov: number;
  /** FPV camera up-tilt in degrees. */
  cameraTiltDeg: number;
  /** 0..1 strength of the motor buzz shaken into the FPV picture. */
  camVibration: number;
}

const HEADING_OMEGA = 5;
const TELEPORT_M = 15;
const MAX_STEP_S = 0.1;
const MIN_FOV_DEG = 20;
const MAX_FOV_DEG = 160;
/** Vertical field of view cap of the chase and free cameras (the FPV camera keeps the pilot's setting). */
export const THIRD_PERSON_FOV_MAX_DEG = 70;
const ORBIT_RAD_PER_PX = 0.005;
const ORBIT_ZOOM_PER_PX = 0.0015;
const VIB_REF_OMEGA = 3000;
const VIB_ROT_RAD = 0.004;
const VIB_POS_M = 0.002;
const AIM_HEIGHT = 0.05;

const MOUNT: Vec3 = [0, 0, 0];
const FORWARD: Vec3 = [0, 0, -1];

/** Yaw of the horizontal part of a body-frame -Z vector under `q` (0 faces -Z, positive counter-clockwise), or NaN when it points up or down. */
function headingOf(q: Quat, scratch: Vec3): number {
  quatRotate(q, FORWARD, scratch);
  return Math.hypot(scratch[0], scratch[2]) < 0.2 ? NaN : Math.atan2(-scratch[0], -scratch[2]);
}

function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/** FPV, chase and free-orbit cameras over a (render-interpolated) quad state. `camera` is rewritten by every `update`. */
export class CameraRig {
  mode: CameraMode = 'fpv';
  readonly camera: CameraState = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 100 * DEG, aspect: 16 / 9, near: CAMERA_NEAR, far: CAMERA_FAR };
  groundHeightAt: GroundHeightFn | undefined;

  private readonly tilt: Quat = [0, 0, 0, 1];
  private readonly jitter: Quat = [0, 0, 0, 1];
  private readonly vec: Vec3 = [0, 0, 0];
  private readonly lastPos: Vec3 = [0, 0, 0];
  private lastMode: CameraMode = 'fpv';
  private time = 0;
  private snapNext = true;
  private heading = 0;
  private headingVel = 0;
  private headingTarget = 0;
  private azimuth = 0;
  private elevation = 0.3;
  private distance = 3;

  constructor(groundHeightAt?: GroundHeightFn) {
    this.groundHeightAt = groundHeightAt;
  }

  /** The pilot's own quad model is hidden in the FPV view (the camera sits inside it). */
  get quadVisible(): boolean {
    return this.mode !== 'fpv';
  }

  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  /** The next update places the smoothed cameras right where they belong instead of gliding there. */
  snap(): void {
    this.snapNext = true;
  }

  /** Drag and wheel travel for the free camera: dragging right swings it left around the quad, the wheel zooms. */
  applyOrbit(d: OrbitDelta): void {
    this.azimuth -= d.dx * ORBIT_RAD_PER_PX;
    this.elevation = Math.min(Math.max(this.elevation + d.dy * ORBIT_RAD_PER_PX, -0.3), 1.45);
    this.distance = Math.min(Math.max(this.distance * Math.exp(d.wheel * ORBIT_ZOOM_PER_PX), MIN_ORBIT_M), MAX_ORBIT_M);
  }

  update(dt: number, quad: QuadState, settings: CameraSettings, aspect: number): CameraState {
    const step = dt > 0 ? Math.min(dt, MAX_STEP_S) : 0;
    this.time += step;
    const p = quad.pos;
    const jump = Math.hypot(p[0] - this.lastPos[0], p[1] - this.lastPos[1], p[2] - this.lastPos[2]) > TELEPORT_M;
    const modeChanged = this.mode !== this.lastMode;
    if (jump || modeChanged) this.snapNext = true;
    this.lastPos[0] = p[0];
    this.lastPos[1] = p[1];
    this.lastPos[2] = p[2];
    this.lastMode = this.mode;
    if (this.mode === 'fpv') this.updateFpv(quad, settings);
    else if (this.mode === 'chase') this.updateChase(step, quad);
    else this.updateFree(quad, modeChanged);
    const cam = this.camera;
    // The wide FPV lens makes a 25 cm quad a speck at chase distance and stretches the ground; the third-person cameras stay near a normal lens.
    const fovDeg = Math.min(Math.max(settings.fov, MIN_FOV_DEG), MAX_FOV_DEG);
    cam.fovY = (this.mode === 'fpv' ? fovDeg : Math.min(fovDeg, THIRD_PERSON_FOV_MAX_DEG)) * DEG;
    if (aspect > 0) cam.aspect = aspect;
    this.snapNext = false;
    return cam;
  }

  private updateFpv(quad: QuadState, settings: CameraSettings): void {
    const cam = this.camera;
    const m = MOUNT;
    m[0] = FPV_MOUNT[0];
    m[1] = FPV_MOUNT[1];
    m[2] = FPV_MOUNT[2];
    const omega = (quad.motorOmega[0] + quad.motorOmega[1] + quad.motorOmega[2] + quad.motorOmega[3]) / 4;
    const amp = settings.camVibration > 0 ? settings.camVibration * Math.min(Math.max(omega / VIB_REF_OMEGA, 0), 1.5) : 0;
    quatAxisX(settings.cameraTiltDeg * DEG, this.tilt);
    quatMul(quad.quat, this.tilt, cam.quat);
    if (amp > 0) {
      const ph = this.time * omega;
      const jx = Math.sin(ph) + 0.5 * Math.sin(ph * 2.13 + 1.7);
      const jy = Math.sin(ph * 0.83 + 2.1) + 0.5 * Math.sin(ph * 1.91 + 0.4);
      const jz = Math.sin(ph * 1.37 + 4.2);
      m[0] += jx * VIB_POS_M * amp;
      m[1] += jy * VIB_POS_M * amp;
      const r = VIB_ROT_RAD * amp * 0.5;
      const j = this.jitter;
      j[0] = jx * r;
      j[1] = jz * r;
      j[2] = jy * r;
      j[3] = 1;
      quatMul(cam.quat, j, cam.quat);
      const n = 1 / Math.hypot(cam.quat[0], cam.quat[1], cam.quat[2], cam.quat[3]);
      for (let i = 0; i < 4; i++) cam.quat[i] *= n;
    }
    quatRotate(quad.quat, m, this.vec);
    cam.pos[0] = quad.pos[0] + this.vec[0];
    cam.pos[1] = quad.pos[1] + this.vec[1];
    cam.pos[2] = quad.pos[2] + this.vec[2];
  }

  private updateChase(step: number, quad: QuadState): void {
    const target = this.chaseHeading(quad);
    if (this.snapNext) {
      this.heading = target;
      this.headingVel = 0;
    } else if (step > 0) {
      const e = Math.exp(-HEADING_OMEGA * step);
      const d = wrapAngle(this.heading - target);
      const t = (this.headingVel + HEADING_OMEGA * d) * step;
      this.heading = target + (d + t) * e;
      this.headingVel = (this.headingVel - HEADING_OMEGA * t) * e;
    }
    this.orbitTo(quad, this.heading, Math.atan2(CHASE_HEIGHT, CHASE_DISTANCE), Math.hypot(CHASE_DISTANCE, CHASE_HEIGHT));
  }

  private updateFree(quad: QuadState, modeChanged: boolean): void {
    if (modeChanged) {
      const h = headingOf(quad.quat, this.vec);
      if (h === h) this.azimuth = h;
    }
    this.orbitTo(quad, this.azimuth, this.elevation, this.distance);
  }

  /** Heading the chase camera wants to sit behind: the body's at low speed, the direction of travel when fast. */
  private chaseHeading(quad: QuadState): number {
    const v = quad.vel;
    const sh = Math.hypot(v[0], v[2]);
    const wv = Math.min(Math.max((sh - 2) / 4, 0), 1);
    const body = headingOf(quad.quat, this.vec);
    let tx = 0;
    let tz = 0;
    if (body === body) {
      tx = -Math.sin(body) * (1 - wv);
      tz = -Math.cos(body) * (1 - wv);
    }
    if (sh > 0.5) {
      tx += (v[0] / sh) * wv;
      tz += (v[2] / sh) * wv;
    }
    if (tx * tx + tz * tz > 1e-4) this.headingTarget = Math.atan2(-tx, -tz);
    return this.headingTarget;
  }

  /** Puts the camera `dist` from the quad at azimuth `az` (0 = south of it, looking north) and elevation `el`, looking at it. */
  private orbitTo(quad: QuadState, az: number, el: number, dist: number): void {
    const cam = this.camera;
    const ce = Math.cos(el);
    const x = quad.pos[0] + Math.sin(az) * ce * dist;
    let y = quad.pos[1] + Math.sin(el) * dist;
    const z = quad.pos[2] + Math.cos(az) * ce * dist;
    if (this.groundHeightAt !== undefined) y = Math.max(y, this.groundHeightAt(x, z) + CAMERA_MIN_AGL);
    cam.pos[0] = x;
    cam.pos[1] = y;
    cam.pos[2] = z;
    quatLookAlong(quad.pos[0] - x, quad.pos[1] + AIM_HEIGHT - y, quad.pos[2] - z, cam.quat);
  }
}
