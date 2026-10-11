import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { Rng } from '../track/rng';
import { shopAwning, shopfront, pitchedRoof } from './architecture';
import { auditPark } from './constructionAudit';
import { kitchenBlock, serviceCompound, storefrontBlock } from './districts';
import { ENTRANCE_SIGN_Z, areaLamp, entranceFrame, furnitureClearance, parkBench } from './furniture';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import { attractionScenery, garden, restTerrace, sign, themedBuilding } from './theme';
import { PARK_THEMES, type ParkData, type ParkPart, type ParkTheme, type RideDefinition } from './types';

/** These tests audit small, focused scenes with the same construction audit the whole park goes through. Each assembly must come
 * out clean at several sizes, and a copy with one member 50 mm out of place must be rejected, so the audit is shown to see the
 * defect each fix removed. */
function scene(): ParkData {
  return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, 12, 0], yaw: 0 },
    rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] };
}
/** Audit findings as readable lines, for parts added from index `from` on (the other side of a pair may be any part). */
function problems(park: ParkData, from = 0): string[] {
  return auditPark(park, [], { focus: i => i >= from }).findings.map(f => `${f.kind} ${f.family} ${(f.measured * 1000).toFixed(1)} mm: ${f.detail} [${f.sources.map(s => s.split(' < ')[0]).join(' x ')}]`);
}
const PLASTER: Vec3 = [0.56, 0.5, 0.4], TIMBER: Vec3 = [0.3, 0.2, 0.1], STONE: Vec3 = [0.38, 0.35, 0.29];
const GROUND_TOP = 0.2;
/** A paving slab, with its top at the shared paving level, for assemblies to stand on. */
function ground(b: Parts, x: number, z: number, halfX: number, halfZ: number): void { b.box([x, GROUND_TOP / 2, z], [halfX, GROUND_TOP / 2, halfZ], STONE, { surface: 'concrete' }); }
const isUpright = (p: ParkPart): boolean => Math.abs(p.rot[0]) + Math.abs(p.rot[1]) + Math.abs(p.rot[2]) < 1e-9;
/** Slide a part sideways or down by `offset` metres, the way a wrongly cut or wrongly placed member would sit. */
function nudge(part: ParkPart, offset: Vec3): void { for (let k = 0; k < 3; k++) part.pos[k] += offset[k]; }
/** Make an upright part longer upward by `extra` metres, keeping its bottom where it was. */
function lengthenUp(part: ParkPart, extra: number): void { part.half[1] += extra / 2; part.pos[1] += extra / 2; }
/** Make an upright part longer downward by `extra` metres, keeping its top where it was. */
function lengthenDown(part: ParkPart, extra: number): void { part.half[1] += extra / 2; part.pos[1] -= extra / 2; }

describe('pitched roofs', () => {
  const sizes = [
    { name: 'row roof that meets its neighbour', width: 6.4, rise: 2.25, depth: 9.9, wallWidth: 6.4, wallDepth: 9.9, options: { flushEave: true, drainage: false } },
    { name: 'shop roof with gutters and downpipes', width: 6.8, rise: 3.1, depth: 3.95, wallWidth: 6, wallDepth: 3.95, options: {} },
    { name: 'low roof', width: 6.4, rise: 1.8, depth: 3.95, wallWidth: 6, wallDepth: 3.95, options: {} },
    { name: 'wide shallow roof', width: 9, rise: 1.2, depth: 6, wallWidth: 8.4, wallDepth: 6, options: {} },
  ];
  function roofOnWalls(size: typeof sizes[number]): { park: ParkData; leaves: ParkPart[] } {
    const park = scene(), b = new Parts(park, [0, 12, 0], 0, -1, 'building'), wallTop = 3;
    ground(b, 0, 0, size.width + 1, size.depth + 1);
    b.box([0, (GROUND_TOP + wallTop) / 2, 0], [size.wallWidth, (wallTop - GROUND_TOP) / 2, size.wallDepth], PLASTER, { surface: 'masonry' });
    const leaves = pitchedRoof(b, wallTop, size.width, size.depth, size.rise, [0.2, 0.25, 0.2], 'paint', size.wallWidth, size.wallDepth, PLASTER, size.options);
    return { park, leaves };
  }
  it.each(sizes)('has no overlap, gap or loose end: $name', size => {
    expect(problems(roofOnWalls(size).park)).toEqual([]);
  });
  it.each(sizes)('rejects a roof leaf 50 mm too low: $name', size => {
    const { park, leaves } = roofOnWalls(size);
    nudge(leaves[1], [0, -0.05, 0]);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
});

describe('shopfronts', () => {
  const sizes = [{ half: 5.7, wallTop: 5.6, head: 3.7, door: 1.4 }, { half: 6.4, wallTop: 5.92, head: 3.8, door: 2 }, { half: 3.2, wallTop: 4.5, head: 3.2, door: 1 }];
  function front(size: typeof sizes[number]): ParkData {
    const park = scene(), b = new Parts(park, [0, 12, 0], 0, -1, 'building');
    ground(b, 0, 0, size.half + 0.5, 1);
    shopfront(b, 0, size.half, 0, size.wallTop, size.head, size.door, PLASTER, TIMBER, { surface: 'masonry' });
    return park;
  }
  it.each(sizes)('tiles piers, frames, panes and door pulls without overlap: half width $half', size => {
    expect(problems(front(size))).toEqual([]);
  });
  it.each(sizes)('rejects a window pane 50 mm out of its frame: half width $half', size => {
    const park = front(size), pane = park.parts.find(p => p.surface === 'glass' && p.half[0] > 0.3)!;
    nudge(pane, [0.05, 0, 0]);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
});

describe('awnings', () => {
  const sizes = [{ half: 3.2, depth: 3.15, drop: 0.28, back: 4.17 }, { half: 6.32, depth: 2.5, drop: 0.4, back: 3.8 }, { half: 4, depth: 4, drop: 0.2, back: 4.5 }];
  function awning(size: typeof sizes[number]): ParkData {
    const park = scene(), b = new Parts(park, [0, 12, 0], 0, -1, 'building');
    ground(b, 0, -size.depth / 2, size.half + 0.5, size.depth / 2 + 1.2);
    b.box([0, 3.1, 0.2], [size.half + 0.3, 2.9, 0.2], PLASTER, { surface: 'masonry' });
    shopAwning(b, 0, size.half, 0, -size.depth, size.back, size.drop, [0.5, 0.1, 0.1]);
    return park;
  }
  it.each(sizes)('rests its back edge on the wall and its posts under the canopy: half width $half', size => {
    expect(problems(awning(size))).toEqual([]);
  });
  it.each(sizes)('rejects a post 50 mm too long: half width $half', size => {
    const park = awning(size), post = park.parts.find(p => p.shape === 'cylinder')!;
    lengthenUp(post, 0.05);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
});

describe('themed shops', () => {
  const cases = PARK_THEMES.flatMap(theme => [127, 9001].map(seed => [theme, seed] as [ParkTheme, number]));
  it.each(cases)('%s shop (seed %i) has no overlap, gap or loose end', (theme, seed) => {
    const park = scene(); themedBuilding(park, [0, 12, 0], 0, theme, seed);
    expect(problems(park)).toEqual([]);
  });
  it.each(PARK_THEMES.map(theme => [theme]))('rejects the %s roof sunk 50 mm into the shell', theme => {
    const park = scene(); themedBuilding(park, [0, 12, 0], 0, theme, 127);
    // Everything that stands on the shell's top face starts at the same height; lower all of it.
    const resting = park.parts.filter(p => isUpright(p) && Math.abs(p.pos[1] - p.half[1] - (12 + 5.6)) < 1e-6);
    expect(resting.length).toBeGreaterThan(0);
    for (const part of resting) nudge(part, [0, -0.05, 0]);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
});

describe('street rows', () => {
  const cases = PARK_THEMES.flatMap(theme => [2, 4].map(units => [theme, units] as [ParkTheme, number]));
  it.each(cases)('%s row of %i units stands clean, with or without a back yard', (theme, units) => {
    for (const rear of [true, false]) {
      const park = scene(); storefrontBlock(park, [0, 12, 0], 0, theme, 7, units, rear);
      expect(problems(park), `${theme} rear=${rear}`).toEqual([]);
    }
  }, 60_000);
  it.each(PARK_THEMES.map(theme => [theme]))('rejects the %s ceiling slab 50 mm too low', theme => {
    const park = scene(); storefrontBlock(park, [0, 12, 0], 0, theme, 7, 3);
    const deck = park.parts.find(p => p.shape === 'box' && Math.abs(p.half[1] - 0.09) < 1e-9 && Math.abs(p.half[0] - 3 * 6.4) < 1e-9)!;
    nudge(deck, [0, -0.05, 0]);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
  it('lets a kitchen block stand against a row built without a back yard, and rejects one built with a yard slab under it', () => {
    for (const theme of ['alpine', 'western', 'space'] as ParkTheme[]) {
      const park = scene(); storefrontBlock(park, [0, 12, 0], 0, theme, 7, 4, false); kitchenBlock(park, [0, 12, 0], 0, theme);
      expect(problems(park), theme).toEqual([]);
      const wrong = scene(); storefrontBlock(wrong, [0, 12, 0], 0, theme, 7, 4, true); kitchenBlock(wrong, [0, 12, 0], 0, theme);
      expect(problems(wrong).some(line => line.startsWith('penetration')), theme).toBe(true);
    }
  }, 60_000);
  it('keeps a service compound clear of its sheds, fences and the neighbouring row', () => {
    for (const theme of ['alpine', 'steampunk', 'carnival'] as ParkTheme[]) for (const side of [-1, 1]) {
      const park = scene(); serviceCompound(park, [0, 12, 0], 0, side, theme);
      expect(problems(park), `${theme} ${side}`).toEqual([]);
    }
    // A row and the compound beside it share the district's spacing constants: the compound begins where the row's yard ends.
    const park = scene(); storefrontBlock(park, [29, 12, 0], Math.PI / 2, 'alpine', 7, 3); serviceCompound(park, [29 + 11 + 14, 12, 0], 0, 1, 'alpine');
    expect(problems(park)).toEqual([]);
    const crowded = scene(); storefrontBlock(crowded, [29, 12, 0], Math.PI / 2, 'alpine', 7, 3); serviceCompound(crowded, [29 + 11 + 13, 12, 0], 0, 1, 'alpine');
    expect(problems(crowded).some(line => line.startsWith('penetration'))).toBe(true);
  }, 60_000);
  it('rejects a service fence 50 mm sunk into its pad', () => {
    const park = scene(); serviceCompound(park, [0, 12, 0], 0, 1, 'alpine');
    const fence = park.parts.find(p => p.shape === 'box' && Math.abs(p.half[1] - 1.19) < 1e-9)!;
    nudge(fence, [0, -0.05, 0]);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
});

describe('attraction scenery', () => {
  const ride = (theme: ParkTheme): RideDefinition => ({ id: 0, family: 'carousel', theme, yaw: 0.4, name: 'TEST RIDE', queue: [[22, 12.2, -53]] } as unknown as RideDefinition);
  it.each(PARK_THEMES.map(theme => [theme]))('%s queue, canopy and gate have no overlap, gap or loose end', theme => {
    const park = scene(); attractionScenery(park, ride(theme), true);
    expect(problems(park)).toEqual([]);
  });
  it('rejects a queue rail 50 mm too long and a canopy post 50 mm too long', () => {
    const rail = scene(); attractionScenery(rail, ride('alpine'), true);
    const longRail = rail.parts.find(p => p.shape === 'cylinder' && Math.abs(p.half[0] - 0.035) < 1e-9 && Math.abs(p.half[1] - 1) < 1e-9)!;
    longRail.half[1] += 0.05;
    expect(problems(rail).length).toBeGreaterThan(0);
    const canopy = scene(); attractionScenery(canopy, ride('alpine'), true);
    const post = canopy.parts.find(p => p.shape === 'cylinder' && Math.abs(p.half[0] - 0.075) < 1e-9)!;
    lengthenUp(post, 0.05);
    expect(problems(canopy).some(line => line.startsWith('penetration'))).toBe(true);
  });
  it('builds the show-building cladding, ribs, petals and roof units without overlap, and rejects a rib or post out of place', () => {
    const build = (): ParkData => {
      const park = scene(), b = new Parts(park), center: Vec3 = [117, 27, -83], hx = 80, hz = 50, opening = 12, color: Vec3 = [0.01, 0.01, 0.01];
      const min: Vec3 = [center[0] - hx, 11.5, center[2] - hz], max: Vec3 = [center[0] + hx, 42, center[2] + hz];
      b.box([center[0], 42, center[2]], [hx, 0.35, hz], color);
      for (const side of [-1, 1]) {
        b.box([center[0] + side * hx, center[1], center[2]], [0.35, 15, hz], color);
        b.box([center[0] + side * (hx + opening) / 2, center[1], max[2]], [(hx - opening) / 2, 15, 0.35], color);
      }
      b.box([center[0], center[1], min[2]], [hx, 15, 0.35], color);
      b.box([center[0], max[1] - 4, max[2]], [opening, 4, 0.35], color);
      park.rooms.push({ min, max, ride: 0 });
      return park;
    };
    const park = build(), before = park.parts.length;
    attractionScenery(park, { id: 0, family: 'space', theme: 'space', yaw: 0.73, name: 'TEST RIDE', queue: [[0, 12.2, 100]] } as unknown as RideDefinition, true);
    const added = park.parts.slice(before).filter(p => p.shape === 'cylinder' && Math.abs(p.half[0] - 0.17) < 1e-9);
    expect(added.length).toBe(16);
    expect(problems(park, before)).toEqual([]);
    nudge(added[0], [0, -0.05, 0]);
    expect(problems(park, before).some(line => line.startsWith('penetration'))).toBe(true);
    const second = build(), start = second.parts.length;
    attractionScenery(second, { id: 0, family: 'space', theme: 'space', yaw: 0.73, name: 'TEST RIDE', queue: [[0, 12.2, 100]] } as unknown as RideDefinition, true);
    lengthenUp(second.parts.slice(start).find(p => p.shape === 'cylinder' && Math.abs(p.half[0] - 0.12) < 1e-9)!, 0.05);
    expect(problems(second, start).some(line => line.startsWith('penetration'))).toBe(true);
  }, 60_000);
});

describe('terraces, kiosks and gardens', () => {
  const themes = PARK_THEMES.map(theme => [theme]);
  it.each(themes)('%s terrace with tables, stools and kiosk has no overlap, gap or loose end', theme => {
    for (const seed of [5, 41]) {
      const park = scene(); restTerrace(new Parts(park, [0, 12, 0], 0, -1, 'furniture'), theme, new Rng(seed));
      expect(problems(park), `seed ${seed}`).toEqual([]);
    }
  });
  it.each(themes)('%s garden has no overlap, gap or loose end', theme => {
    for (const seed of [5, 41]) {
      const park = scene(); garden(new Parts(park, [0, 12, 0], 0, -1, 'furniture'), theme, new Rng(seed));
      expect(problems(park), `seed ${seed}`).toEqual([]);
    }
  });
  it('rejects a table mast 50 mm too long and a garden kerb 50 mm out of place', () => {
    const terrace = scene(); restTerrace(new Parts(terrace, [0, 12, 0], 0, -1, 'furniture'), 'alpine', new Rng(5));
    const masts = terrace.parts.filter(p => p.shape === 'cylinder' && Math.abs(p.half[0] - 0.045) < 1e-9).sort((a, c) => a.pos[1] - c.pos[1]);
    lengthenUp(masts[0], 0.05);
    expect(problems(terrace).some(line => line.startsWith('penetration'))).toBe(true);
    const bed = scene(); garden(new Parts(bed, [0, 12, 0], 0, -1, 'furniture'), 'alpine', new Rng(5));
    const kerb = bed.parts.find(p => p.shape === 'box' && Math.abs(p.half[0] - 0.1) < 1e-9 && Math.abs(p.half[2] - 4.6) < 1e-9)!;
    nudge(kerb, [-Math.sign(kerb.pos[0]) * 0.05, 0, 0]);
    expect(problems(bed).some(line => line.startsWith('penetration'))).toBe(true);
  });
});

describe('benches, lamps and the entrance gate', () => {
  /** A bench or lamp on bare grade, and the same on a paving slab: its feet follow the surface under them. */
  const placed = (build: (b: Parts) => void, onSlab: boolean): ParkData => {
    const park = scene(), b = new Parts(park, [0, 12, 0], 0, -1, 'furniture');
    if (onSlab) ground(b, 0, 0, 3, 3);
    build(b); return park;
  };
  it.each([[false], [true]])('bench stands on its feet (slab: %s)', onSlab => {
    expect(problems(placed(parkBench, onSlab))).toEqual([]);
  });
  it('rejects a bench leg 50 mm too long', () => {
    const park = placed(parkBench, true);
    const leg = park.parts.filter(p => Math.abs(p.half[0] - 0.045) < 1e-9 && Math.abs(p.half[2] - 0.045) < 1e-9).sort((a, c) => a.pos[1] - c.pos[1])[0];
    lengthenDown(leg, 0.05);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
  it.each([[false], [true]])('lamp stands on its footing and carries its housing (slab: %s)', onSlab => {
    expect(problems(placed(b => areaLamp(b, 0, 0), onSlab))).toEqual([]);
  });
  it('rejects a lamp post 50 mm too long', () => {
    const park = placed(b => areaLamp(b, 0, 0), false);
    lengthenUp(park.parts.find(p => p.shape === 'cylinder' && Math.abs(p.half[0] - 0.065) < 1e-9)!, 0.05);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
  it('mounts the gate sign directly on the gate beam, and rejects a sign 50 mm into it', () => {
    const build = (): ParkData => placed(b => { entranceFrame(b); sign(b, 'WONDER PARK', [0, 11, ENTRANCE_SIGN_Z], [0.8, 0.7, 0.5], 0.3); }, false);
    expect(problems(build())).toEqual([]);
    const park = build(), board = park.parts.find(p => p.shape === 'box' && Math.abs(p.half[2] - 0.12) < 1e-9 && p.half[0] > 5)!;
    nudge(board, [0, 0, 0.05]);
    expect(problems(park).some(line => line.startsWith('penetration'))).toBe(true);
  });
});

describe('path furniture placement', () => {
  it('refuses a bench or lamp where a solid part already stands, and accepts open ground and paving', () => {
    const park = scene(), b = new Parts(park, [0, 12, 0], 0, -1, 'building');
    // Paving belongs to the path category, which furniture is allowed to stand on.
    new Parts(park, [0, 12, 0], 0, -1, 'path').box([0, GROUND_TOP / 2, 0], [30, GROUND_TOP / 2, 30], STONE, { surface: 'concrete' });
    b.rod([5, 0.2, 0], [5, 3, 0], 0.035, [0.3, 0.3, 0.3]);
    b.box([-10, 1, 0], [0.5, 1, 4], PLASTER);
    const room = furnitureClearance(park);
    expect(room.bench(20, 20, 0)).toBe(true);
    expect(room.pole(20, 20)).toBe(true);
    // A thin sign post through the seat, a wall touching the end of the bench, and a bench turned across the wall.
    expect(room.bench(5.3, 0, 0)).toBe(false);
    expect(room.bench(-8.9, 0, 0)).toBe(false);
    expect(room.bench(-10, 2, Math.PI / 2)).toBe(false);
    expect(room.bench(-5, 0, 0)).toBe(true);
    expect(room.pole(5.2, 0)).toBe(false);
    expect(room.pole(-10.3, 1)).toBe(false);
    expect(room.pole(-7, 0)).toBe(true);
  });
  it.each([['alpine'], ['space'], ['carnival']] as [ParkTheme][])('keeps benches clear of %s queue scenery wherever the check accepts one', theme => {
    const build = (): ParkData => { const park = scene(); attractionScenery(park, { id: 0, family: 'carousel', theme, yaw: 0.4, name: 'TEST RIDE', queue: [[22, 12.2, -53]] } as unknown as RideDefinition, true); return park; };
    const room = furnitureClearance(build());
    let accepted = 0, refused = 0;
    for (let x = 6; x <= 40; x += 3) for (let z = -70; z <= -36; z += 3) {
      if (!room.bench(x, z, 0.4 - Math.PI / 2)) { refused++; continue; }
      accepted++;
      const park = build(), before = park.parts.length;
      parkBench(new Parts(park, [x, 12, z], 0.4 - Math.PI / 2, -1, 'furniture'));
      expect(problems(park, before).filter(line => line.startsWith('penetration')), `${theme} bench at ${x},${z}`).toEqual([]);
    }
    expect(accepted).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(5);
  }, 120_000);
});
