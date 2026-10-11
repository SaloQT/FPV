import { describe, expect, it } from 'vitest';
import { EMISSIVE_MAX_NITS } from '../../render/contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { generatePark, gradeParkTerrain } from './generator';
import { emittingArea } from './parts';
import { defaultParkRecipe } from './recipe';
import type { ParkSize } from './types';

describe('park lights', () => {
  /** A light the renderer casts must come from a fitting you can see glowing, as bright as the light it throws. */
  it.each([[1337, 'destination'], [7, 'compact']] as [number, ParkSize][])('come from glowing fittings that match them (seed %i, %s)', (seed, size) => {
    const recipe = { ...defaultParkRecipe(seed, size), guests: 0 };
    const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
    expect(park.lights.length).toBeGreaterThan(0);
    const problems: string[] = [];
    park.lights.forEach((light, i) => {
      const emitters = (light.emitters ?? []).map(k => park.parts[k]);
      if (!emitters.length || emitters.some(p => !p)) { problems.push(`light ${i} at ${light.pos.map(v => v.toFixed(2))} has no glowing parts`); return; }
      const centre = [0, 1, 2].map(k => emitters.reduce((s, p) => s + p.pos[k], 0) / emitters.length);
      const off = Math.hypot(...centre.map((v, k) => v - light.pos[k]));
      if (off > 1e-9) problems.push(`light ${i} sits ${(off * 1000).toFixed(1)} mm from the centre of its glowing parts`);
      for (const p of emitters) if (p.color.some((c, k) => c !== light.color[k])) problems.push(`light ${i} colour ${light.color} differs from its glowing part ${p.color}`);
      // Emitted luminance is colour x emissive x EMISSIVE_MAX_NITS; through the lit area it gives the light's intensity.
      const candela = emitters.reduce((s, p) => s + p.emissive * EMISSIVE_MAX_NITS * emittingArea(p), 0);
      if (Math.abs(candela / light.candela - 1) > 1e-9) problems.push(`light ${i} is ${light.candela} cd but its fitting glows like ${candela.toFixed(1)} cd`);
    });
    expect(problems).toEqual([]);
  }, 120000);
});
