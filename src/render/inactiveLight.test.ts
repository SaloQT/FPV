import { describe, expect, it } from 'vitest';
import { resolveShader } from './shaderLib';

// Actual-Dawn production output/counter regression: tools/test-inactive-light-gpu.mjs.
// These checks keep the optimization tied to the existing exact uniform enable gates.
describe('deferred inactive-light work', () => {
  const source = resolveShader('lighting/deferred.wgsl');

  it('uses the exact sun enable and the original strict moon horizon threshold', () => {
    expect(source).toContain('const HORIZON_EPS : f32 = -0.0145;');
    expect(source).toContain('let sunOn = frame.sunIrradiance.w != 0.0;');
    expect(source).toContain('let moonUp = select(0.0, 1.0, frame.moonDir.y > HORIZON_EPS);');
  });

  it('skips inactive extinction lookups and retains the active arithmetic', () => {
    expect(source).toContain('var sunE = vec3f(0.0);');
    expect(source).toContain('var moonE = vec3f(0.0);');
    expect(source).toContain('if (sunOn) { sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(r, frame.sunDir.y); }');
    expect(source).toContain('if (moonUp > 0.0) { moonE = frame.moonIrradiance.rgb * moonUp * sampleTransmittance(r, frame.moonDir.y); }');
  });

  it('skips inactive BRDFs while keeping both active expressions and sun-plus-moon order', () => {
    expect(source).toContain('var sunDirect = vec3f(0.0);');
    expect(source).toContain('var moonDirect = vec3f(0.0);');
    expect(source).toContain('if (sunOn) { sunDirect = directLight(frame.sunDir.xyz, n, v, diffuseColor, f0, rough, msc.g, sunE * sunVis, frame.sunDir.w); }');
    expect(source).toContain('if (moonUp > 0.0) { moonDirect = directLight(frame.moonDir.xyz, n, v, diffuseColor, f0, rough, msc.g, moonE * moonVis, frame.moonDir.w); }');
    expect(source).toContain('let direct = sunDirect + moonDirect;');
  });

  it('retains irradiance for ground bounce and the full ambient sample count', () => {
    expect(source).toContain('let ground = groundRadiance(sunE, moonE, zenithSky);');
    expect(source).toContain('const AMBIENT_SAMPLES : u32 = 16u;');
    expect(source).toContain('let direct = sunE * max(frame.sunDir.y, 0.0) + moonE * max(frame.moonDir.y, 0.0);');
    expect(source).toContain('irradianceOverPi = ambientFallback(n, px, ground) * pre;');
  });
});
