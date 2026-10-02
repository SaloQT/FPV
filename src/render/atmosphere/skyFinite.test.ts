import { describe, expect, it } from 'vitest';
import { SUN_TOA_LUX } from '../exposure';
import { PLANET_RADIUS_KM, ATMOSPHERE_TOP_KM, mediumAt, miePhase, opticalDepthToTop, rayleighPhase } from './physics';

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: 'node:fs'): { readFileSync(path: URL): Uint8Array } } })
  .process.getBuiltinModule('node:fs');
const shader = (file: string): string => new TextDecoder().decode(nodeFs.readFileSync(new URL(`../shaders/sky/${file}`, import.meta.url)));

const constant = (src: string, name: string): number => {
  const m = src.match(new RegExp(`const ${name}\\s*:\\s*f32\\s*=\\s*([-0-9.eE+]+);`));
  if (!m) throw new Error(`const ${name} not found`);
  return Number(m[1]);
};

const FP16_MAX = 65504;
const uniforms = shader('atmos_uniforms.wgsl');
const STORE_MAX = constant(uniforms, 'FP16_STORE_MAX');
const SUN_SCALE = constant(uniforms, 'SKY_SUN_STORE_SCALE');

/**
 * Radiance toward the sun itself (single scattering, the sun disc excluded): looking along the sun ray a forward-scattered photon never
 * leaves the line, so every scatter point is attenuated by the same total optical depth and L = E * T_total * integral(sigma_s * phase(0) dl).
 */
function aureoleAtSun(sunElevationDeg: number, cameraAltitudeKm = 0.3): number[] {
  const mu = Math.sin((sunElevationDeg * Math.PI) / 180);
  const r = PLANET_RADIUS_KM + cameraAltitudeKm;
  const tau = opticalDepthToTop(r, mu, 256);
  const tMax = -r * mu + Math.sqrt(r * r * (mu * mu - 1) + ATMOSPHERE_TOP_KM * ATMOSPHERE_TOP_KM);
  const steps = 2000;
  const ds = tMax / steps;
  const column = [0, 0, 0];
  const medium = mediumAt(0);
  const sinT = Math.sqrt(1 - mu * mu);
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    mediumAt(Math.hypot(sinT * t, r + mu * t) - PLANET_RADIUS_KM, medium);
    for (let c = 0; c < 3; c++) column[c] += (medium.scatterRayleigh[c] * rayleighPhase(1) + medium.scatterMie * miePhase(1)) * ds;
  }
  return column.map((v, c) => SUN_TOA_LUX * Math.exp(-tau[c]) * v);
}

describe('sky LUT storage range', () => {
  it('the aureole at the sun overflows fp16 at most elevations, so an unscaled store would be Inf', () => {
    for (const el of [5, 12, 22, 45, 66]) expect(Math.max(...aureoleAtSun(el)), `sun at ${el} deg`).toBeGreaterThan(FP16_MAX);
  });

  it('the sun-pass LUT scale keeps the aureole peak finite and unclamped at every sun elevation', () => {
    for (let el = 1; el <= 90; el += 1) {
      const peak = Math.max(...aureoleAtSun(el));
      expect(peak / SUN_SCALE, `sun at ${el} deg`).toBeLessThan(STORE_MAX);
    }
  });

  it('the scale switches off below the horizon before the sky gets dark enough for fp16 denormals', () => {
    const minMu = constant(uniforms, 'SKY_SUN_SCALE_MIN_MU');
    expect(minMu).toBeLessThan(0);
    expect(minMu).toBeGreaterThan(-0.2);
    expect(uniforms).toContain('select(1.0, SKY_SUN_STORE_SCALE, frame.sunDir.y > SKY_SUN_SCALE_MIN_MU)');
  });

  it('the store clamp is below the fp16 maximum and a clamped near-sun value is still far below the sun disc', () => {
    expect(STORE_MAX).toBeLessThan(FP16_MAX);
    expect(STORE_MAX).toBeGreaterThan(60000);
    expect(SUN_TOA_LUX / (Math.PI * (0.00465 ** 2))).toBeGreaterThan(1e4 * STORE_MAX);
  });
});

describe('sky shaders never store a value fp16 turns into Inf', () => {
  const lines = (file: string): string[] => shader(file).split('\n').filter((l) => !l.trimStart().startsWith('//'));

  it('the sky-view pass clamps the world LUT and scales and clamps the sun-pass LUT', () => {
    const src = lines('skyview.wgsl').join('\n');
    expect(src).toContain('vec4f(min(world, vec3f(FP16_STORE_MAX)), 1.0)');
    expect(src).toContain('vec4f(min(sky / skySunStoreScale(), vec3f(FP16_STORE_MAX)), 1.0)');
  });

  it('the sky pass multiplies the scaled sun-pass LUT back before it adds the other sources', () => {
    expect(lines('sky.wgsl').join('\n')).toMatch(/skySunTex, linearClamp, skyViewUv\(dir, r\), 0\.0\)\.rgb \* skySunStoreScale\(\)/);
  });

  it('the cloud march and the aerial froxels clamp their stores', () => {
    expect(lines('cloud_march.wgsl').join('\n')).toContain('min((c.rgb + c.a * i.rgb) / CLOUD_STORE_SCALE, vec3f(FP16_STORE_MAX))');
    expect(lines('aerial.wgsl').join('\n')).toContain('vec4f(min(lum, vec3f(FP16_STORE_MAX)),');
  });

  it('the cloud haze never multiplies a sky-view tap by a zero weight', () => {
    const src = lines('cloud_march.wgsl').join('\n');
    expect(src).toContain('if (far > 0.0) { haze = mix(near.rgb, sampleSkyView(dir), far); }');
    expect(src).not.toMatch(/let haze = mix\(/);
  });
});
