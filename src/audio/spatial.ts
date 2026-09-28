/** Pure geometry of the ground-listener ("pilot") view: distance, Doppler, air absorption and the HRTF source direction. */
import { airAbsorptionCutoff, clamp, dopplerFactor, radialVelocity, smoothingAlpha, SPEED_OF_SOUND, TWO_PI } from './dsp';

/** Pilot ear height above the quad's start position when the pilot is placed automatically. */
export const EAR_HEIGHT = 1.6;
const MIN_DISTANCE = 0.4;
const YAW_TAU = 2;
/** Below this horizontal distance the bearing is too unstable to turn the listener towards. */
const YAW_MIN_RANGE = 3;
const DOPPLER_TAU = 0.03;

function wrapPi(a: number): number {
  return a - TWO_PI * Math.round(a / TWO_PI);
}

export class PilotSpace {
  px = 0;
  py = 0;
  pz = 0;
  captured = false;
  /** Listener yaw (same convention as the quad: 0 faces -Z, positive turns towards -X). */
  yaw = 0;

  distance = MIN_DISTANCE;
  /** Closing speed along the line of sight in m/s, smoothed; positive when approaching. */
  radialSpeed = 0;
  doppler = 1;
  cutoff = 20000;
  /** Quad position in listener coordinates (+X right, +Y up, -Z ahead), ready for a PannerNode. */
  relX = 0;
  relY = 0;
  relZ = -1;

  constructor(private readonly soundSpeed = SPEED_OF_SOUND) {}

  setPilot(x: number, y: number, z: number): void {
    this.px = x;
    this.py = y;
    this.pz = z;
    this.captured = true;
  }

  reset(): void {
    this.captured = false;
    this.yaw = 0;
    this.radialSpeed = 0;
    this.doppler = 1;
  }

  /** Allocation-free per-frame update from the quad's world position and velocity. */
  update(pos: ArrayLike<number>, vel: ArrayLike<number>, dt: number): void {
    if (!this.captured) this.setPilot(pos[0], pos[1] + EAR_HEIGHT, pos[2]);
    const dx = pos[0] - this.px, dy = pos[1] - this.py, dz = pos[2] - this.pz;
    const dist = Math.hypot(dx, dy, dz);
    this.distance = Math.max(dist, MIN_DISTANCE);

    const vr = radialVelocity(pos[0], pos[1], pos[2], vel[0], vel[1], vel[2], this.px, this.py, this.pz);
    const step = clamp(dt, 1e-4, 0.25);
    this.radialSpeed += (vr - this.radialSpeed) * smoothingAlpha(step, DOPPLER_TAU);
    this.doppler = dopplerFactor(this.radialSpeed, this.soundSpeed);
    this.cutoff = airAbsorptionCutoff(this.distance);

    const horizontal = Math.hypot(dx, dz);
    if (horizontal > YAW_MIN_RANGE) {
      const bearing = Math.atan2(-dx, -dz);
      this.yaw = wrapPi(this.yaw + wrapPi(bearing - this.yaw) * smoothingAlpha(step, YAW_TAU));
    }
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.relX = dx * c - dz * s;
    this.relY = dy;
    this.relZ = dx * s + dz * c;
  }
}
