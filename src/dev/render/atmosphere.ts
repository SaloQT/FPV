import type { FrameInfo, RenderContext, RenderModule } from '../../render/contracts';
import { SUN_TOA_LUX, moonIlluminanceLux } from '../../render/exposure';
import {
  AP_K, AP_MAX_M, AP_N, RB, SKY_H, SKY_W, T_H, T_W,
  buildTransmittance, groundBounce, marchSegment, newMarch, rayExtent, transmittanceToHalf, writeHalfRgba,
} from './atmosphereMath';

const SKY_STEPS = 32;
const CAM_BUCKET_KM = 0.02;
const NIGHT_BASE_NITS = 2e-4;
const NIGHT_TINT = [0.55, 0.75, 1.1];
// Camera-quaternion change (1 - |dot|) below which the aerial-perspective froxels are reused (about half a degree).
const AP_REBUILD_EPS = 1e-5;

/**
 * Dev-only CPU atmosphere that fills the transmittance, sky-view and aerial-perspective LUTs with the parameterisations documented in
 * shaders/common/atmosphere_sample.wgsl, so the render core can be seen at noon, dusk and night before the real atmosphere module exists.
 * The sky-view LUT is symmetric about the sun's vertical plane, so moonlight is a synthetic azimuth-independent glow.
 */
export function createDevAtmosphere(): RenderModule {
  const sky = new Uint16Array(SKY_W * SKY_H * 4);
  const ap = new Uint16Array(AP_N * AP_N * AP_N * 4);
  const march = newMarch();
  const origin = [0, 0, 0], dir = [0, 0, 0], sun = [0, 0, 0];
  const lastQuat = [0, 0, 0, 1];
  const lastAp = { camR: 0, sunY: 2, valid: false };
  let lut: Float32Array = new Float32Array(0);
  let skySunY = 2, skyCamBucket = -1, skyNight = -1;

  const rotate = (q: readonly number[], x: number, y: number, z: number): void => {
    const tx = 2 * (q[1] * z - q[2] * y), ty = 2 * (q[2] * x - q[0] * z), tz = 2 * (q[0] * y - q[1] * x);
    dir[0] = x + q[3] * tx + (q[1] * tz - q[2] * ty);
    dir[1] = y + q[3] * ty + (q[2] * tx - q[0] * tz);
    dir[2] = z + q[3] * tz + (q[0] * ty - q[1] * tx);
  };

  const buildSky = (rc: RenderContext, camR: number, sunY: number, nightNits: number): void => {
    const beta = Math.acos(Math.sqrt(camR * camR - RB * RB) / camR), zenithHorizon = Math.PI - beta;
    sun[0] = Math.sqrt(1 - sunY * sunY); sun[1] = sunY; sun[2] = 0;
    origin[0] = 0; origin[1] = camR; origin[2] = 0;
    for (let j = 0; j < SKY_H; j++) {
      const v = j / (SKY_H - 1);
      const cosZ = v < 0.5 ? Math.cos(zenithHorizon * (1 - (1 - 2 * v) ** 2)) : Math.cos(zenithHorizon + beta * (2 * v - 1) ** 2);
      const sinZ = Math.sqrt(Math.max(1 - cosZ * cosZ, 0)), ext = rayExtent(camR, cosZ);
      const glow = nightNits * (0.6 + 0.4 * (1 - Math.abs(cosZ)));
      for (let i = 0; i < SKY_W; i++) {
        const u = i / (SKY_W - 1), cosAz = 1 - 2 * u * u;
        dir[0] = sinZ * cosAz; dir[1] = cosZ; dir[2] = sinZ * Math.sqrt(Math.max(1 - cosAz * cosAz, 0));
        march.L.fill(0); march.T.fill(1);
        for (let s = 0; s < SKY_STEPS; s++) {
          const a = s / SKY_STEPS, b = (s + 1) / SKY_STEPS;
          marchSegment(march, lut, SUN_TOA_LUX, origin, dir, sun, ext.t * a * a, ext.t * b * b);
        }
        if (ext.ground) groundBounce(march, lut, SUN_TOA_LUX, origin, dir, sun, ext.t);
        writeHalfRgba(sky, j * SKY_W + i, march.L[0] + glow * NIGHT_TINT[0], march.L[1] + glow * NIGHT_TINT[1], march.L[2] + glow * NIGHT_TINT[2], 1);
      }
    }
    rc.device.queue.writeTexture({ texture: rc.world.tex.skyView }, sky, { bytesPerRow: SKY_W * 8 }, { width: SKY_W, height: SKY_H });
  };

  const buildAerial = (rc: RenderContext, f: FrameInfo, camR: number): void => {
    const q = f.camera.quat, tanY = Math.tan(f.camera.fovY * 0.5), sd = f.astro.sunDir;
    sun[0] = sd[0]; sun[1] = sd[1]; sun[2] = sd[2];
    origin[0] = 0; origin[1] = camR; origin[2] = 0;
    for (let y = 0; y < AP_N; y++) {
      const ndcY = 1 - (2 * (y + 0.5)) / AP_N;
      for (let x = 0; x < AP_N; x++) {
        const ndcX = (2 * (x + 0.5)) / AP_N - 1;
        const cx = ndcX * tanY * f.camera.aspect, cy = ndcY * tanY, inv = 1 / Math.hypot(cx, cy, 1);
        rotate(q, cx * inv, cy * inv, -inv);
        march.L.fill(0); march.T.fill(1);
        let tPrev = 0;
        for (let k = 0; k < AP_N; k++) {
          const w = (k + 0.5) / AP_N, t = (AP_MAX_M * (Math.exp(AP_K * w) - 1)) / (Math.exp(AP_K) - 1) / 1000;
          marchSegment(march, lut, SUN_TOA_LUX, origin, dir, sun, tPrev, t);
          tPrev = t;
          writeHalfRgba(ap, (k * AP_N + y) * AP_N + x, march.L[0], march.L[1], march.L[2], (march.T[0] + march.T[1] + march.T[2]) / 3);
        }
      }
    }
    rc.device.queue.writeTexture(
      { texture: rc.world.tex.aerialPerspective }, ap, { bytesPerRow: AP_N * 8, rowsPerImage: AP_N }, { width: AP_N, height: AP_N, depthOrArrayLayers: AP_N },
    );
    lastQuat[0] = q[0]; lastQuat[1] = q[1]; lastQuat[2] = q[2]; lastQuat[3] = q[3];
    lastAp.camR = camR; lastAp.sunY = sd[1]; lastAp.valid = true;
  };

  return {
    name: 'dev-atmosphere',
    init(rc) {
      lut = buildTransmittance();
      rc.device.queue.writeTexture({ texture: rc.world.tex.transmittance }, transmittanceToHalf(lut), { bytesPerRow: T_W * 8 }, { width: T_W, height: T_H });
    },
    update(rc, f) {
      const camR = RB + rc.settings.observer.altitudeM / 1000 + f.camera.pos[1] / 1000;
      const sunY = f.astro.sunDir[1], moonUp = Math.min(Math.max(f.astro.moonDir[1] * 2, 0), 1);
      const night = NIGHT_BASE_NITS + 0.01 * moonIlluminanceLux(f.astro.moonPhaseAngle) * moonUp;
      const bucket = Math.round((camR - RB) / CAM_BUCKET_KM);
      if (Math.abs(sunY - skySunY) > 1e-3 || bucket !== skyCamBucket || Math.abs(night - skyNight) > 1e-5) {
        buildSky(rc, camR, sunY, night);
        skySunY = sunY; skyCamBucket = bucket; skyNight = night;
      }
      const q = f.camera.quat, dot = q[0] * lastQuat[0] + q[1] * lastQuat[1] + q[2] * lastQuat[2] + q[3] * lastQuat[3];
      if (!lastAp.valid || 1 - Math.abs(dot) > AP_REBUILD_EPS || Math.abs(camR - lastAp.camR) > CAM_BUCKET_KM || Math.abs(f.astro.sunDir[1] - lastAp.sunY) > 1e-3) {
        buildAerial(rc, f, camR);
      }
    },
  };
}
