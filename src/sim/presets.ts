import type { Vec3 } from '../contracts';
import type { AeroParams } from './aero';
import type { BatteryParams } from './battery';
import type { CollisionParams, ProxySphere } from './collision';
import { DEFAULT_FC, type FcConfig } from './fc/controller';
import type { ImuParams } from './imu';
import { motorFriction, type MotorParams } from './motor';
import type { PropParams } from './propeller';

/** A component of the airframe for the inertia estimate: mass in kg at `pos` (frame coordinates), optionally a solid box. */
export interface PointMass {
  name: string;
  mass: number;
  pos: Vec3;
  /** Full box dimensions (x, y, z) for the component's own inertia; omitted for a point mass. */
  box?: Vec3;
}

export interface MassProperties {
  mass: number;
  /** Centre of mass in frame coordinates. */
  com: Vec3;
  /** Diagonal inertia about the centre of mass in body axes (Ixx pitch, Iyy yaw, Izz roll), kg m^2. */
  inertia: Vec3;
}

/** Total mass, centre of mass and principal inertia from a list of point masses / boxes (parallel-axis theorem). */
export function inertiaFromMasses(parts: readonly PointMass[]): MassProperties {
  let mass = 0, cx = 0, cy = 0, cz = 0;
  for (const p of parts) {
    mass += p.mass;
    cx += p.mass * p.pos[0];
    cy += p.mass * p.pos[1];
    cz += p.mass * p.pos[2];
  }
  cx /= mass;
  cy /= mass;
  cz /= mass;
  let ixx = 0, iyy = 0, izz = 0;
  for (const p of parts) {
    const dx = p.pos[0] - cx, dy = p.pos[1] - cy, dz = p.pos[2] - cz;
    ixx += p.mass * (dy * dy + dz * dz);
    iyy += p.mass * (dx * dx + dz * dz);
    izz += p.mass * (dx * dx + dy * dy);
    if (p.box) {
      const [a, b, c] = p.box;
      ixx += (p.mass * (b * b + c * c)) / 12;
      iyy += (p.mass * (a * a + c * c)) / 12;
      izz += (p.mass * (a * a + b * b)) / 12;
    }
  }
  return { mass, com: [cx, cy, cz], inertia: [ixx, iyy, izz] };
}

/** Everything the physics needs to know about one airframe + powertrain + flight-controller setup. */
export interface QuadConfig {
  name: string;
  /** Total mass, kg. */
  mass: number;
  /** Diagonal inertia about the centre of mass in body axes (x pitch axis, y yaw axis, z roll axis), kg m^2. */
  inertia: Vec3;
  /** Motor hub positions relative to the centre of mass, body axes (x right, y up, -z forward). Order 0 FR, 1 RR, 2 RL, 3 FL. */
  motorPos: readonly Vec3[];
  /** Spin direction of each motor seen from above: +1 counter-clockwise, -1 clockwise. */
  motorSpin: readonly number[];
  motor: MotorParams;
  prop: PropParams;
  battery: BatteryParams;
  aero: AeroParams;
  collision: CollisionParams;
  imu: ImuParams;
  fc: FcConfig;
  /** Constant draw of FC, camera, VTX and receiver from the flight battery, A. */
  avionicsCurrent: number;
  /** Seed of the sensor-noise and turbulence generators. */
  seed: number;
}

/** FR and RL clockwise, FL and RR counter-clockwise seen from above (Betaflight "props in"). */
export const QUAD_X_SPIN: readonly number[] = [-1, 1, -1, 1];

interface QuadSpec {
  name: string;
  /** Motor-to-motor diagonal, m. */
  wheelbase: number;
  motorMass: number;
  propMass: number;
  motorY: number;
  propY: number;
  /** Non-motor parts in frame coordinates (origin at the arm-plane centre). */
  parts: readonly PointMass[];
  /** Body proxy spheres other than the motor ones, frame coordinates. */
  bodySpheres: readonly ProxySphere[];
  /** Motor bell (ground contact when upright) and prop-top (contact when inverted) sphere radii and heights. */
  bellRadius: number;
  bellY: number;
  propSphereRadius: number;
  propSphereY: number;
  motor: MotorParams;
  prop: PropParams;
  battery: BatteryParams;
  aero: AeroParams;
  imu: ImuParams;
  fc: FcConfig;
  avionicsCurrent: number;
  crashSpeed: number;
}

function motorSlots(wheelbase: number): Vec3[] {
  const h = wheelbase / (2 * Math.SQRT2);
  return [
    [h, 0, -h],
    [h, 0, h],
    [-h, 0, h],
    [-h, 0, -h],
  ];
}

function buildQuad(s: QuadSpec): QuadConfig {
  const slots = motorSlots(s.wheelbase);
  const parts: PointMass[] = [...s.parts];
  slots.forEach((m, i) => {
    parts.push({ name: `motor${i}`, mass: s.motorMass, pos: [m[0], s.motorY, m[2]] });
    parts.push({ name: `prop${i}`, mass: s.propMass, pos: [m[0], s.propY, m[2]] });
  });
  const mp = inertiaFromMasses(parts);
  const [cx, cy, cz] = mp.com;
  const spheres: ProxySphere[] = [];
  slots.forEach((m, i) => {
    spheres.push({ x: m[0] - cx, y: s.bellY - cy, z: m[2] - cz, r: s.bellRadius, motor: -1 });
    spheres.push({ x: m[0] - cx, y: s.propSphereY - cy, z: m[2] - cz, r: s.propSphereRadius, motor: i });
  });
  for (const b of s.bodySpheres) spheres.push({ x: b.x - cx, y: b.y - cy, z: b.z - cz, r: b.r, motor: -1 });
  return {
    name: s.name,
    mass: mp.mass,
    inertia: mp.inertia,
    motorPos: slots.map((m): Vec3 => [m[0] - cx, s.motorY - cy, m[2] - cz]),
    motorSpin: QUAD_X_SPIN,
    motor: s.motor,
    prop: s.prop,
    battery: s.battery,
    aero: s.aero,
    collision: {
      spheres,
      terrainFriction: 0.6,
      terrainRestitution: 0.2,
      obstacleFriction: 0.5,
      obstacleRestitution: 0.25,
      crashSpeed: s.crashSpeed,
      propStrikeTorque: 0.02,
    },
    imu: s.imu,
    fc: s.fc,
    avionicsCurrent: s.avionicsCurrent,
    seed: 1,
  };
}

const FIVE_INCH_MOTOR: MotorParams = {
  kv: 1650,
  resistance: 0.1,
  inertia: 9e-6,
  maxCurrent: 60,
  ...motorFriction(1650, 1.0, 24),
  escLag: 0.003,
  activeBraking: true,
  brakeCurrent: 40,
};

const FIVE_INCH_PROP: PropParams = {
  diameter: 0.1295,
  ct0: 0.15,
  cq0: 0.0125,
  j0: 1.1,
  jq0: 1.5,
  reynoldsLoss: 0.4,
  reynoldsTorque: 0.25,
  reynoldsRef: 500,
  reverseThrust: 0.5,
  reverseTorque: 0.7,
  hForce: 0.1,
  flapMoment: 0.03,
  vortexLoss: 0.35,
  washNoise: 0.06,
};

export const BATTERY_6S_1300: BatteryParams = {
  cells: 6,
  capacityMah: 1300,
  cellResistance: 0.0026,
  wiringResistance: 0.002,
  polarisationTau: 1,
};

export const BATTERY_4S_1300: BatteryParams = { ...BATTERY_6S_1300, cells: 4 };

const FIVE_INCH_AERO: AeroParams = {
  cdaX: 0.014,
  cdaY: 0.022,
  cdaZ: 0.009,
  linearDrag: 0.003,
  angularDamping: [4e-4, 5e-4, 4e-4],
  angularDampingQuad: 3e-5,
};

const FIVE_INCH_IMU: ImuParams = {
  gyroNoise: 0.0026,
  gyroBias: 3e-4,
  gyroVibration: 0.3,
  gyroBandwidthHz: 800,
  accelNoise: 0.06,
  accelVibration: 3,
  accelBandwidthHz: 40,
  vibrationOmega: 3300,
};

/**
 * 5" freestyle quad, 6S 1300 mAh, 2207 1650 kV motors, 5.1" tri-blade props. 650 g all-up with the battery. Masses in
 * grams: motors 4x36, props 4x5, arms 4x15.5, bottom plate 45, top plate 25, battery 210, FC+ESC stack 48, camera 22,
 * VTX 20, receiver 25, hardware and wiring 29.
 */
export const QUAD_5IN_6S: QuadConfig = buildQuad({
  name: 'QUAD_5IN_6S',
  wheelbase: 0.22,
  motorMass: 0.036,
  propMass: 0.005,
  motorY: 0.006,
  propY: 0.022,
  parts: [
    { name: 'bottom plate', mass: 0.045, pos: [0, -0.004, 0], box: [0.1, 0.003, 0.055] },
    { name: 'top plate', mass: 0.025, pos: [0, 0.032, 0], box: [0.09, 0.003, 0.045] },
    { name: 'arm FR', mass: 0.0155, pos: [0.039, 0, -0.039] },
    { name: 'arm RR', mass: 0.0155, pos: [0.039, 0, 0.039] },
    { name: 'arm RL', mass: 0.0155, pos: [-0.039, 0, 0.039] },
    { name: 'arm FL', mass: 0.0155, pos: [-0.039, 0, -0.039] },
    { name: 'battery', mass: 0.21, pos: [0, 0.05, 0], box: [0.035, 0.032, 0.075] },
    { name: 'stack', mass: 0.048, pos: [0, 0.016, 0], box: [0.036, 0.02, 0.036] },
    { name: 'camera', mass: 0.022, pos: [0, 0.02, -0.062] },
    { name: 'vtx', mass: 0.02, pos: [0, 0.02, 0.05] },
    { name: 'receiver', mass: 0.025, pos: [0, 0.02, 0.03] },
    { name: 'hardware', mass: 0.029, pos: [0, 0.02, 0] },
  ],
  bodySpheres: [
    { x: 0, y: 0.005, z: 0, r: 0.028, motor: -1 },
    { x: 0, y: 0.05, z: -0.028, r: 0.022, motor: -1 },
    { x: 0, y: 0.05, z: 0.028, r: 0.022, motor: -1 },
    { x: 0, y: 0.02, z: -0.064, r: 0.02, motor: -1 },
    { x: 0, y: 0.02, z: 0.055, r: 0.018, motor: -1 },
  ],
  bellRadius: 0.03,
  bellY: 0.003,
  propSphereRadius: 0.03,
  propSphereY: 0.02,
  motor: FIVE_INCH_MOTOR,
  prop: FIVE_INCH_PROP,
  battery: BATTERY_6S_1300,
  aero: FIVE_INCH_AERO,
  imu: FIVE_INCH_IMU,
  fc: DEFAULT_FC,
  avionicsCurrent: 0.3,
  crashSpeed: 4,
});

export const PRESETS: Readonly<Record<string, QuadConfig>> = { QUAD_5IN_6S };

/** Look up a preset by name (case-insensitive); unknown names fall back to `QUAD_5IN_6S`. */
export function getPreset(name: string): QuadConfig {
  return PRESETS[name.toUpperCase()] ?? QUAD_5IN_6S;
}
