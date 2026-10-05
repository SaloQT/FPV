import { beforeAll, describe, expect, it } from 'vitest';
import type { GeneratedStyle, TerrainSampler, TrackData, TrackFeature } from '../../contracts';
import { distanceToBox, obstacleColliders, trackColliders } from './colliders';
import { generateTrack } from './generator';
import { DROP_HEIGHT, DROP_PITCH, HURDLE_SILL, LADDER_MIN_GAP, TUNNEL_MIN_SIZE, WINDOW_MIN_SILL, flyUnder, isCompositeObstacle, isUprightKind, ladderGroups, obstacleToWorld } from './kindGeometry';
import { gateClearance } from './clearance';
import { defaultRecipe, randomRecipe, sanitizeRecipe } from './recipe';
import { STYLE_SPECS } from './styles';
import { makeTestSampler } from './testTerrain';
import { validateTrack } from './validate';
import { featureZones } from './validateFeatures';

const SLOW = 120_000;
const STYLES = ['technical', 'acro', 'industrial'] as const;
const SEEDS = 30;
const STRUCTURES = new Set(['container', 'tower', 'pillar', 'beam', 'bridge', 'scaffold']);

let sampler: TerrainSampler;
const sweep = new Map<GeneratedStyle, TrackData[]>();

beforeAll(() => {
  sampler = makeTestSampler({ seed: 3 });
  for (const style of STYLES) {
    const list: TrackData[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) list.push(generateTrack({ seed, style }, sampler));
    sweep.set(style, list);
  }
}, SLOW);

const all = (): TrackData[] => STYLES.flatMap((s) => sweep.get(s)!);
const features = (t: TrackData): Set<TrackFeature> => new Set(t.gates.flatMap((g) => (g.feature ? [g.feature] : [])));

describe(`validity sweep (${SEEDS} seeds x ${STYLES.length} feature styles, synthetic terrain)`, () => {
  for (const style of STYLES) {
    it(`${style}: every track validates, with the style's shape, gate count and length`, () => {
      const spec = STYLE_SPECS[style];
      for (const t of sweep.get(style)!) {
        expect(validateTrack(t, sampler).errors, `${style} seed ${t.seed}`).toEqual([]);
        expect(t.style).toBe(style);
        expect(t.closed).toBe(spec.closed);
        expect(t.laps).toBe(spec.defaultLaps);
        expect(t.gates.length, `${style} seed ${t.seed}`).toBe(spec.defaultGates);
        expect(t.length).toBeGreaterThanOrEqual(spec.minLength);
        expect(t.length).toBeLessThanOrEqual(spec.maxLength);
        expect(t.gates[0].kind).toBe('start');
        if (!t.closed) expect(t.gates[t.gates.length - 1].kind).toBe('finish');
        expect(t.obstacles.length).toBeGreaterThan(0);
      }
    });
  }

  it('also validates on a lake terrain and a rough one (falling back to fewer gates where it must)', () => {
    for (const terrain of [makeTestSampler({ seed: 5, waterFraction: 0.18 }), makeTestSampler({ seed: 7, roughness: 3 })]) {
      for (const style of STYLES) {
        for (let seed = 1; seed <= 6; seed++) {
          const t = generateTrack({ seed, style }, terrain);
          expect(validateTrack(t, terrain).errors, `${style} seed ${seed}`).toEqual([]);
        }
      }
    }
  }, SLOW);
});

describe('features present', () => {
  it('every technical track has a split-S; most also fly ladders, tunnels, windows, hurdles or hairpins', () => {
    const extra = new Set<TrackFeature>();
    for (const t of sweep.get('technical')!) {
      const f = features(t);
      expect(f.has('split-s'), `seed ${t.seed}`).toBe(true);
      for (const k of f) extra.add(k);
    }
    for (const k of ['ladder', 'tunnel', 'window', 'hurdle', 'hairpin'] as const) expect(extra.has(k), k).toBe(true);
  });

  it('every acro track has a power loop; split-S, corkscrews, drops and dives all appear', () => {
    const seen = new Set<TrackFeature>();
    for (const t of sweep.get('acro')!) {
      const f = features(t);
      expect(f.has('power-loop'), `seed ${t.seed}`).toBe(true);
      for (const k of f) seen.add(k);
    }
    for (const k of ['split-s', 'corkscrew', 'drop', 'dive'] as const) expect(seen.has(k), k).toBe(true);
  });

  it('every industrial track has a window and a tunnel among structures; beams and bridges cross the line', () => {
    let crossings = 0;
    const kinds = new Set<string>();
    for (const t of sweep.get('industrial')!) {
      const f = features(t);
      expect(f.has('window') && f.has('tunnel'), `seed ${t.seed}`).toBe(true);
      expect(t.obstacles.filter((o) => STRUCTURES.has(o.kind)).length, `seed ${t.seed}`).toBeGreaterThanOrEqual(5);
      for (const o of t.obstacles) kinds.add(o.kind);
      if (t.obstacles.some((o) => flyUnder(o) && passesUnder(t, o))) crossings++;
    }
    for (const k of STRUCTURES) expect(kinds.has(k), k).toBe(true);
    expect(crossings).toBeGreaterThanOrEqual(SEEDS * 0.6);
  });

  it('a manoeuvre gives every one of its gates the feature tag, in one run', () => {
    for (const t of all()) {
      const zones = featureZones(t);
      for (const z of zones.zones) for (let k = 1; k < z.gates.length; k++) expect(z.gates[k]).toBe(z.gates[k - 1] + 1);
    }
  });
});

/** True when some path sample is under the deck of this beam or bridge (inside its span and depth). */
function passesUnder(t: TrackData, o: TrackData['obstacles'][number]): boolean {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return t.path.some((p) => {
    const dx = p[0] - o.pos[0];
    const dz = p[2] - o.pos[2];
    return Math.abs(c * dx - s * dz) < o.size[0] / 2 && Math.abs(s * dx + c * dz) < o.size[2] / 2;
  });
}

describe('gate rules of the new kinds', () => {
  it('drops are pitched exactly straight down; upright kinds stand upright; only dives and drops are pitched', () => {
    let drops = 0;
    for (const t of all()) {
      for (const g of t.gates) {
        if (g.kind === 'drop') {
          drops++;
          expect(g.pitch).toBe(DROP_PITCH);
        } else if (isUprightKind(g.kind)) {
          expect(g.pitch).toBe(0);
          expect(g.roll).toBe(0);
        } else if (g.kind !== 'dive') expect(g.pitch).toBe(0);
        else expect(Math.abs(g.pitch)).toBeLessThanOrEqual(1.4);
      }
    }
    expect(drops).toBeGreaterThan(0);
  });

  it('climb gates exist: a dive manoeuvre may pitch a gate upward', () => {
    const pitches = all().flatMap((t) => t.gates.filter((g) => g.kind === 'dive').map((g) => g.pitch));
    expect(pitches.some((p) => p > 0.2)).toBe(true);
    expect(pitches.some((p) => p < -0.2)).toBe(true);
  });

  it('windows keep their sill, tunnels their size and sleeve, ladder rungs their vertical gap', () => {
    for (const t of all()) {
      for (const g of t.gates) {
        if (g.kind === 'window') expect(gateClearance(g, sampler)).toBeGreaterThanOrEqual(WINDOW_MIN_SILL - 1e-3);
        if (g.kind === 'tunnel') {
          expect(Math.min(g.width, g.height)).toBeGreaterThanOrEqual(TUNNEL_MIN_SIZE);
          expect(g.depth).toBeGreaterThan(0);
        }
      }
      for (const grp of ladderGroups(t.gates)) {
        for (let k = 1; k < grp.rungs.length; k++) {
          const lo = t.gates[grp.rungs[k - 1]];
          const hi = t.gates[grp.rungs[k]];
          expect(hi.pos[1] - lo.pos[1]).toBeGreaterThanOrEqual((lo.height + hi.height) / 2 + LADDER_MIN_GAP - 1e-3);
        }
      }
    }
  });

  it('the whole path keeps 0.2 m from every gate box (rails, walls, sleeves, posts), not just near its own gate', () => {
    for (const t of all()) {
      const boxes = trackColliders({ ...t, obstacles: [] }, sampler);
      for (const b of boxes) {
        const r = Math.hypot(b.half[0], b.half[1], b.half[2]) + 0.2;
        for (const p of t.path) {
          if (Math.abs(p[0] - b.center[0]) > r || Math.abs(p[2] - b.center[2]) > r) continue;
          expect(distanceToBox(b, p[0], p[1], p[2]), `${t.style} seed ${t.seed}`).toBeGreaterThanOrEqual(0.2);
        }
      }
    }
  }, SLOW);
});

describe('obstacles of the feature styles', () => {
  it('structures keep 4 m of the line in 3D; beams and bridges are flown under with 1.5 m below the deck and 2 m from posts', () => {
    for (const t of all()) {
      for (const o of t.obstacles) {
        if (!isCompositeObstacle(o.kind)) continue;
        const fly = flyUnder(o);
        if (fly) {
          for (const p of t.path) {
            for (const sup of fly.supports) {
              const dx = p[0] - sup.center[0];
              const dz = p[2] - sup.center[2];
              const lx = Math.max(Math.abs(Math.cos(o.yaw) * dx - Math.sin(o.yaw) * dz) - sup.half[0], 0);
              const lz = Math.max(Math.abs(Math.sin(o.yaw) * dx + Math.cos(o.yaw) * dz) - sup.half[1], 0);
              expect(Math.hypot(lx, lz)).toBeGreaterThanOrEqual(2 - 1e-6);
            }
          }
          if (passesUnder(t, o)) {
            for (const p of t.path) {
              const c = Math.cos(o.yaw);
              const s = Math.sin(o.yaw);
              const dx = p[0] - o.pos[0];
              const dz = p[2] - o.pos[2];
              if (Math.abs(c * dx - s * dz) < o.size[0] / 2 && Math.abs(s * dx + c * dz) < o.size[2] / 2) expect(fly.underside - p[1]).toBeGreaterThanOrEqual(1.5 - 1e-6);
            }
          }
          continue;
        }
        const boxes: Parameters<typeof distanceToBox>[0][] = [];
        obstacleColliders(o, boxes, sampler);
        for (const b of boxes) for (const p of t.path) expect(distanceToBox(b, p[0], p[1], p[2])).toBeGreaterThanOrEqual(4 - 1e-6);
      }
    }
  }, SLOW);

  it('structures stand on dry ground with every footprint corner above the waterline', () => {
    const floor = sampler.data.waterLevel + 1;
    for (const t of all()) {
      for (const o of t.obstacles) {
        if (!isCompositeObstacle(o.kind)) continue;
        expect(Math.abs(o.pos[1] - sampler.heightAt(o.pos[0], o.pos[2]))).toBeLessThan(0.05);
        for (const [u, w] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const p = obstacleToWorld(o, (u * o.size[0]) / 2, 0, (w * o.size[2]) / 2);
          expect(sampler.heightAt(p[0], p[2])).toBeGreaterThanOrEqual(floor - 1e-6);
        }
      }
    }
  });

  it('no flagpoles stand beside drop, ladder, tunnel or window gates', () => {
    for (const t of all()) {
      for (const g of t.gates) {
        if (g.kind !== 'drop' && g.kind !== 'ladder' && g.kind !== 'tunnel' && g.kind !== 'window') continue;
        // gateFlagpoles stands them in the gate plane, 1.4 to 2.2 m outside the frame.
        const inPlane = t.obstacles.filter((o) => {
          if (o.kind !== 'flagpole') return false;
          const dx = o.pos[0] - g.pos[0];
          const dz = o.pos[2] - g.pos[2];
          const side = Math.abs(Math.cos(g.yaw) * dx - Math.sin(g.yaw) * dz);
          const ahead = Math.abs(-Math.sin(g.yaw) * dx - Math.cos(g.yaw) * dz);
          return ahead < 0.05 && side > g.width / 2 + 1.35 && side < g.width / 2 + 2.25;
        });
        expect(inPlane).toEqual([]);
      }
    }
  });
});

describe('hurdle sills and drop heights stay in their contract ranges', () => {
  it('on every feature style and on recipes full of hurdles and drops at every elevation', () => {
    const tracks = [...all()];
    for (let k = 1; k <= 20; k++) tracks.push(generateTrack({ seed: 0, style: 'custom', recipe: randomRecipe(k) }, sampler));
    for (const elevation of [0, 0.5, 1]) {
      for (let seed = 1; seed <= 4; seed++) {
        const recipe = sanitizeRecipe({ ...defaultRecipe(), seed, elevation, features: { hurdle: 1, drop: 1 }, gates: { square: 1, hurdle: 1 }, featureShare: 0.6 });
        tracks.push(generateTrack({ seed: 0, style: 'custom', recipe }, sampler));
      }
    }
    let hurdles = 0;
    let drops = 0;
    for (const t of tracks) {
      expect(validateTrack(t, sampler).errors, `${t.style} seed ${t.seed}`).toEqual([]);
      for (const g of t.gates) {
        if (g.kind === 'hurdle') {
          hurdles++;
          const sill = gateClearance(g, sampler);
          expect(sill, `${t.style} seed ${t.seed} gate ${g.index}`).toBeGreaterThanOrEqual(HURDLE_SILL[0] - 1e-3);
          expect(sill, `${t.style} seed ${t.seed} gate ${g.index}`).toBeLessThanOrEqual(HURDLE_SILL[1] + 1e-3);
        }
        if (g.kind === 'drop') {
          drops++;
          const h = g.pos[1] - sampler.heightAt(g.pos[0], g.pos[2]);
          expect(h, `${t.style} seed ${t.seed} gate ${g.index}`).toBeGreaterThanOrEqual(DROP_HEIGHT[0] - 1e-3);
          expect(h, `${t.style} seed ${t.seed} gate ${g.index}`).toBeLessThanOrEqual(DROP_HEIGHT[1] + 1e-3);
        }
      }
    }
    expect(hurdles).toBeGreaterThan(50);
    expect(drops).toBeGreaterThan(20);
  }, SLOW);
});

/** The obstacle a hairpin turns around (gates i and i + 1), or undefined: a pillar or flagpole at the centre of its half circle, or a wall along its axis. */
function hairpinPylon(t: TrackData, i: number): string | undefined {
  const a = t.gates[i];
  const b = t.gates[i + 1];
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  const cx = (a.pos[0] + b.pos[0]) / 2 + 3.5 * fx;
  const cz = (a.pos[2] + b.pos[2]) / 2 + 3.5 * fz;
  return t.obstacles.find((o) => {
    const dx = o.pos[0] - cx;
    const dz = o.pos[2] - cz;
    if (o.kind === 'pillar' || o.kind === 'flagpole') return Math.hypot(dx, dz) < 0.3;
    if (o.kind !== 'wall') return false;
    const along = dx * fx + dz * fz;
    return Math.abs(dx * fz - dz * fx) < 0.3 && along < -3 && along > -9;
  })?.kind;
}

describe('hairpin pylons', () => {
  it('every hairpin turns around its pylon: walls and flagpoles on technical, pillars and walls from recipes', () => {
    const tracks: TrackData[] = [];
    for (let seed = 1; seed <= 40; seed++) tracks.push(generateTrack({ seed, style: 'technical' }, sampler));
    for (const objects of [{ pillar: 1 }, { wall: 1 }]) {
      for (let seed = 1; seed <= 6; seed++) {
        const recipe = sanitizeRecipe({ ...defaultRecipe(), seed, objects, features: { hairpin: 1, 'split-s': 0.3 }, featureShare: 0.5 });
        tracks.push(generateTrack({ seed: 0, style: 'custom', recipe }, sampler));
      }
    }
    const kinds: Record<string, number> = {};
    let hairpins = 0;
    for (const t of tracks) {
      for (let i = 0; i + 1 < t.gates.length; i++) {
        if (t.gates[i].feature !== 'hairpin' || t.gates[i + 1].feature !== 'hairpin') continue;
        hairpins++;
        const kind = hairpinPylon(t, i);
        expect(kind, `${t.style} seed ${t.seed} hairpin gates ${i}/${i + 1}`).toBeDefined();
        kinds[kind!] = (kinds[kind!] ?? 0) + 1;
        i++;
      }
    }
    expect(hairpins).toBeGreaterThan(20);
    expect(kinds.wall ?? 0, JSON.stringify(kinds)).toBeGreaterThan(0);
    expect(kinds.pillar ?? 0, JSON.stringify(kinds)).toBeGreaterThan(0);
    expect(kinds.flagpole ?? 0, JSON.stringify(kinds)).toBeGreaterThan(0);
  }, SLOW);
});

describe('determinism', () => {
  it('same params and terrain give identical tracks; other seeds differ', () => {
    for (const style of STYLES) {
      const a = generateTrack({ seed: 77, style }, sampler);
      const b = generateTrack({ seed: 77, style }, makeTestSampler({ seed: 3 }));
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(generateTrack({ seed: 78, style }, sampler))).not.toBe(JSON.stringify(a));
    }
  }, SLOW);
});
