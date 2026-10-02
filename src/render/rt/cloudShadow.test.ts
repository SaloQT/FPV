import { describe, expect, it } from 'vitest';
import { DEFAULT_ATMOSPHERE_SETTINGS, sanitizeAtmosphereSettings } from '../atmosphere/settings';
import { CLOUD_SHADOW_EXTENT_M, CLOUD_SHADOW_SIZE, cloudField, cloudVisibility } from '../atmosphere/cloudModel';
import { resolveShader } from '../shaderLib';

const MIN_SUN_Y = 0.05;
type V3 = [number, number, number];

/** The lookup of rt_scene.wgsl cloudTransmittance(): the ground column (at the datum) that a point's light ray crosses, as a map uv. */
function shaderUv(p: V3, key: V3, centre: [number, number], extent: number): [number, number] {
  const k = p[1] / Math.max(key[1], MIN_SUN_Y);
  return [(p[0] - key[0] * k - centre[0]) / extent + 0.5, (p[2] - key[2] * k - centre[1]) / extent + 0.5];
}

const sun = (elDeg: number, azDeg: number): V3 => {
  const e = (elDeg * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
};

describe('rt cloud shadow lookup', () => {
  const src = resolveShader('rt/rt_scene.wgsl', { GRP: 2 });

  it('is the formula the TypeScript mirror below uses', () => {
    expect(src).toContain('let xz = p.xz - key.xz * (p.y / max(key.y, MIN_CLOUD_SUN_Y));');
    expect(src).toContain('let uv = (xz - rp.cloud.xy) / rp.cloud.z + 0.5;');
    expect(src).toContain(`const MIN_CLOUD_SUN_Y : f32 = ${MIN_SUN_Y};`);
  });

  it('reads the map at the column the light ray crosses: x east, z south, texel (i, j) = (u, v) of the atmosphere module', () => {
    const centre: [number, number] = [-62.5, 125];
    // The map's own convention: texel (i + 0.5) / N - 0.5 times the extent from the centre, in x and z.
    const uv = shaderUv([centre[0] + 1000, 0, centre[1] - 500], sun(40, 120), centre, CLOUD_SHADOW_EXTENT_M);
    expect(uv[0]).toBeCloseTo(0.5 + 1000 / CLOUD_SHADOW_EXTENT_M, 9);
    expect(uv[1]).toBeCloseTo(0.5 - 500 / CLOUD_SHADOW_EXTENT_M, 9);
    expect(CLOUD_SHADOW_SIZE * uv[0] - 0.5).toBeGreaterThan(0);
  });

  it('shifts away from the sun for a point above the datum (the shadow of a hill lands down-sun of the cloud above it)', () => {
    const k = sun(20, 90); // sun in the east: x grows toward it
    const [u0] = shaderUv([0, 0, 0], k, [0, 0], CLOUD_SHADOW_EXTENT_M);
    const [u1] = shaderUv([0, 200, 0], k, [0, 0], CLOUD_SHADOW_EXTENT_M);
    expect(u1).toBeLessThan(u0);
    expect((u0 - u1) * CLOUD_SHADOW_EXTENT_M).toBeCloseTo(200 * (k[0] / k[1]), 6);
  });

  it('gives a point on a hill the transmittance of its own light ray (CPU cloud model, same density as the sky pass)', () => {
    const settings = sanitizeAtmosphereSettings({ ...DEFAULT_ATMOSPHERE_SETTINGS, cloudCoverage: 0.5 });
    const field = cloudField(settings, 1337, 300, 300);
    let compared = 0, shadowed = 0, lit = 0;
    for (let i = 0; i < 40; i++) {
      const p: V3 = [(i * 977) % 3000 - 1500, 20 + (i * 53) % 200, (i * 631) % 3000 - 1500];
      const k = sun(25 + (i % 5) * 10, 60 + i * 7);
      const own = cloudVisibility(field, p[0], p[1], p[2], k[0], k[1], k[2]);
      const [u, v] = shaderUv(p, k, [0, 0], CLOUD_SHADOW_EXTENT_M);
      const col = cloudVisibility(field, (u - 0.5) * CLOUD_SHADOW_EXTENT_M, 0, (v - 0.5) * CLOUD_SHADOW_EXTENT_M, k[0], k[1], k[2]);
      expect(Math.abs(own - col), `point ${i}`).toBeLessThan(0.05);
      compared++;
      if (col < 0.2) shadowed++; else if (col > 0.8) lit++;
    }
    expect(compared).toBe(40);
    // Guard against a vacuous pass: the sampled points must include both shadowed and lit columns.
    expect(shadowed).toBeGreaterThan(2);
    expect(lit).toBeGreaterThan(2);
  });
});
