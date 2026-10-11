import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { STAIR_MAX_RISER } from './assembly';
import { coasterStationDetails, coasterWalkway, type WalkwayStation } from './coasterAccess';
import { buildSupportBent, coasterSupportFrame } from './coasterSupports';
import { auditPark, partFamily } from './constructionAudit';
import { add, cross, mul, pose, rotate, unit } from './math';
import { Parts, partSource, setPartProvenance } from './parts';
import { defaultParkRecipe } from './recipe';
import { RAIL, SUPPORT, WALKWAY } from './rideDimensions';
import { railSample } from './curve';
import { weldedTube } from './rideGeometry';
import { generatePark, gradeParkTerrain } from './generator';
import type { ParkData, ParkPart, ParkSize, RideDefinition } from './types';

/** These tests audit the roller-coaster structure the way the whole park is audited: every part that meets another must meet it the way
 * real steel or timber does (a declared insertion, a weld, a bolted bearing face), never by passing through it. Small hand-built scenes
 * cover the bent, the catwalk and the station at several sizes. Whole parks cover every family the generator builds. Each clean result is
 * paired with a copy that has one member 50 mm out of place, which the audit must reject. */
function scene(): ParkData {
  return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, 12, 0], yaw: 0 },
    rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] };
}
type Finding = ReturnType<typeof auditPark>['findings'][number];
const describeFinding = (f: Finding): string => `${f.kind} ${f.family} ${(f.measured * 1000).toFixed(1)} mm: ${f.detail} [${f.sources.map(s => s.split(' < ')[0]).join(' x ')}]`;
function problems(park: ParkData, options: Parameters<typeof auditPark>[2] = {}): string[] { return auditPark(park, [], options).findings.map(describeFinding); }
/** Slide a part by `offset` metres, the way a wrongly placed member would sit. */
function nudge(part: ParkPart, offset: Vec3): void { for (let k = 0; k < 3; k++) part.pos[k] += offset[k]; }
/** Make a rod longer by `extra` metres at whichever end points along `direction`, keeping the other end fixed. */
function lengthen(part: ParkPart, extra: number, direction: Vec3): void {
  const axis = rotate(part.rot, [0, 1, 0]), sign = axis[0] * direction[0] + axis[1] * direction[1] + axis[2] * direction[2] > 0 ? 1 : -1;
  part.half[1] += extra / 2;
  for (let k = 0; k < 3; k++) part.pos[k] += sign * axis[k] * extra / 2;
}
const COLOUR: Vec3 = [0.2, 0.3, 0.4];
const rejected = (lines: string[]) => lines.some(line => /^(penetration|protruding-end|contract-violation|floating|coplanar-conflict)/.test(line));

describe('support bents', () => {
  const cases = [
    { name: 'steel bent with vertical columns', inverted: false, spread: 0, bank: 0 },
    { name: 'steel bent with columns leaning out', inverted: false, spread: 1.4, bank: 0 },
    { name: 'steel bent on banked track', inverted: false, spread: 1.4, bank: 0.4 },
    { name: 'steel bent leaning far out on banked track', inverted: false, spread: 3, bank: 0.3 },
    { name: 'suspended portal', inverted: true, spread: 0, bank: 0.3 },
  ];
  /** A bent under a 10 m straight length of backbone at 20 m, track banked by `bank` radians about its direction of travel. */
  function bentScene(c: typeof cases[number]): { park: ParkData; bent: ReturnType<typeof buildSupportBent> } {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'ride'), sample = railSample();
    sample.pos = [0, 20, 0]; sample.tangent = [0, 0, 1]; sample.up = [Math.sin(c.bank), Math.cos(c.bank), 0];
    const centre = add(sample.pos, mul(sample.up, c.inverted ? RAIL.spineOffset : -RAIL.spineOffset));
    const backbone = b.rod(add(centre, [0, 0, -5]), add(centre, [0, 0, 5]), RAIL.spineRadius, COLOUR);
    const frame = coasterSupportFrame(sample, c.inverted, c.spread);
    const bent = buildSupportBent(park, b, frame, { id: 'test/bent', wooden: false, color: COLOUR, timberFinish: false, floor: SUPPORT.footingBottom, backbone: { receiver: backbone, centre } });
    return { park, bent };
  }
  it.each(cases)('has no overlap, gap or loose end: $name', c => {
    expect(problems(bentScene(c).park)).toEqual([]);
  });
  it.each(cases)('rejects a column foot 300 mm too long, through its base plate: $name', c => {
    const { park, bent } = bentScene(c);
    lengthen(bent.columns[0], 0.3, [0, -1, 0]);
    expect(rejected(problems(park))).toBe(true);
  });
  it.each(cases)('rejects a crosshead 300 mm too long, through its column: $name', c => {
    const { park, bent } = bentScene(c);
    lengthen(bent.crosshead, 0.3, [1, 0, 0]);
    expect(rejected(problems(park))).toBe(true);
  });
});

describe('service catwalk', () => {
  /** Ten stations 1.5 m apart along a straight run or an arc of the given radius. The backbone beneath (or above) the rail is welded from 0.75 m lengths,
   * and every other station has a bracket that starts at the middle of a length, a quarter station spacing behind it. */
  function catwalkScene(radius: number, overhead: boolean): { park: ParkData; posts: ParkPart[] } {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'ride'), count = 10, spacing = 1.5, length = 0.75;
    const frameAt = (distance: number) => {
      const angle = Number.isFinite(radius) ? distance / radius : 0;
      const pos: Vec3 = Number.isFinite(radius) ? [radius * Math.cos(angle), 20, radius * Math.sin(angle)] : [distance, 20, 0];
      const tangent: Vec3 = Number.isFinite(radius) ? [-Math.sin(angle), 0, Math.cos(angle)] : [1, 0, 0], up: Vec3 = [0, 1, 0];
      return { pos, tangent, up, right: cross(tangent, up) };
    };
    const frames = Array.from({ length: count }, (_, i) => frameAt(i * spacing));
    const spine = Array.from({ length: Math.round(count * spacing / length) + 1 }, (_, k) => { const f = frameAt(k * length); return add(f.pos, mul(f.up, overhead ? RAIL.spineOffset : -RAIL.spineOffset)); });
    const tube = weldedTube(b, spine, RAIL.spineRadius, COLOUR, 'test/spine', {}, false);
    const stations: WalkwayStation[] = frames.map((f, i) => {
      const k = Math.round((i * spacing - spacing / 4 - length / 2) / length);
      return { ...f, bracket: i % 2 === 1 && k >= 0 ? { receiver: tube[0], root: mul(add(spine[k], spine[k + 1]), 0.5) } : undefined };
    });
    const before = park.parts.length;
    coasterWalkway(park, b, 'test/catwalk', stations, overhead);
    return { park, posts: park.parts.slice(before).filter(p => p.shape === 'cylinder' && Math.abs(p.half[0] - WALKWAY.postRadius) < 1e-9) };
  }
  const cases = [{ name: 'straight run', radius: Infinity, overhead: false }, { name: 'gentle bend', radius: 40, overhead: false }, { name: 'tight bend', radius: 9, overhead: false },
    { name: 'suspended run, tight bend', radius: 9, overhead: true }, { name: 'suspended run, straight', radius: Infinity, overhead: true }];
  it.each(cases)('has no overlap or loose end: $name', c => {
    expect(problems(catwalkScene(c.radius, c.overhead).park, { checks: { support: false } })).toEqual([]);
  });
  it.each(cases)('rejects a guard post 50 mm out of place: $name', c => {
    const { park, posts } = catwalkScene(c.radius, c.overhead);
    nudge(posts[2], [0, 0, 0.05]);
    nudge(posts[3], [0.05, 0, 0]);
    expect(rejected(problems(park, { checks: { support: false } }))).toBe(true);
  });
});

describe('loading station', () => {
  const rises = [3.2, 3.47, 4.4];
  function stationScene(rise: number): { park: ParkData; ride: RideDefinition } {
    const ride = { id: 0, name: 'Test Coaster', theme: 'fantasy', family: 'steel' } as unknown as RideDefinition, park = scene();
    park.rides.push(ride);
    const platform: Vec3 = [0, 12.2 + rise, 0], b = new Parts(park, platform, 0, -1, 'ride');
    b.box([0, -0.35, 0], [2, 0.35, 13], [0.5, 0.5, 0.5], { surface: 'concrete' });
    coasterStationDetails(park, ride, platform, 0, rise, Math.ceil(rise / STAIR_MAX_RISER - 1e-9));
    return { park, ride };
  }
  it.each(rises)('has no overlap, gap or loose end: platform %f m above the paving', rise => {
    expect(problems(stationScene(rise).park)).toEqual([]);
  });
  it.each(rises)('rejects a roof column 50 mm out of its cross beam: platform %f m above the paving', rise => {
    const { park } = stationScene(rise), interfaces = park.interfaces!.filter(c => c.name.endsWith('/roof-column-beam'));
    expect(interfaces.length).toBe(3);
    const beam = park.parts[interfaces[0].a], column = park.parts[interfaces[0].b];
    nudge(column, mul(rotate(beam.rot, [0, 0, 1]), 0.05));
    expect(rejected(problems(park))).toBe(true);
  });
  it.each(rises)('rejects a stair baluster 50 mm too long: platform %f m above the paving', rise => {
    const { park } = stationScene(rise), contract = park.interfaces!.find(c => c.name.includes('/stair/baluster/'))!;
    lengthen(park.parts[contract.b], 0.05, [0, 1, 0]);
    expect(rejected(problems(park))).toBe(true);
  });
});

describe('welded tubes and beams', () => {
  it('keeps a closed ring of 40 chords clear of itself, and rejects a chord pushed 50 mm out', () => {
    const park = scene(), b = new Parts(park, [0, 20, 0], 0, -1, 'ride'), points: Vec3[] = Array.from({ length: 40 }, (_, j) => [2.6 * Math.cos(j * Math.PI / 20), 0.65 * Math.sin(j * Math.PI / 20), 2.6 * Math.sin(j * Math.PI / 20)]);
    const ring = weldedTube(b, points, 0.045, COLOUR, 'test/ring');
    expect(problems(park, { checks: { support: false } })).toEqual([]);
    nudge(ring[7], [0, 0.05, 0]);
    expect(rejected(problems(park, { checks: { support: false } }))).toBe(true);
  });
});

/** Parts the coaster generator builds directly; the other side of a pair may be anything. */
const STRUCTURE = /coasterAssets|coasterStationDetails|weldedTube|weldedBeam|buildSupportBent|coasterWalkway/;
const parks = new Map<string, ParkData>();
function builtPark(seed: number, size: ParkSize): ParkData {
  const key = `${seed}/${size}`;
  let park = parks.get(key);
  if (!park) {
    const recipe = { ...defaultParkRecipe(seed, size), guests: 0 };
    setPartProvenance(true);
    try { park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe))); } finally { setPartProvenance(false); }
    parks.set(key, park);
  }
  return park;
}
/** Every finding on the coaster structure of the given families whose parts all come from the coaster generator. */
function structureProblems(park: ParkData, families: string[]): string[] {
  const wanted = new Set(families), focus = (i: number) => park.parts[i].body < 0 && wanted.has(partFamily(park, i)) && STRUCTURE.test(partSource(park.parts[i]));
  return auditPark(park, park.bodies.map(() => pose()), { focus }).findings.filter(f => f.sources.every(src => STRUCTURE.test(src))).map(describeFinding);
}

describe.each([[1337, 'compact'], [7, 'compact']] as const)('whole park, seed %i, %s', (seed, size) => {
  it('builds steel, launch and suspended coaster structure with no overlap, gap or loose end', () => {
    const park = builtPark(seed, size);
    expect(park.rides.filter(r => r.curve).map(r => r.family).sort()).toEqual(['inverted', 'launch', 'steel']);
    expect(structureProblems(park, ['steel', 'launch', 'inverted'])).toEqual([]);
  }, 600000);
  /** Each defect moves one member of the finished park by 50 mm and checks the audit, restricted to that member and its partner, sees it. */
  const defects: { name: string; contract: string; spoil: (part: ParkPart, partner: ParkPart) => void }[] = [
    { name: 'a column 50 mm out of its base shoe', contract: '/column-shoe', spoil: part => nudge(part, [0.05, 0, 0]) },
    { name: 'a cross tie 50 mm too high at the rail', contract: '/tie-rail', spoil: part => nudge(part, [0, 0.05, 0]) },
    { name: 'a guard rail 50 mm out of its post', contract: '/guard-rail', spoil: (part, partner) => { const axis = rotate(part.rot, [0, 1, 0]); nudge(partner, mul(unit(cross(axis, [0, 1, 0])), 0.05)); } },
    { name: 'a stair baluster 50 mm too long', contract: '/stair/baluster/', spoil: part => lengthen(part, 0.05, [0, 1, 0]) },
    { name: 'a roof column 50 mm out of its cross beam', contract: '/roof-column-beam', spoil: (part, partner) => nudge(part, mul(rotate(partner.rot, [0, 0, 1]), 0.05)) },
  ];
  it.each(defects)('rejects $name', ({ contract, spoil }) => {
    const park = builtPark(seed, size), found = park.interfaces!.find(c => c.name.includes(contract))!;
    expect(found, contract).toBeDefined();
    const receiver = park.parts[found.a], member = park.parts[found.b], focus = (i: number) => park.parts[i] === receiver || park.parts[i] === member;
    expect(problems(park, { focus })).toEqual([]);
    const saved = { receiver: { pos: [...receiver.pos], half: [...receiver.half] }, member: { pos: [...member.pos], half: [...member.half] } };
    try {
      spoil(member, receiver);
      expect(rejected(problems(park, { focus }))).toBe(true);
    } finally {
      receiver.pos = saved.receiver.pos as Vec3; receiver.half = saved.receiver.half as Vec3; member.pos = saved.member.pos as Vec3; member.half = saved.member.half as Vec3;
    }
  }, 600000);
});

describe('whole destination park, seed 1337', () => {
  it('builds timber, hyper, mine and space coaster structure with no overlap, gap or loose end', () => {
    const park = builtPark(1337, 'destination');
    expect(park.rides.filter(r => r.curve).map(r => r.family).sort()).toEqual(['hyper', 'inverted', 'launch', 'mine', 'space', 'steel', 'wooden']);
    expect(structureProblems(park, ['wooden', 'hyper', 'mine', 'space'])).toEqual([]);
  }, 1800000);
});
