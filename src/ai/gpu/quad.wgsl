// The game's flight model on the GPU: a line-by-line transcription of src/sim (QuadPhysics.advance and everything it calls) for
// one drone per invocation, in f32. Each function names the TypeScript it mirrors; the order of operations, the cadences
// (density every 32 steps, ground every 16 or near the ground, wind every 8), the seeded noise streams and the contact solver
// are the same. Parameters come from quadConsts.ts (generated from the QuadConfig the game flies).
//
// Not transcribed, because training never reaches them: the turtle-mode mixer and angle/horizon self-levelling (the brain flies
// acro and never asks for turtle). Wind is skipped entirely in still air (wCalm): with zero mean, turbulence and gusts the
// TypeScript wind field is exactly zero, so the result is the same without drawing its noise.
//
// Needs: quadConsts, world.wgsl (groundHeight, groundNormal, gatherNearBoxes, boxes), the `Quad` layout bound to `q`.

const CRASH_HOLD : f32 = 1.0 / 60.0;
const WIND_DIVIDER : u32 = 8u;
const GROUND_EFFECT_REACH : f32 = 0.5;
const FAR_CLEARANCE : f32 = 2.0;
const WIND_RAMP_HEIGHT : f32 = 8.0;
const WIND_GROUND_FACTOR : f32 = 0.4;
const RAD2DEG : f32 = 57.29577951308232;
const INF : f32 = 3.0e38;

// ───────────── math3d ─────────────

fn quatRotate(qq : vec4f, v : vec3f) -> vec3f {
  let t = 2.0 * cross(qq.xyz, v);
  return v + qq.w * t + cross(qq.xyz, t);
}

fn quatRotateInv(qq : vec4f, v : vec3f) -> vec3f {
  return quatRotate(vec4f(-qq.xyz, qq.w), v);
}

// quatToMat3 rows (body -> world).
struct Mat3 { r0 : vec3f, r1 : vec3f, r2 : vec3f }

fn quatToMat3(qq : vec4f) -> Mat3 {
  let x = qq.x; let y = qq.y; let z = qq.z; let w = qq.w;
  let xx = x * x; let yy = y * y; let zz = z * z;
  let xy = x * y; let xz = x * z; let yz = y * z; let wx = w * x; let wy = w * y; let wz = w * z;
  return Mat3(
    vec3f(1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy)),
    vec3f(2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx)),
    vec3f(2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy)));
}

fn mulMat3(m : Mat3, v : vec3f) -> vec3f {
  return vec3f(dot(m.r0, v), dot(m.r1, v), dot(m.r2, v));
}

fn quatIntegrateBody(qq : vec4f, w : vec3f, dt : f32) -> vec4f {
  let wm = sqrt(dot(w, w));
  let ha = wm * dt * 0.5;
  var s : f32;
  var c : f32;
  if (ha < 1e-4) {
    let h2 = ha * ha;
    c = 1.0 - h2 * 0.5;
    s = dt * 0.5 * (1.0 - h2 / 6.0);
  } else {
    c = cos(ha);
    s = sin(ha) / wm;
  }
  let d = w * s;
  let r = vec4f(
    qq.w * d.x + qq.x * c + qq.y * d.z - qq.z * d.y,
    qq.w * d.y - qq.x * d.z + qq.y * c + qq.z * d.x,
    qq.w * d.z + qq.x * d.y - qq.y * d.x + qq.z * c,
    qq.w * c - qq.x * d.x - qq.y * d.y - qq.z * d.z);
  return r * (1.0 / sqrt(dot(r, r)));
}

// Rng (mulberry32 + Box-Muller with a cached spare). The uniform keeps 24 bits so it stays strictly below 1 in f32.
fn rngNext(st : ptr<private, u32>) -> f32 {
  *st = *st + 0x6d2b79f5u;
  var t = *st;
  t = (t ^ (t >> 15u)) * (t | 1u);
  t = t ^ (t + (t ^ (t >> 7u)) * (t | 61u));
  return f32((t ^ (t >> 14u)) >> 8u) * (1.0 / 16777216.0);
}

// Rng.gauss for each of the quad's streams (written out per stream: WGSL forbids two pointers into the same variable).
fn gaussImu() -> f32 {
  if (q.rImuHas != 0u) {
    q.rImuHas = 0u;
    return q.rImuSpare;
  }
  var u = rngNext(&q.rImu);
  if (u < 1e-12) { u = 1e-12; }
  let v = rngNext(&q.rImu);
  let r = sqrt(-2.0 * log(u));
  let a = TWO_PI * v;
  q.rImuSpare = r * sin(a);
  q.rImuHas = 1u;
  return r * cos(a);
}

fn gaussWind() -> f32 {
  if (q.rWindHas != 0u) {
    q.rWindHas = 0u;
    return q.rWindSpare;
  }
  var u = rngNext(&q.rWind);
  if (u < 1e-12) { u = 1e-12; }
  let v = rngNext(&q.rWind);
  let r = sqrt(-2.0 * log(u));
  let a = TWO_PI * v;
  q.rWindSpare = r * sin(a);
  q.rWindHas = 1u;
  return r * cos(a);
}

fn gaussWash() -> f32 {
  if (q.rWashHas != 0u) {
    q.rWashHas = 0u;
    return q.rWashSpare;
  }
  var u = rngNext(&q.rWash);
  if (u < 1e-12) { u = 1e-12; }
  let v = rngNext(&q.rWash);
  let r = sqrt(-2.0 * log(u));
  let a = TWO_PI * v;
  q.rWashSpare = r * sin(a);
  q.rWashHas = 1u;
  return r * cos(a);
}

// ───────────── propeller.ts ─────────────

fn airDensity(h : f32, tempC : f32) -> f32 {
  let k = max(1.0 - 2.2558e-5 * h, 0.05);
  let pressure = 101325.0 * pow(k, 5.2559);
  return pressure / (287.05 * (tempC + 273.15));
}

fn groundEffect(z : f32) -> f32 {
  let s = PROP_RADIUS / (4.0 * max(z, 0.45 * PROP_RADIUS));
  return min(1.0 / (1.0 - s * s), 1.4);
}

struct PropOut { thrust : f32, torque : f32, hDrag : f32, flapGain : f32 }

// Propeller.evaluate for prop i (updates its wake filter).
fn propEvaluate(i : u32, omega : f32, rho : f32, vAxial : f32, ground : f32) -> PropOut {
  let n = abs(omega) / TWO_PI;
  let n2 = n * n;
  if (n < 0.5) {
    q.wash[i] = 0.0;
    return PropOut(0.0, 0.0, 0.0, 0.0);
  }
  if (omega < 0.0) {
    return PropOut(-PROP_REV_THRUST * PROP_CT0 * rho * n2 * PROP_D4, -PROP_REV_TORQUE * PROP_CQ0 * rho * n2 * PROP_D5, 0.0, 0.0);
  }
  let j = vAxial / (n * PROP_D);
  let re = PROP_RE_LOSS * (1.0 - min(n / PROP_RE_REF, 1.0));
  let ctScale = clamp(1.0 - j / PROP_J0, -0.2, 1.4) * (1.0 - re);
  let cqScale = clamp(1.0 - j / PROP_JQ0, -0.1, 1.4) * (1.0 + PROP_RE_TORQUE * re);
  let tStatic = PROP_CT0 * ctScale * rho * n2 * PROP_D4;
  var loss = 0.0;
  var washAmp = 0.0;
  if (vAxial < 0.0) {
    let vh = sqrt(max(PROP_CT0 * rho * n2 * PROP_D4, 1e-6) / (2.0 * rho * PROP_AREA));
    let r = -vAxial / vh;
    if (r < 2.5) {
      let s = sin((3.141592653589793 * min(r, 2.0)) / 2.0);
      let win = select(0.0, s * s, r <= 2.0);
      loss = PROP_VORTEX_LOSS * win;
      let sw = sin((3.141592653589793 * r) / 2.5);
      washAmp = PROP_WASH_NOISE * sw * sw;
    }
  }
  // updateWash
  var goal = 0.0;
  if (washAmp > 0.0) { goal = gaussWash() * WASH_NORM * washAmp; }
  q.wash[i] = q.wash[i] + (goal - q.wash[i]) * WASH_ALPHA;
  let thrust = tStatic * ground * (1.0 - loss) * (1.0 + q.wash[i]);
  let torque = PROP_CQ0 * cqScale * rho * n2 * PROP_D5;
  let tipSpeed = omega * PROP_D * 0.5;
  let tPos = max(thrust, 0.0);
  return PropOut(thrust, torque, (PROP_H_FORCE * tPos) / tipSpeed, (PROP_FLAP * tPos * PROP_D) / tipSpeed);
}

// ───────────── motor.ts ─────────────

fn clampCurrent(i : f32, volts : f32) -> f32 {
  var up : f32;
  var lo : f32;
  if (volts >= 0.0) {
    up = MOTOR_MAX_CURRENT;
    lo = select(0.0, -MOTOR_BRAKE_CURRENT, MOTOR_ACTIVE_BRAKING);
  } else {
    lo = -MOTOR_MAX_CURRENT;
    up = select(0.0, MOTOR_BRAKE_CURRENT, MOTOR_ACTIVE_BRAKING);
  }
  return select(select(i, lo, i < lo), up, i > up);
}

fn busCurrentAt(i : u32, vBus : f32) -> f32 {
  let volts = q.mDuty[i] * vBus;
  return q.mDuty[i] * clampCurrent((volts - MOTOR_KT * q.mOmega[i]) * MOTOR_INV_R, volts);
}

fn busSlopeAt(i : u32, vBus : f32) -> f32 {
  let volts = q.mDuty[i] * vBus;
  let raw = (volts - MOTOR_KT * q.mOmega[i]) * MOTOR_INV_R;
  return select(0.0, (q.mDuty[i] * q.mDuty[i]) * MOTOR_INV_R, clampCurrent(raw, volts) == raw);
}

// Motor.advance
fn motorAdvance(i : u32, vBus : f32, loadTorque : f32, extraLoad : f32) {
  let w0 = q.mOmega[i];
  let volts = q.mDuty[i] * vBus;
  let sgn = select(select(w0 / 8.0, -1.0, w0 <= -8.0), 1.0, w0 >= 8.0);
  let coul = (MOTOR_COULOMB + extraLoad) * sgn;
  var w = (w0 + MOTOR_GAIN * ((MOTOR_KT * volts) * MOTOR_INV_R - loadTorque - coul)) / (1.0 + MOTOR_GAIN * (MOTOR_KR + MOTOR_VISCOUS));
  var cur = (volts - MOTOR_KT * w) * MOTOR_INV_R;
  let ic = clampCurrent(cur, volts);
  if (ic != cur) {
    cur = ic;
    w = w0 + MOTOR_GAIN * (MOTOR_KT * cur - loadTorque - coul - MOTOR_VISCOUS * w0);
  }
  q.mCurrent[i] = cur;
  q.mOmegaDot[i] = (w - w0) * INV_DT;
  q.mOmega[i] = w;
}

// ───────────── battery.ts ─────────────

const OCV_SOC = array<f32, 13>(0.0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0);
const OCV_V = array<f32, 13>(3.0, 3.38, 3.5, 3.62, 3.68, 3.72, 3.76, 3.8, 3.85, 3.92, 4.02, 4.1, 4.2);

fn cellOcv(soc : f32) -> f32 {
  let s = clamp(soc, 0.0, 1.0);
  var k = 1u;
  while (k < 12u && OCV_SOC[k] < s) { k++; }
  let t = (s - OCV_SOC[k - 1u]) / (OCV_SOC[k] - OCV_SOC[k - 1u]);
  return OCV_V[k - 1u] + t * (OCV_V[k] - OCV_V[k - 1u]);
}

fn batSoc() -> f32 { return clamp(1.0 - q.batMah / BAT_CAPACITY, 0.0, 1.0); }

fn batCellFactor() -> f32 {
  let lowSoc = 1.0 + 3.0 * max(0.0, 0.3 - batSoc());
  let cold = 1.0 + 0.03 * max(0.0, 25.0 - q.batTemp);
  return lowSoc * cold;
}

fn batEmf() -> f32 { return BAT_CELLS * cellOcv(batSoc()) - q.batPolar; }
fn batSeriesR() -> f32 { return BAT_WIRING_R + BAT_CELLS * BAT_CELL_R * batCellFactor() * 0.75; }
fn batVoltage() -> f32 { return batEmf() - batSeriesR() * q.batCurrent; }

fn batStep(dt : f32, current : f32) {
  q.batCurrent = current;
  q.batMah = max(0.0, q.batMah + (current * dt) / 3.6);
  let rPolar = BAT_CELLS * BAT_CELL_R * batCellFactor() * 0.25;
  q.batPolar = q.batPolar + ((current * rPolar - q.batPolar) * dt) / BAT_POLAR_TAU;
}

// ───────────── wind.ts ─────────────

fn windSchedule(t : f32) {
  let rate = q.wGpm / 60.0;
  q.wNext = select(INF, t - log(1.0 - rngNext(&q.rWind)) / rate, rate > 0.0);
}

fn windTrigger(t : f32, px : f32, py : f32, pz : f32, duration : f32) {
  var slot = 0u;
  for (var g = 0u; g < 4u; g++) {
    if (q.gActive[g] == 0.0) {
      slot = g;
      break;
    }
    if (q.gStart[g] < q.gStart[slot]) { slot = g; }
  }
  q.gActive[slot] = 1.0;
  q.gStart[slot] = t;
  q.gDur[slot] = max(duration, 0.1);
  q.gVx[slot] = px;
  q.gVy[slot] = py;
  q.gVz[slot] = pz;
}

// Wind.update
fn windUpdate(dt : f32, airspeed : f32, t : f32) {
  let speed = max(airspeed, 3.0);
  let tau = 25.0 / speed;
  let sigma = q.wTurb * (0.1 + 0.16 * q.wMean);
  let a = exp(-dt / tau);
  let drive = sqrt(1.0 - a * a);
  q.wXu = a * q.wXu + drive * sigma * gaussWind();
  q.wXv1 = a * q.wXv1 + drive * gaussWind();
  q.wXv2 = a * q.wXv2 + (1.0 - a) * q.wXv1;
  q.wXw1 = a * q.wXw1 + drive * gaussWind();
  q.wXw2 = a * q.wXw2 + (1.0 - a) * q.wXw1;
  if (t >= q.wNext) {
    let peak = q.wGustFactor * q.wMean + 1.0;
    let s = 0.5 + rngNext(&q.rWind);
    let vy = 0.2 * peak * (rngNext(&q.rWind) - 0.5);
    let dur = 1.5 + 2.5 * rngNext(&q.rWind);
    windTrigger(t, q.wUx * peak * s, vy, q.wUz * peak * s, dur);
    windSchedule(t);
  }
}

// Wind.sample
fn windSample(p : vec3f, t : f32) -> vec3f {
  let sigma = q.wTurb * (0.1 + 0.16 * q.wMean);
  let crossV = 1.4142135623730951 * sigma * q.wXv2;
  let vert = 0.6 * 1.4142135623730951 * sigma * q.wXw2;
  var x = q.wMx + q.wXu * q.wUx - crossV * q.wUz;
  var y = vert;
  var z = q.wMz + q.wXu * q.wUz + crossV * q.wUx;
  let frontSpeed = max(q.wMean, 1.0);
  let along = p.x * q.wUx + p.z * q.wUz;
  for (var g = 0u; g < 4u; g++) {
    if (q.gActive[g] == 0.0) { continue; }
    let phase = (t - q.gStart[g] - along / frontSpeed) / q.gDur[g];
    if (t - q.gStart[g] > 120.0 + q.gDur[g]) {
      q.gActive[g] = 0.0;
      continue;
    }
    if (phase <= 0.0 || phase >= 1.0) { continue; }
    let w = 0.5 * (1.0 - cos(TWO_PI * phase));
    x += q.gVx[g] * w;
    y += q.gVy[g] * w;
    z += q.gVz[g] * w;
  }
  return vec3f(x, y, z);
}

// QuadPhysics.updateWind
fn quadUpdateWind(dt : f32) {
  let t = f32(q.steps) * DT;
  let v = q.vel - q.windVel;
  windUpdate(dt, sqrt(dot(v, v)), t);
  let w = windSample(q.pos, t);
  let k = WIND_GROUND_FACTOR + (1.0 - WIND_GROUND_FACTOR) * min(max(q.clearance, 0.0) / WIND_RAMP_HEIGHT, 1.0);
  q.windVel = w * k;
}

// ───────────── imu.ts ─────────────

// ImuSensor.sample(dt, rate, specificForce, motorOmega) with the state's |motor omega|.
fn imuSample() {
  var g : vec3f;
  g.x = q.angVel.x + q.imuBias.x + GYRO_NOISE * gaussImu();
  g.y = q.angVel.y + q.imuBias.y + GYRO_NOISE * gaussImu();
  g.z = q.angVel.z + q.imuBias.z + GYRO_NOISE * gaussImu();
  var a : vec3f;
  a.x = q.accelTrue.x + ACCEL_NOISE * gaussImu();
  a.y = q.accelTrue.y + ACCEL_NOISE * gaussImu();
  a.z = q.accelTrue.z + ACCEL_NOISE * gaussImu();
  for (var m = 0u; m < 4u; m++) {
    let w = abs(q.mOmega[m]);
    var ph = q.imuPhase[m] + w * DT;
    if (ph > TWO_PI) { ph -= TWO_PI; }
    q.imuPhase[m] = ph;
    let k = q.imuGain[m] * w * w * INV_VIB_OMEGA2;
    let s = sin(ph) * k * GYRO_VIBRATION;
    let c = cos(ph) * k * ACCEL_VIBRATION;
    let o = m * 3u;
    g += s * vec3f(q.imuGyroDir[o], q.imuGyroDir[o + 1u], q.imuGyroDir[o + 2u]);
    a += c * vec3f(q.imuAccelDir[o], q.imuAccelDir[o + 1u], q.imuAccelDir[o + 2u]);
  }
  q.imuGyro += (g - q.imuGyro) * GYRO_ALPHA;
  q.imuAccel += (a - q.imuAccel) * ACCEL_ALPHA;
}

// ───────────── fc/angle.ts (Mahony) ─────────────

fn mahonyUpdate(dt : f32, gyro : vec3f, acc : vec3f) {
  let v = quatRotateInv(q.mahQ, vec3f(0.0, 1.0, 0.0));
  let mag = sqrt(dot(acc, acc));
  var c = vec3f(0.0);
  if (mag > 1e-3) {
    let trust = clamp(1.0 - abs(mag / G0 - 1.0) / MAHONY_WINDOW, 0.0, 1.0);
    let k = (MAHONY_KP * trust) / mag;
    c = k * vec3f(acc.y * v.z - acc.z * v.y, acc.z * v.x - acc.x * v.z, acc.x * v.y - acc.y * v.x);
  }
  q.mahQ = quatIntegrateBody(q.mahQ, gyro + c, dt);
  q.mahUp = quatRotateInv(q.mahQ, vec3f(0.0, 1.0, 0.0));
}

// ───────────── fc/filters.ts (RPM filter bank) ─────────────

fn rpmUpdate() {
  if (!RPM_ENABLED) { return; }
  for (var u = 0u; u < 3u; u++) {
    let idx = q.rpmCursor;
    q.rpmCursor = (q.rpmCursor + 1u) % RPM_COUNT;
    let motor = idx / RPM_HARMONICS;
    let harmonic = idx - motor * RPM_HARMONICS + 1u;
    let f = (abs(q.mOmega[motor]) / TWO_PI) * f32(harmonic);
    let fade = clamp((f - RPM_MIN_HZ) / (0.5 * RPM_MIN_HZ), 0.0, 1.0);
    let w = select(0.0, fade * RPM_WEIGHTS[harmonic - 1u], f < RPM_NYQUIST);
    let wasIdle = q.rpmW[idx] <= 0.0;
    q.rpmW[idx] = w;
    if (w > 0.0) {
      if (wasIdle) {
        for (var a = 0u; a < 3u; a++) {
          q.rpmZ1[idx * 3u + a] = 0.0;
          q.rpmZ2[idx * 3u + a] = 0.0;
        }
      }
      // Biquad.setNotch: b0 = b2 = a0, b1 = a1 = -2 cos * a0, a2 = (1 - alpha) a0
      let omega = TWO_PI * f * DT;
      let alpha = sin(omega) / (2.0 * RPM_Q);
      let a0 = 1.0 / (1.0 + alpha);
      q.rpmA0[idx] = a0;
      q.rpmB1[idx] = -2.0 * cos(omega) * a0;
      q.rpmA2[idx] = (1.0 - alpha) * a0;
    }
  }
}

fn rpmApply(axis : u32, x : f32) -> f32 {
  if (!RPM_ENABLED) { return x; }
  var y = x;
  for (var i = 0u; i < RPM_COUNT; i++) {
    let w = q.rpmW[i];
    if (w <= 0.0) { continue; }
    let k = i * 3u + axis;
    let a0 = q.rpmA0[i];
    let b1 = q.rpmB1[i];
    let n = a0 * y + q.rpmZ1[k];
    q.rpmZ1[k] = b1 * y - b1 * n + q.rpmZ2[k];
    q.rpmZ2[k] = a0 * y - q.rpmA2[i] * n;
    y += w * (n - y);
  }
  return y;
}

// FlightController.filterGyro
fn filterGyro() {
  rpmUpdate();
  let w = q.imuGyro;
  let x = vec3f(-w.z * RAD2DEG, -w.x * RAD2DEG, -w.y * RAD2DEG);
  for (var a = 0u; a < 3u; a++) {
    let y = rpmApply(a, x[a]);
    q.fcLpf1[a] += K_GYRO1 * (y - q.fcLpf1[a]);
    q.fcLpf2[a] += K_GYRO2 * (q.fcLpf1[a] - q.fcLpf2[a]);
  }
  q.fcGyro = q.fcLpf2;
}

// ───────────── fc/rates.ts ─────────────

fn rateCurve(rc : f32, sup : f32, expo : f32, stick : f32) -> f32 {
  let s = clamp(stick, -1.0, 1.0);
  let a = abs(s);
  var v : f32;
  if (RATE_TYPE == 0u) {
    let s2 = s * s;
    let curve = a * (s2 * s2 * s * expo + s * (1.0 - expo));
    v = s * rc + max(0.0, sup - rc) * curve;
  } else if (RATE_TYPE == 1u) {
    let c = select(s, s * a * a * a * expo + s * (1.0 - expo), expo > 0.0);
    let r = select(rc, rc + 14.54 * (rc - 2.0), rc > 2.0);
    v = 200.0 * r * c;
    if (sup > 0.0) { v /= min(max(1.0 - a * sup, 0.01), 1.0); }
  } else {
    let maxDps = max(sup, rc);
    let k = select(0.0, (maxDps / rc - 1.0) / (maxDps / rc), maxDps > 0.0 && rc > 0.0);
    let curve = a * a * a * expo + a * (1.0 - expo);
    v = s * rc / min(max(1.0 - curve * k, 0.01), 1.0);
  }
  return clamp(v, -SETPOINT_RATE_LIMIT, SETPOINT_RATE_LIMIT);
}

// ───────────── fc/pid.ts ─────────────

fn pidReset() {
  q.pidSum = vec3f(0.0);
  q.pidI = vec3f(0.0);
  q.pidPrevGyro = vec3f(0.0);
  q.pidPrimed = 0u;
  q.pidAg = 0.0;
}

fn pidUpdate(sp : vec3f, gyro : vec3f, throttle : f32, integrate : bool) {
  if (q.pidPrimed == 0u) {
    q.pidFf = sp;
    q.pidRelax = sp;
    q.pidD1 = gyro;
    q.pidD2 = gyro;
    q.pidPrevGyro = gyro;
    q.pidAg = throttle;
    q.pidPrimed = 1u;
  }
  q.pidAg += K_AG * (throttle - q.pidAg);
  let agHpf = throttle - q.pidAg;
  let agBoost = 1.0 + ANTI_GRAVITY_GAIN * abs(agHpf);
  let tpa = select(1.0, 1.0 - (TPA_RATE * (throttle - TPA_BREAKPOINT)) / (1.0 - TPA_BREAKPOINT), throttle > TPA_BREAKPOINT);
  for (var a = 0u; a < 3u; a++) {
    let s = sp[a];
    let err = s - gyro[a];
    q.pidRelax[a] += K_RELAX * (s - q.pidRelax[a]);
    let hpf = abs(s - q.pidRelax[a]);
    let relax = select(max(0.0, 1.0 - hpf / ITERM_RELAX_THRESHOLD), 1.0, a == 2u);
    q.pidD1[a] += K_DTERM1 * (gyro[a] - q.pidD1[a]);
    q.pidD2[a] += K_DTERM2 * (q.pidD1[a] - q.pidD2[a]);
    let gd = q.pidD2[a];
    let dRate = -(gd - q.pidPrevGyro[a]) * INV_DT;
    q.pidPrevGyro[a] = gd;
    let before = q.pidFf[a];
    q.pidFf[a] += K_FF * (s - q.pidFf[a]);
    let ffRate = (q.pidFf[a] - before) * INV_DT;
    let limit = select(PIDSUM_LIMIT, PIDSUM_LIMIT_YAW, a == 2u);
    let p = PID_P[a] * PTERM_SCALE * err * tpa;
    let d = PID_D[a] * DTERM_SCALE * dRate * tpa;
    let f = PID_F[a] * FEEDFORWARD_SCALE * ffRate;
    var i = q.pidI[a];
    if (integrate) {
      let next = i + PID_I[a] * ITERM_SCALE * DT * err * relax * agBoost;
      let room = limit - abs(p + d + f);
      let clampI = min(ITERM_LIMIT, max(room, 0.0));
      if (next > clampI) { i = max(i, clampI); } else if (next < -clampI) { i = min(i, -clampI); } else { i = next; }
    } else {
      i = 0.0;
    }
    q.pidI[a] = i;
    q.pidSum[a] = clamp(p + i + d + f, -limit, limit);
  }
}

// ───────────── fc/mixer.ts ─────────────

fn throttleCurve(t : f32) -> f32 {
  let x = clamp(t, 0.0, 1.0);
  let tmp = x - MIX_THROTTLE_MID;
  let y = select(MIX_THROTTLE_MID, 1.0 - MIX_THROTTLE_MID, tmp > 0.0);
  if (y <= 0.0) { return x; }
  return MIX_THROTTLE_MID + tmp * (1.0 - MIX_THROTTLE_EXPO + (MIX_THROTTLE_EXPO * tmp * tmp) / (y * y));
}

fn compensateThrustLin(t : f32) -> f32 {
  if (MIX_THRUST_LINEAR == 0.0) { return t; }
  let amount = MIX_THRUST_LINEAR - 0.5 * MIX_THRUST_LINEAR * MIX_THRUST_LINEAR;
  return t * (t * amount + 1.0 - amount);
}

fn applyThrustLin(o : f32) -> f32 {
  if (MIX_THRUST_LINEAR == 0.0 || o <= 0.0) { return o; }
  let r = 1.0 - o;
  return o * (1.0 + MIX_THRUST_LINEAR * r * r);
}

const MIX_ROLL = array<f32, 4>(-1.0, -1.0, 1.0, 1.0);
const MIX_PITCH = array<f32, 4>(-1.0, 1.0, 1.0, -1.0);
const MIX_YAW = array<f32, 4>(-1.0, 1.0, -1.0, 1.0);

fn mixerRun(throttle : f32, airmodeActive : bool) {
  var thr = throttleCurve(throttle);
  if (q.mixPrimed == 0u) {
    q.mixBoost = thr;
    q.mixPrimed = 1u;
  }
  if (MIX_THROTTLE_BOOST > 0.0) {
    q.mixBoost += K_BOOST * (thr - q.mixBoost);
    thr = clamp(thr + MIX_THROTTLE_BOOST * 0.1 * (thr - q.mixBoost), 0.0, 1.0);
  }
  thr = compensateThrustLin(thr);
  let r = q.pidSum.x * 0.001;
  let p = q.pidSum.y * 0.001;
  let y = q.pidSum.z * 0.001;
  var mx : vec4f;
  var mMin = INF;
  var mMax = -INF;
  for (var i = 0u; i < 4u; i++) {
    let m = r * MIX_ROLL[i] + p * MIX_PITCH[i] + y * MIX_YAW[i];
    mx[i] = m;
    mMin = min(mMin, m);
    mMax = max(mMax, m);
  }
  let range = mMax - mMin;
  var scale = 1.0;
  if (range > 1.0) {
    scale = 1.0 / range;
    thr = -mMin * scale;
  } else if (MIX_AIRMODE && airmodeActive) {
    thr = clamp(thr, -mMin, 1.0 - mMax);
  }
  let span = MIX_MOTOR_LIMIT - MIX_IDLE;
  for (var i = 0u; i < 4u; i++) {
    let u = clamp(thr + mx[i] * scale, 0.0, 1.0);
    q.mixOut[i] = MIX_IDLE + span * applyThrustLin(u);
  }
}

// ───────────── fc/controller.ts ─────────────

struct Sticks { roll : f32, pitch : f32, yaw : f32, throttle : f32, armed : bool }

fn updateArming(st : Sticks) {
  if (!st.armed) {
    q.fcArmed = 0u;
    q.fcBlocked = 0u;
    q.fcAirmode = 0u;
    q.fcPrevArm = 0u;
    return;
  }
  if (q.fcArmed == 0u && q.fcBlocked == 0u) {
    if (st.throttle <= ARM_THROTTLE_MAX) {
      q.fcArmed = 1u;
      q.fcAirmode = 0u;
      pidReset();
    } else if (q.fcPrevArm == 0u) {
      q.fcBlocked = 1u;
    }
  }
  q.fcPrevArm = 1u;
}

// FlightController.update in acro mode without turtle (what the brain flies).
fn fcUpdate(dt : f32, st : Sticks) {
  mahonyUpdate(dt, q.imuGyro, q.imuAccel);
  filterGyro();
  updateArming(st);
  if (q.fcArmed == 0u) {
    q.mixOut = vec4f(0.0);
    q.mixPrimed = 0u;
    return;
  }
  let throttle = clamp(st.throttle, 0.0, 1.0);
  if (q.fcAirmode == 0u && throttle > AIRMODE_START) { q.fcAirmode = 1u; }
  let sp = vec3f(
    rateCurve(RATE_ROLL_RC, RATE_ROLL_SUPER, RATE_ROLL_EXPO, st.roll),
    rateCurve(RATE_PITCH_RC, RATE_PITCH_SUPER, RATE_PITCH_EXPO, st.pitch),
    rateCurve(RATE_YAW_RC, RATE_YAW_SUPER, RATE_YAW_EXPO, st.yaw));
  pidUpdate(sp, q.fcGyro, throttle, q.fcAirmode != 0u);
  mixerRun(throttle, q.fcAirmode != 0u);
}

// ───────────── collision.ts ─────────────

const MAX_CONTACTS : u32 = 64u;
const ITERATIONS : u32 = 6u;
const SLOP : f32 = 0.0004;
const BOUNCE_MIN_SPEED : f32 = 0.8;
const TERRAIN_REACH : f32 = 0.5;
const PROP_STRIKE_COS : f32 = 0.7;
const REST_V2 : f32 = 0.0025;
const REST_W2 : f32 = 0.09;
const SUPPORT_MIN : f32 = 0.1;

var<private> cNB : array<vec3f, 64>;
var<private> cNW : array<vec3f, 64>;
var<private> cArm : array<vec3f, 64>;
var<private> cJt : array<vec3f, 64>;
var<private> cPen : array<f32, 64>;
var<private> cMu : array<f32, 64>;
var<private> cKn : array<f32, 64>;
var<private> cBounce : array<f32, 64>;
var<private> cJn : array<f32, 64>;
var<private> cSphere : array<u32, 64>;
var<private> nc : u32;

fn addContact(i : u32, n : vec3f, pen : f32, mu : f32, e : f32) {
  if (nc >= MAX_CONTACTS) { return; }
  let k = nc;
  nc++;
  let b = quatRotateInv(q.quat, n);
  cNW[k] = n;
  cNB[k] = b;
  cArm[k] = SPHERE_POS[i] - SPHERE_R[i] * b;
  cPen[k] = pen;
  cMu[k] = mu;
  cBounce[k] = e;
  cJn[k] = 0.0;
  cJt[k] = vec3f(0.0);
  cSphere[k] = i;
}

fn sphereBox(i : u32, b : u32, wp : vec3f, r : f32) {
  let bx = boxes[b];
  let c = bx.c;
  let s = bx.s;
  let dx = wp.x - bx.cx;
  let dy = wp.y - bx.cy;
  let dz = wp.z - bx.cz;
  let lx = c * dx - s * dz;
  let lz = s * dx + c * dz;
  if (abs(lx) > bx.hx + r || abs(dy) > bx.hy + r || abs(lz) > bx.hz + r) { return; }
  let qx = clamp(lx, -bx.hx, bx.hx);
  let qy = clamp(dy, -bx.hy, bx.hy);
  let qz = clamp(lz, -bx.hz, bx.hz);
  var n = vec3f(lx - qx, dy - qy, lz - qz);
  let d2 = dot(n, n);
  var pen : f32;
  if (d2 > 1e-12) {
    let d = sqrt(d2);
    if (d >= r) { return; }
    pen = r - d;
    n = n / d;
  } else {
    let px = bx.hx - abs(lx);
    let py = bx.hy - abs(dy);
    let pz = bx.hz - abs(lz);
    n = vec3f(0.0);
    if (px <= py && px <= pz) {
      n.x = select(1.0, -1.0, lx < 0.0);
      pen = r + px;
    } else if (py <= pz) {
      n.y = select(1.0, -1.0, dy < 0.0);
      pen = r + py;
    } else {
      n.z = select(1.0, -1.0, lz < 0.0);
      pen = r + pz;
    }
  }
  addContact(i, vec3f(c * n.x + s * n.z, n.y, -s * n.x + c * n.z), pen, OBSTACLE_FRICTION, OBSTACLE_RESTITUTION);
}

fn gather() {
  nc = 0u;
  let R = quatToMat3(q.quat);
  let p = q.pos;
  let nearTerrain = p.y - groundHeight(p.x, p.z) < TERRAIN_REACH;
  let nNear = gatherNearBoxes(p);
  if (!nearTerrain && nNear == 0u) { return; }
  for (var i = 0u; i < N_SPHERES; i++) {
    let r = SPHERE_R[i];
    let wp = p + mulMat3(R, SPHERE_POS[i]);
    if (nearTerrain) {
      let s = wp.y - groundHeight(wp.x, wp.z);
      if (s < 3.0 * r) {
        let nn = groundNormal(wp.x, wp.z);
        let pen = r - s * nn.y;
        if (pen > 0.0) { addContact(i, nn, pen, TERRAIN_FRICTION, TERRAIN_RESTITUTION); }
      }
    }
    for (var k = 0u; k < nNear && nc < MAX_CONTACTS; k++) { sphereBox(i, nearBox[k], wp, r); }
  }
}

// CollisionWorld.resolve
fn collisionResolve(dt : f32) {
  q.colImpact = 0.0;
  q.motorLoad = vec4f(0.0);
  gather();
  if (nc == 0u) {
    q.colOnGround = q.colPrev;
    q.colPrev = 0u;
    return;
  }
  q.colPrev = 1u;
  q.colOnGround = 1u;
  let vb0 = quatRotateInv(q.quat, q.vel);
  var vx = vb0.x; var vy = vb0.y; var vz = vb0.z;
  var wx = q.angVel.x; var wy = q.angVel.y; var wz = q.angVel.z;
  let ix = INV_I.x; let iy = INV_I.y; let iz = INV_I.z;
  for (var k = 0u; k < nc; k++) {
    let ar = cArm[k];
    let nb = cNB[k];
    let u = cross(ar, nb);
    cKn[k] = 1.0 / (INV_MASS + ix * u.x * u.x + iy * u.y * u.y + iz * u.z * u.z);
    let vcn = (vx + wy * ar.z - wz * ar.y) * nb.x + (vy + wz * ar.x - wx * ar.z) * nb.y + (vz + wx * ar.y - wy * ar.x) * nb.z;
    let approach = -vcn;
    if (approach > q.colImpact) { q.colImpact = approach; }
    cBounce[k] = select(0.0, cBounce[k] * approach, approach > BOUNCE_MIN_SPEED);
    let m = SPHERE_MOTOR[cSphere[k]];
    if (m >= 0 && nb.y < PROP_STRIKE_COS) { q.motorLoad[u32(m)] = PROP_STRIKE_TORQUE; }
  }
  for (var it = 0u; it < ITERATIONS; it++) {
    for (var k = 0u; k < nc; k++) {
      let ar = cArm[k];
      let nb = cNB[k];
      var cx = vx + wy * ar.z - wz * ar.y;
      var cy = vy + wz * ar.x - wx * ar.z;
      var cz = vz + wx * ar.y - wy * ar.x;
      let vn = cx * nb.x + cy * nb.y + cz * nb.z;
      var jn = (cBounce[k] - vn) * cKn[k];
      let acc = cJn[k];
      if (acc + jn < 0.0) { jn = -acc; }
      cJn[k] = acc + jn;
      let u = cross(ar, nb);
      vx += jn * nb.x * INV_MASS;
      vy += jn * nb.y * INV_MASS;
      vz += jn * nb.z * INV_MASS;
      wx += ix * u.x * jn;
      wy += iy * u.y * jn;
      wz += iz * u.z * jn;
      cx = vx + wy * ar.z - wz * ar.y;
      cy = vy + wz * ar.x - wx * ar.z;
      cz = vz + wx * ar.y - wy * ar.x;
      let vnn = cx * nb.x + cy * nb.y + cz * nb.z;
      let tx = cx - vnn * nb.x;
      let ty = cy - vnn * nb.y;
      let tz = cz - vnn * nb.z;
      let tm = sqrt(tx * tx + ty * ty + tz * tz);
      if (tm < 1e-9) { continue; }
      let d = vec3f(tx, ty, tz) / tm;
      let pp = cross(ar, d);
      let kt = 1.0 / (INV_MASS + ix * pp.x * pp.x + iy * pp.y * pp.y + iz * pp.z * pp.z);
      var j = -tm * kt * d;
      let o = cJt[k] + j;
      let om = sqrt(dot(o, o));
      let lim = cMu[k] * cJn[k];
      let sc = select(1.0, lim / om, om > lim);
      j = o * sc - cJt[k];
      cJt[k] = o * sc;
      vx += j.x * INV_MASS;
      vy += j.y * INV_MASS;
      vz += j.z * INV_MASS;
      wx += ix * (ar.y * j.z - ar.z * j.y);
      wy += iy * (ar.z * j.x - ar.x * j.z);
      wz += iz * (ar.x * j.y - ar.y * j.x);
    }
  }
  // projectOut
  var dp = vec3f(0.0);
  for (var k = 0u; k < nc; k++) {
    let eff = cPen[k] - dot(dp, cNW[k]) - SLOP;
    if (eff > 0.0) { dp += eff * cNW[k]; }
  }
  q.pos += dp;
  q.vel = quatRotate(q.quat, vec3f(vx, vy, vz));
  q.angVel = vec3f(wx, wy, wz);
  var support = 0.0;
  for (var k = 0u; k < nc; k++) { support += cJn[k]; }
  if (nc >= 3u && support > (SUPPORT_MIN * G0 * dt) / INV_MASS && vx * vx + vy * vy + vz * vz < REST_V2 && wx * wx + wy * wy + wz * wz < REST_W2) {
    q.vel *= REST_DAMP;
    q.angVel *= REST_DAMP;
  }
}

// ───────────── quad.ts ─────────────

fn refreshDensity() {
  q.rho = airDensity(q.baseAlt + q.pos.y, q.airTemp);
}

// QuadPhysics.solveBus
fn solveBus() -> f32 {
  let emf = batEmf();
  let rs = batSeriesR();
  var v = q.vBus;
  for (var it = 0u; it < 3u; it++) {
    var cur = AVIONICS_CURRENT;
    var slope = 0.0;
    for (var i = 0u; i < 4u; i++) {
      if (it == 0u) {
        // Motor.updateDuty
        q.mDuty[i] += (q.mPending[i] - q.mDuty[i]) * MOTOR_LAG_ALPHA;
        q.mPending[i] = q.mixOut[i];
      }
      cur += busCurrentAt(i, v);
      slope += busSlopeAt(i, v);
    }
    v -= (v - emf + rs * cur) / (1.0 + rs * slope);
  }
  if (v < 0.0) { v = 0.0; }
  q.vBus = v;
  return v;
}

var<private> torque : vec3f;
var<private> rotorMomentum : f32;

fn angAccel(w : vec3f) -> vec3f {
  let h = rotorMomentum;
  return vec3f(
    (torque.x + w.z * h - w.y * w.z * (INERTIA.z - INERTIA.y)) / INERTIA.x,
    (torque.y - w.z * w.x * (INERTIA.x - INERTIA.z)) / INERTIA.y,
    (torque.z - w.x * h - w.x * w.y * (INERTIA.y - INERTIA.x)) / INERTIA.z);
}

fn integrateAttitude(dt : f32) {
  let w = q.angVel;
  let h = dt * 0.5;
  let a1 = angAccel(w);
  let a2 = angAccel(w + h * a1);
  let n = w + dt * a2;
  q.quat = quatIntegrateBody(q.quat, 0.5 * (w + n), dt);
  q.angVel = n;
}

fn publish(dt : f32) {
  q.steps++;
  if (q.colImpact > CRASH_SPEED) {
    q.crashed = 1u;
    if (q.colImpact > q.impactSpeed) { q.impactSpeed = q.colImpact; }
    q.crashTimer = CRASH_HOLD;
  } else if (q.crashed != 0u) {
    q.crashTimer -= dt;
    if (q.crashTimer <= 0.0) {
      q.crashed = 0u;
      q.impactSpeed = 0.0;
    }
  }
}

// Wind.setMean + Wind.setTurbulence (QuadPhysics.setWind with every field given). Call before quadReset, as the game does.
fn quadSetWind(meanSpeed : f32, fromDirection : f32, turbulence : f32, gustsPerMinute : f32, gustFactor : f32) {
  let m = max(0.0, meanSpeed);
  q.wMean = m;
  q.wMx = -sin(fromDirection) * m;
  q.wMz = cos(fromDirection) * m;
  if (m > 0.05) {
    q.wUx = q.wMx / m;
    q.wUz = q.wMz / m;
  } else {
    q.wUx = 1.0;
    q.wUz = 0.0;
  }
  q.wTurb = max(0.0, turbulence);
  q.wGpm = max(0.0, gustsPerMinute);
  q.wGustFactor = gustFactor;
  // Still air: the TypeScript field is exactly zero everywhere, so its update can be skipped.
  q.wCalm = select(0u, 1u, m == 0.0 && q.wTurb == 0.0 && q.wGpm == 0.0);
}

// QuadPhysics.setAtmosphere
fn quadSetAtmosphere(altitudeM : f32, tempC : f32) {
  q.baseAlt = altitudeM;
  q.airTemp = tempC;
  q.batTemp = tempC + 10.0;
}

// QuadPhysics.reset(pos, yaw) for a quad built with `seed` (the constructor's seed: wash, IMU and wind streams derive from it).
fn quadReset(pos : vec3f, yaw : f32, seed : u32) {
  q.pos = pos;
  q.vel = vec3f(0.0);
  q.angVel = vec3f(0.0);
  q.quat = vec4f(0.0, sin(yaw * 0.5), 0.0, cos(yaw * 0.5));
  q.steps = 0u;
  q.crashed = 0u;
  q.impactSpeed = 0.0;
  q.rWash = seed ^ 0x2c1b3c6du;
  q.rWashHas = 0u;
  q.mOmega = vec4f(0.0);
  q.mOmegaDot = vec4f(0.0);
  q.mDuty = vec4f(0.0);
  q.mCurrent = vec4f(0.0);
  q.mPending = vec4f(0.0);
  q.wash = vec4f(0.0);
  // Battery.reset
  q.batMah = 0.0;
  q.batCurrent = 0.0;
  q.batPolar = 0.0;
  // Wind.reset
  q.rWind = seed ^ 0x51ed270bu;
  q.rWindHas = 0u;
  q.wXu = 0.0; q.wXv1 = 0.0; q.wXv2 = 0.0; q.wXw1 = 0.0; q.wXw2 = 0.0;
  q.gActive = vec4f(0.0);
  windSchedule(0.0);
  // ImuSensor.reset + prime(0, (0, G0, 0))
  q.rImu = seed ^ 0x1f3d5b79u;
  q.rImuHas = 0u;
  q.imuBias.x = gaussImu() * GYRO_BIAS;
  q.imuBias.y = gaussImu() * GYRO_BIAS;
  q.imuBias.z = gaussImu() * GYRO_BIAS;
  for (var m = 0u; m < 4u; m++) {
    q.imuPhase[m] = rngNext(&q.rImu) * TWO_PI;
    q.imuGain[m] = 0.7 + 0.6 * rngNext(&q.rImu);
    for (var a = 0u; a < 3u; a++) {
      q.imuGyroDir[m * 3u + a] = gaussImu();
      q.imuAccelDir[m * 3u + a] = gaussImu();
    }
  }
  q.imuGyro = q.imuBias;
  q.imuAccel = vec3f(0.0, G0, 0.0);
  // FlightController.reset(quat): the RPM filter keeps its cursor and notch designs, as in TypeScript
  q.fcArmed = 0u;
  q.fcAirmode = 0u;
  q.fcPrevArm = 0u;
  q.fcBlocked = 0u;
  pidReset();
  q.mixOut = vec4f(0.0);
  q.mixPrimed = 0u;
  for (var i = 0u; i < 12u; i++) { q.rpmW[i] = 0.0; }
  for (var i = 0u; i < 36u; i++) {
    q.rpmZ1[i] = 0.0;
    q.rpmZ2[i] = 0.0;
  }
  q.fcGyro = vec3f(0.0);
  q.fcLpf1 = vec3f(0.0);
  q.fcLpf2 = vec3f(0.0);
  q.mahQ = q.quat;
  q.mahUp = quatRotateInv(q.quat, vec3f(0.0, 1.0, 0.0));
  q.motorLoad = vec4f(0.0);
  q.accelTrue = vec3f(0.0, G0, 0.0);
  q.vBus = batEmf();
  q.tick = 0u;
  q.crashTimer = 0.0;
  q.groundH = groundHeight(pos.x, pos.z);
  q.clearance = pos.y - q.groundH;
  refreshDensity();
  q.windVel = vec3f(0.0);
}

// QuadPhysics.advance(dt, input)
fn advance(st : Sticks) {
  let dt = DT;
  if ((q.tick & 31u) == 0u) { refreshDensity(); }
  if (q.clearance < FAR_CLEARANCE || (q.tick & 15u) == 0u) { q.groundH = groundHeight(q.pos.x, q.pos.z); }
  q.clearance = q.pos.y - q.groundH;
  if (q.wCalm == 0u && q.tick % WIND_DIVIDER == 0u) { quadUpdateWind(dt * f32(WIND_DIVIDER)); }
  q.tick++;

  let vb = quatRotateInv(q.quat, q.vel - q.windVel);
  let R = quatToMat3(q.quat);
  imuSample();
  fcUpdate(dt, st);
  let v = solveBus();

  let rho = q.rho;
  var fx = 0.0; var fy = 0.0; var fz = 0.0;
  var tx = 0.0; var ty = 0.0; var tz = 0.0;
  var hy = 0.0;
  var cur = AVIONICS_CURRENT;
  let w = q.angVel;
  for (var i = 0u; i < 4u; i++) {
    let rp = MOTOR_POS[i];
    let vhx = vb.x + w.y * rp.z - w.z * rp.y;
    let vhy = vb.y + w.z * rp.x - w.x * rp.z;
    let vhz = vb.z + w.x * rp.y - w.y * rp.x;
    var ge = 1.0;
    if (R.r1.y > 0.2) {
      let z = q.pos.y + R.r1.x * rp.x + R.r1.y * rp.y + R.r1.z * rp.z - q.groundH;
      if (z < GROUND_EFFECT_REACH) { ge = groundEffect(z); }
    }
    let pr = propEvaluate(i, q.mOmega[i], rho, vhy, ge);
    motorAdvance(i, v, pr.torque, q.motorLoad[i]);
    let hx = -pr.hDrag * vhx;
    let hz = -pr.hDrag * vhz;
    let sp = MOTOR_SPIN[i];
    fx += hx;
    fy += pr.thrust;
    fz += hz;
    tx += rp.y * hz - rp.z * pr.thrust - pr.flapGain * vhz;
    ty += rp.z * hx - rp.x * hz - sp * (MOTOR_INERTIA * q.mOmegaDot[i] + pr.torque);
    tz += rp.x * pr.thrust - rp.y * hx + pr.flapGain * vhx;
    hy += MOTOR_INERTIA * sp * q.mOmega[i];
    cur += q.mDuty[i] * q.mCurrent[i];
  }
  // aero.ts bodyDrag / angularDrag
  let speed = sqrt(dot(vb, vb));
  let kd = 0.5 * rho * speed;
  let drag = -(kd * CDA + LINEAR_DRAG) * vb;
  let adrag = -(ANG_DAMP + ANG_DAMP_QUAD * abs(w)) * w;
  torque = vec3f(tx, ty, tz) + adrag;
  rotorMomentum = hy;

  let fw = quatRotate(q.quat, vec3f(fx, fy, fz) + drag);
  let v0 = q.vel;
  let k = dt * INV_MASS;
  q.vel = vec3f(q.vel.x + fw.x * k, q.vel.y + fw.y * k - G0 * dt, q.vel.z + fw.z * k);
  q.pos += q.vel * dt;
  integrateAttitude(dt);

  collisionResolve(dt);
  q.accelTrue = quatRotateInv(q.quat, (q.vel - v0) / dt + vec3f(0.0, G0, 0.0));
  batStep(dt, cur);
  publish(dt);
}
