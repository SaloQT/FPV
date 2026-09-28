import { describe, expect, it } from 'vitest';
import { hasShader, resolveShader } from './shaderLib';

describe('resolveShader', () => {
  it('includes each file once and resolves the shared bindings', () => {
    const src = resolveShader('lighting/deferred.wgsl');
    expect(src).not.toMatch(/^\s*#(include|ifdef|ifndef|else|endif)/m);
    expect(src.match(/struct Frame \{/g)).toHaveLength(1);
    expect(src).toContain('fn sampleTransmittance');
    expect(src).toContain('fn directLight');
  });

  it('has no duplicate top-level function names once includes are merged', () => {
    for (const path of ['lighting/deferred.wgsl', 'common/world_bindings.wgsl']) {
      const names = [...resolveShader(path).matchAll(/^fn\s+(\w+)/gm)].map((m) => m[1]);
      expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    }
  });

  it('keeps FALLBACK_SKY code only when the define is set', () => {
    const blank = 'textureStore(hdrOut, px, vec4f(0.0, 0.0, 0.0, 1.0));';
    const off = resolveShader('lighting/deferred.wgsl'), on = resolveShader('lighting/deferred.wgsl', { FALLBACK_SKY: 1 });
    expect(off).toContain(blank);
    expect(off).not.toContain('sampleSkyView(viewRayDir(uv))');
    expect(on).not.toContain(blank);
    expect(on).toContain('sampleSkyView(viewRayDir(uv))');
  });

  it('reports a missing include with the chain that asked for it', () => {
    expect(hasShader('lighting/deferred.wgsl')).toBe(true);
    expect(hasShader('nope.wgsl')).toBe(false);
    expect(() => resolveShader('nope.wgsl')).toThrow(/not found/);
  });
});
