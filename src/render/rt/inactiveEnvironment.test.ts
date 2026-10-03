import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';

// Actual-Dawn f32 Env/counter regression: tools/test-ray-environment-gpu.mjs.
describe('RT inactive environment-light work', () => {
  const source = resolveShader('rt/rt_scene.wgsl', { GRP: 2 });
  const env = source.slice(source.indexOf('fn envAt('), source.indexOf('fn envRadiance('));

  it('retains RGB times enable before the active-only extinction multiplication', () => {
    expect(env).toContain('var sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w;');
    expect(env).toContain('if (frame.sunIrradiance.w != 0.0) { sunE *= sampleTransmittance(r, frame.sunDir.y); }');
    expect(env).toContain('var moonE = frame.moonIrradiance.rgb * moonUp;');
    expect(env).toContain('if (moonUp > 0.0) { moonE *= sampleTransmittance(r, frame.moonDir.y); }');
    expect(env).not.toContain('= vec3f(0.0)');
    expect(env.match(/sampleTransmittance\(/g)).toHaveLength(2);
  });

  it('retains the exact moon gate, height, zenith and ground operations', () => {
    expect(source).toContain('const HORIZON_EPS : f32 = -0.0145;');
    expect(env).toContain('let r = atmosRadiusAtHeight(y);');
    expect(env).toContain('let moonUp = select(0.0, 1.0, frame.moonDir.y > HORIZON_EPS);');
    expect(env).toContain('let zenith = skyNits(vec3f(0.0, 1.0, 0.0));');
    expect(env).toContain('let direct = sunE * max(frame.sunDir.y, 0.0) + moonE * max(frame.moonDir.y, 0.0);');
    expect(env).toContain('return Env(sunE, moonE, zenith, GROUND_ALBEDO * (direct * INV_PI + 0.6 * zenith));');
  });

  it('retains every Env field for key, fill, sky and probe consumers', () => {
    expect(source).toContain('struct Env { sunE : vec3f, moonE : vec3f, zenith : vec3f, ground : vec3f }');
    expect(source).toContain('return select(e.sunE, e.moonE, keyIsMoon());');
    expect(source).toContain('return select(e.moonE, e.sunE, keyIsMoon());');
    expect(source).toContain('return mix(skyNits(dir), e.ground, 1.0 - smoothstep(-0.08, 0.0, dir.y));');
    expect(source).toContain('let fallback = mix(e.ground, e.zenith, saturate1(n.y * 0.5 + 0.5)) * frame.params.y;');
  });
});
