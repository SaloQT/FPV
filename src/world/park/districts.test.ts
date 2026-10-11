import { expect, it } from 'vitest';
import { planParkDistricts } from './districts';
import { defaultParkRecipe } from './recipe';
import type { ParkData, ParkLayout } from './types';

function scene(layout: ParkLayout): ParkData {
  return { recipe: { ...defaultParkRecipe(1337), layout }, layout, bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0,
    launch: { pos: [0, 12, 0], yaw: 0 }, rides: [], parts: [], bodies: [], rooms: [], lights: [], routes: [], paths: [], nodes: [] };
}

it('gives the advertised layout choices distinct, connected public circulation plans', () => {
  const plans = ['hub', 'loop', 'valley', 'boardwalk'].map(layout => {
    const park = scene(layout as ParkLayout); planParkDistricts(park);
    const seen = new Set([park.entrance]), pending = [park.entrance];
    while (pending.length) for (const id of park.nodes[pending.pop()!].links) if (!seen.has(id)) { seen.add(id); pending.push(id); }
    expect(seen.size, layout).toBe(park.nodes.length);
    return JSON.stringify({ positions: park.nodes.map(n => n.pos), paths: park.paths });
  });
  expect(new Set(plans).size).toBe(4);
});
