/**
 * Every piece of state QuadPhysics keeps between steps, as GPU fields (see quad.wgsl for which TypeScript member each mirrors).
 * Values the TypeScript model recomputes inside one step (forces, prop thrust, the contact list) are locals in the kernel.
 */
import { makeLayout, type Field } from './stateLayout';

const F = (name: string, type: Field['type'] = 'f32'): Field => ({ name, type });

export const QUAD_FIELDS: Field[] = [
  // Rigid body (QuadState)
  F('pos', 'vec3f'), F('vel', 'vec3f'), F('quat', 'vec4f'), F('angVel', 'vec3f'),
  // Step counter: QuadPhysics.tick, and the state's time as a whole number of steps (time = steps * DT)
  F('tick', 'u32'), F('steps', 'u32'),
  // Motors (Motor): signed omega, omegaDot, duty, phase current, pending command
  F('mOmega', 'vec4f'), F('mOmegaDot', 'vec4f'), F('mDuty', 'vec4f'), F('mCurrent', 'vec4f'), F('mPending', 'vec4f'),
  // Propeller wake-turbulence filter state (Propeller.wash)
  F('wash', 'vec4f'),
  // Battery
  F('batMah'), F('batCurrent'), F('batPolar'), F('batTemp'),
  // QuadPhysics scalars
  F('vBus'), F('groundH'), F('clearance'), F('rho'), F('baseAlt'), F('airTemp'),
  F('accelTrue', 'vec3f'), F('windVel', 'vec3f'),
  // Wind: config (from setWind) and Dryden filter / gust state
  F('wMx'), F('wMz'), F('wUx'), F('wUz'), F('wMean'), F('wTurb'), F('wGpm'), F('wGustFactor'), F('wCalm', 'u32'),
  F('wXu'), F('wXv1'), F('wXv2'), F('wXw1'), F('wXw2'), F('wNext'),
  F('gActive', 'vec4f'), F('gStart', 'vec4f'), F('gDur', 'vec4f'), F('gVx', 'vec4f'), F('gVy', 'vec4f'), F('gVz', 'vec4f'),
  // Seeded generators (Rng: state, cached spare gaussian, has-spare flag)
  F('rWind', 'u32'), F('rWindSpare'), F('rWindHas', 'u32'),
  F('rImu', 'u32'), F('rImuSpare'), F('rImuHas', 'u32'),
  F('rWash', 'u32'), F('rWashSpare'), F('rWashHas', 'u32'),
  // IMU (ImuSensor)
  F('imuGyro', 'vec3f'), F('imuAccel', 'vec3f'), F('imuBias', 'vec3f'), F('imuPhase', 'vec4f'), F('imuGain', 'vec4f'),
  F('imuGyroDir', 'f32x12'), F('imuAccelDir', 'f32x12'),
  // Flight controller flags and filters
  F('fcArmed', 'u32'), F('fcAirmode', 'u32'), F('fcPrevArm', 'u32'), F('fcBlocked', 'u32'),
  F('fcGyro', 'vec3f'), F('fcLpf1', 'vec3f'), F('fcLpf2', 'vec3f'),
  F('mahQ', 'vec4f'), F('mahUp', 'vec3f'),
  // RPM filter bank: per notch (motor * harmonics + h) the design (a0, b1, a2) and weight, per notch and axis the delay line
  F('rpmA0', 'f32x12'), F('rpmB1', 'f32x12'), F('rpmA2', 'f32x12'), F('rpmW', 'f32x12'),
  F('rpmZ1', 'f32x36'), F('rpmZ2', 'f32x36'), F('rpmCursor', 'u32'),
  // PID
  F('pidSum', 'vec3f'), F('pidI', 'vec3f'), F('pidD1', 'vec3f'), F('pidD2', 'vec3f'), F('pidFf', 'vec3f'), F('pidRelax', 'vec3f'),
  F('pidAg'), F('pidPrevGyro', 'vec3f'), F('pidPrimed', 'u32'),
  // Mixer
  F('mixOut', 'vec4f'), F('mixBoost'), F('mixPrimed', 'u32'),
  // Collision world and crash latch
  F('colPrev', 'u32'), F('colOnGround', 'u32'), F('colImpact'), F('motorLoad', 'vec4f'),
  F('crashed', 'u32'), F('impactSpeed'), F('crashTimer'),
];

export const QUAD_LAYOUT = makeLayout(QUAD_FIELDS);
