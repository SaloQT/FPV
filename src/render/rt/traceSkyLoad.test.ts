import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';

describe('trace invalid-depth fast path', () => {
  it('does not fetch normal/roughness/metalness for a pixel rejected as sky', () => {
    const src = resolveShader('rt/rt_trace_io.wgsl', { GRP: 2 });
    const loadPixel = src.slice(src.indexOf('fn loadPixel('), src.indexOf('fn inRt('));
    expect(loadPixel.indexOf('if (z <= 0.0)')).toBeLessThan(loadPixel.indexOf('textureLoad(auxNormal'));
    expect(loadPixel).toContain('return PixelInfo(false, 0.0, vec3f(0.0, 1.0, 0.0), 1.0, 0.0, vec3f(0.0))');
  });
});
