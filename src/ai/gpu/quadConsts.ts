/**
 * The quad's configuration as WGSL constants. The GPU flight model (quad.wgsl) reads every parameter from here, generated from
 * the same QuadConfig the game flies, so the transcription carries no numbers of its own. Coefficients that the TypeScript
 * model caches per step size (PT1 gains, lag factors) are computed here in float64 exactly as the TypeScript code computes them.
 */
import type { QuadConfig } from '../../sim/presets';
import { SETPOINT_RATE_LIMIT, type AxisRates, type RateProfile } from '../../sim/fc/rates';
import { DTERM_SCALE, FEEDFORWARD_SCALE, ITERM_SCALE, PTERM_SCALE } from '../../sim/fc/pid';
import { G0, TWO_PI } from '../../sim/math3d';
import { PAD_SIZE, PAD_THICKNESS } from '../../render/objects/trackMesh';

/** A WGSL f32 literal for `v` (finite; infinities become +-3.4e38). */
export function f32(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '3.4e38' : '-3.4e38';
  const s = String(Math.fround(v));
  return /[.e]/.test(s) ? s : `${s}.0`;
}

function pt1k(cutoffHz: number, dt: number): number {
  if (cutoffHz <= 0) return 1;
  const rc = 1 / (TWO_PI * cutoffHz);
  return dt / (rc + dt);
}

const RATE_TYPE = { actual: 0, betaflight: 1, quick: 2 } as const;

function axis(name: string, r: AxisRates): string[] {
  return [`const ${name}_RC : f32 = ${f32(r.rcRate)};`, `const ${name}_SUPER : f32 = ${f32(r.superRate)};`, `const ${name}_EXPO : f32 = ${f32(r.expo)};`];
}

export function quadConstsWgsl(c: QuadConfig, dt: number, rates: RateProfile = c.fc.rates): string {
  const m = c.motor, p = c.prop, b = c.battery, a = c.aero, col = c.collision, imu = c.imu, fc = c.fc;
  const pid = fc.pid, mix = fc.mixer, rpm = fc.rpmFilter;
  const kt = 60 / (TWO_PI * m.kv);
  const washAlpha = 1 - Math.exp(-TWO_PI * 25 * dt);
  const sph = col.spheres;
  const vec3 = (v: readonly number[]): string => `vec3f(${f32(v[0])}, ${f32(v[1])}, ${f32(v[2])})`;
  const weights = [0, 1, 2].map((h) => rpm.weights[h] ?? 1);
  const lines = [
    `const DT : f32 = ${f32(dt)};`,
    `const INV_DT : f32 = ${f32(1 / dt)};`,
    `const MASS : f32 = ${f32(c.mass)};`,
    `const INV_MASS : f32 = ${f32(1 / c.mass)};`,
    `const INERTIA : vec3f = ${vec3(c.inertia)};`,
    `const INV_I : vec3f = vec3f(${f32(1 / c.inertia[0])}, ${f32(1 / c.inertia[1])}, ${f32(1 / c.inertia[2])});`,
    `const MOTOR_POS = array<vec3f, 4>(${c.motorPos.map(vec3).join(', ')});`,
    `const MOTOR_SPIN = array<f32, 4>(${c.motorSpin.map(f32).join(', ')});`,
    `const AVIONICS_CURRENT : f32 = ${f32(c.avionicsCurrent)};`,
    // Motor + ESC
    `const MOTOR_KT : f32 = ${f32(kt)};`,
    `const MOTOR_R : f32 = ${f32(m.resistance)};`,
    `const MOTOR_INV_R : f32 = ${f32(1 / m.resistance)};`,
    `const MOTOR_INERTIA : f32 = ${f32(m.inertia)};`,
    `const MOTOR_GAIN : f32 = ${f32(dt / m.inertia)};`,
    `const MOTOR_KR : f32 = ${f32((kt * kt) / m.resistance)};`,
    `const MOTOR_MAX_CURRENT : f32 = ${f32(m.maxCurrent)};`,
    `const MOTOR_COULOMB : f32 = ${f32(m.frictionCoulomb)};`,
    `const MOTOR_VISCOUS : f32 = ${f32(m.frictionViscous)};`,
    `const MOTOR_LAG_ALPHA : f32 = ${f32(1 - Math.exp(-dt / m.escLag))};`,
    `const MOTOR_ACTIVE_BRAKING : bool = ${m.activeBraking};`,
    `const MOTOR_BRAKE_CURRENT : f32 = ${f32(m.brakeCurrent)};`,
    // Propeller
    `const PROP_D : f32 = ${f32(p.diameter)};`,
    `const PROP_D4 : f32 = ${f32(p.diameter ** 4)};`,
    `const PROP_D5 : f32 = ${f32(p.diameter ** 5)};`,
    `const PROP_RADIUS : f32 = ${f32(p.diameter * 0.5)};`,
    `const PROP_AREA : f32 = ${f32(Math.PI * p.diameter * p.diameter * 0.25)};`,
    `const PROP_CT0 : f32 = ${f32(p.ct0)};`,
    `const PROP_CQ0 : f32 = ${f32(p.cq0)};`,
    `const PROP_J0 : f32 = ${f32(p.j0)};`,
    `const PROP_JQ0 : f32 = ${f32(p.jq0)};`,
    `const PROP_RE_LOSS : f32 = ${f32(p.reynoldsLoss)};`,
    `const PROP_RE_TORQUE : f32 = ${f32(p.reynoldsTorque)};`,
    `const PROP_RE_REF : f32 = ${f32(p.reynoldsRef)};`,
    `const PROP_REV_THRUST : f32 = ${f32(p.reverseThrust)};`,
    `const PROP_REV_TORQUE : f32 = ${f32(p.reverseTorque)};`,
    `const PROP_H_FORCE : f32 = ${f32(p.hForce)};`,
    `const PROP_FLAP : f32 = ${f32(p.flapMoment)};`,
    `const PROP_VORTEX_LOSS : f32 = ${f32(p.vortexLoss)};`,
    `const PROP_WASH_NOISE : f32 = ${f32(p.washNoise)};`,
    `const WASH_ALPHA : f32 = ${f32(washAlpha)};`,
    `const WASH_NORM : f32 = ${f32(Math.sqrt((2 - washAlpha) / washAlpha))};`,
    // Battery
    `const BAT_CELLS : f32 = ${f32(b.cells)};`,
    `const BAT_CAPACITY : f32 = ${f32(b.capacityMah)};`,
    `const BAT_CELL_R : f32 = ${f32(b.cellResistance)};`,
    `const BAT_WIRING_R : f32 = ${f32(b.wiringResistance)};`,
    `const BAT_POLAR_TAU : f32 = ${f32(b.polarisationTau)};`,
    // Aero
    `const CDA : vec3f = vec3f(${f32(a.cdaX)}, ${f32(a.cdaY)}, ${f32(a.cdaZ)});`,
    `const LINEAR_DRAG : f32 = ${f32(a.linearDrag)};`,
    `const ANG_DAMP : vec3f = ${vec3(a.angularDamping)};`,
    `const ANG_DAMP_QUAD : f32 = ${f32(a.angularDampingQuad)};`,
    // Collision
    `const N_SPHERES : u32 = ${Math.min(sph.length, 16)}u;`,
    `const SPHERE_POS = array<vec3f, ${sph.length}>(${sph.map((s) => vec3([s.x, s.y, s.z])).join(', ')});`,
    `const SPHERE_R = array<f32, ${sph.length}>(${sph.map((s) => f32(s.r)).join(', ')});`,
    `const SPHERE_MOTOR = array<i32, ${sph.length}>(${sph.map((s) => `${s.motor}`).join(', ')});`,
    `const TERRAIN_FRICTION : f32 = ${f32(col.terrainFriction)};`,
    `const TERRAIN_RESTITUTION : f32 = ${f32(col.terrainRestitution)};`,
    `const OBSTACLE_FRICTION : f32 = ${f32(col.obstacleFriction)};`,
    `const OBSTACLE_RESTITUTION : f32 = ${f32(col.obstacleRestitution)};`,
    `const CRASH_SPEED : f32 = ${f32(col.crashSpeed)};`,
    `const PROP_STRIKE_TORQUE : f32 = ${f32(col.propStrikeTorque)};`,
    `const REST_DAMP : f32 = ${f32(Math.exp(-1000 * dt))};`,
    // IMU
    `const GYRO_NOISE : f32 = ${f32(imu.gyroNoise)};`,
    `const GYRO_BIAS : f32 = ${f32(imu.gyroBias)};`,
    `const GYRO_VIBRATION : f32 = ${f32(imu.gyroVibration)};`,
    `const ACCEL_NOISE : f32 = ${f32(imu.accelNoise)};`,
    `const ACCEL_VIBRATION : f32 = ${f32(imu.accelVibration)};`,
    `const INV_VIB_OMEGA2 : f32 = ${f32(1 / (imu.vibrationOmega * imu.vibrationOmega))};`,
    `const GYRO_ALPHA : f32 = ${f32(1 - Math.exp(-TWO_PI * imu.gyroBandwidthHz * dt))};`,
    `const ACCEL_ALPHA : f32 = ${f32(1 - Math.exp(-TWO_PI * imu.accelBandwidthHz * dt))};`,
    // Flight controller
    `const G0 : f32 = ${f32(G0)};`,
    `const TWO_PI : f32 = ${f32(TWO_PI)};`,
    `const PTERM_SCALE : f32 = ${f32(PTERM_SCALE)};`,
    `const ITERM_SCALE : f32 = ${f32(ITERM_SCALE)};`,
    `const DTERM_SCALE : f32 = ${f32(DTERM_SCALE)};`,
    `const FEEDFORWARD_SCALE : f32 = ${f32(FEEDFORWARD_SCALE)};`,
    `const SETPOINT_RATE_LIMIT : f32 = ${f32(SETPOINT_RATE_LIMIT)};`,
    `const RATE_TYPE : u32 = ${RATE_TYPE[rates.type]}u;`,
    ...axis('RATE_ROLL', rates.roll),
    ...axis('RATE_PITCH', rates.pitch),
    ...axis('RATE_YAW', rates.yaw),
    `const PID_P : vec3f = vec3f(${f32(pid.roll.p)}, ${f32(pid.pitch.p)}, ${f32(pid.yaw.p)});`,
    `const PID_I : vec3f = vec3f(${f32(pid.roll.i)}, ${f32(pid.pitch.i)}, ${f32(pid.yaw.i)});`,
    `const PID_D : vec3f = vec3f(${f32(pid.roll.d)}, ${f32(pid.pitch.d)}, ${f32(pid.yaw.d)});`,
    `const PID_F : vec3f = vec3f(${f32(pid.roll.f)}, ${f32(pid.pitch.f)}, ${f32(pid.yaw.f)});`,
    `const K_DTERM1 : f32 = ${f32(pt1k(pid.dtermLpf1Hz, dt))};`,
    `const K_DTERM2 : f32 = ${f32(pt1k(pid.dtermLpf2Hz, dt))};`,
    `const K_FF : f32 = ${f32(pt1k(pid.ffSmoothHz, dt))};`,
    `const K_RELAX : f32 = ${f32(pt1k(pid.itermRelaxCutoffHz, dt))};`,
    `const K_AG : f32 = ${f32(pt1k(pid.antiGravityHz, dt))};`,
    `const ITERM_LIMIT : f32 = ${f32(pid.itermLimit)};`,
    `const ITERM_RELAX_THRESHOLD : f32 = ${f32(pid.itermRelaxThreshold)};`,
    `const ANTI_GRAVITY_GAIN : f32 = ${f32(pid.antiGravityGain)};`,
    `const TPA_RATE : f32 = ${f32(pid.tpaRate)};`,
    `const TPA_BREAKPOINT : f32 = ${f32(pid.tpaBreakpoint)};`,
    `const PIDSUM_LIMIT : f32 = ${f32(pid.pidSumLimit)};`,
    `const PIDSUM_LIMIT_YAW : f32 = ${f32(pid.pidSumLimitYaw)};`,
    `const MIX_IDLE : f32 = ${f32(mix.idle)};`,
    `const MIX_AIRMODE : bool = ${mix.airmode};`,
    `const MIX_MOTOR_LIMIT : f32 = ${f32(mix.motorLimit)};`,
    `const MIX_THROTTLE_MID : f32 = ${f32(mix.throttleMid)};`,
    `const MIX_THROTTLE_EXPO : f32 = ${f32(mix.throttleExpo)};`,
    `const MIX_THROTTLE_BOOST : f32 = ${f32(mix.throttleBoost)};`,
    `const MIX_THRUST_LINEAR : f32 = ${f32(mix.thrustLinear)};`,
    `const K_BOOST : f32 = ${f32(pt1k(10, dt))};`,
    `const MAHONY_KP : f32 = ${f32(fc.imu.kp)};`,
    `const MAHONY_WINDOW : f32 = ${f32(fc.imu.accelWindow)};`,
    `const RPM_ENABLED : bool = ${rpm.enabled};`,
    `const RPM_HARMONICS : u32 = ${Math.min(rpm.harmonics, 3)}u;`,
    `const RPM_COUNT : u32 = ${4 * Math.min(rpm.harmonics, 3)}u;`,
    `const RPM_Q : f32 = ${f32(rpm.q)};`,
    `const RPM_MIN_HZ : f32 = ${f32(rpm.minHz)};`,
    `const RPM_WEIGHTS = array<f32, 3>(${weights.map(f32).join(', ')});`,
    `const RPM_NYQUIST : f32 = ${f32(0.45 / dt)};`,
    `const K_GYRO1 : f32 = ${f32(pt1k(fc.gyroLpf1Hz, dt))};`,
    `const K_GYRO2 : f32 = ${f32(pt1k(fc.gyroLpf2Hz, dt))};`,
    `const ARM_THROTTLE_MAX : f32 = ${f32(fc.armThrottleMax)};`,
    `const AIRMODE_START : f32 = ${f32(fc.airmodeStartThrottle)};`,
  ];
  return lines.join('\n');
}

/** Side of the training worlds' obstacle grid cells (m); world.wgsl looks up boxes near the quad through it. */
export const GRID_CELL = 8;
/** CollisionWorld's PROXY_REACH: a box is near when the quad centre is within its bounding radius plus this. */
export const PROXY_REACH = 0.2;

/** Constants world.wgsl needs: the start pad (PadGround) and the obstacle grid. */
export function worldConstsWgsl(): string {
  return [
    `const PAD_HALF : f32 = ${f32(PAD_SIZE / 2)};`,
    `const PAD_THICKNESS : f32 = ${f32(PAD_THICKNESS)};`,
    `const GRID_CELL : f32 = ${f32(GRID_CELL)};`,
    `const PROXY_REACH : f32 = ${f32(PROXY_REACH)};`,
  ].join('\n');
}
