import { describe, expect, it } from 'vitest';
import type { TrackData } from '../contracts';
import { makeTrack } from '../game/testKit';
import type { PreviewState } from '../ui/trackPreviewModel';
import { PREVIEW_DEBOUNCE_MS, WorldPreview, worldKey, type PreviewDeps, type WorldSettings } from './preview';
import type { World } from './world';

const BASE: WorldSettings = { seed: 1337, trackStyle: 'race', gateCount: 12, laps: 3, difficulty: 0.4, quality: 'high' };

function fakeWorld(seed: number, quality: World['quality'] = 'high', track: TrackData = makeTrack(3, { seed })): World {
  return { track, seed, style: 'race', attempts: 1, terrain: {} as World['terrain'], sampler: {} as World['sampler'], terrainSeed: seed, baseSeed: seed, quality };
}

interface Rig {
  preview: WorldPreview;
  settings: WorldSettings;
  world: World;
  locked: boolean;
  applyOk: boolean;
  states: PreviewState[];
  calls: string[];
  failNext: string | null;
  gate: { release: (() => void) | null };
  advance(ms: number): void;
  flush(): Promise<void>;
}

function rig(): Rig {
  const timers = new Map<number, { at: number; fn: () => void }>();
  let now = 0;
  let nextId = 1;
  const r = {
    settings: { ...BASE } as WorldSettings,
    world: fakeWorld(1337),
    locked: false,
    applyOk: true,
    states: [] as PreviewState[],
    calls: [] as string[],
    failNext: null as string | null,
    gate: { release: null as (() => void) | null },
  } as Rig;
  const deps: PreviewDeps = {
    settings: () => r.settings,
    world: () => r.world,
    locked: () => r.locked,
    async buildTrack(current, s) {
      r.calls.push(`track:${s.seed}:${s.trackStyle}:${s.gateCount}`);
      if (r.failNext !== null) throw new Error(r.failNext);
      return { ...current, track: makeTrack(s.gateCount, { seed: s.seed }), style: s.trackStyle };
    },
    async buildWorld(s, progress) {
      r.calls.push(`world:${s.seed}`);
      progress('Generating terrain', 0.4);
      if (r.gate.release === null) await new Promise<void>((res) => { r.gate.release = res; });
      if (r.failNext !== null) throw new Error(r.failNext);
      return fakeWorld(s.seed, s.quality, makeTrack(s.gateCount, { seed: s.seed }));
    },
    apply(w) {
      r.calls.push(`apply:${w.seed}`);
      if (!r.applyOk) return false;
      r.world = w;
      return true;
    },
    emit: (st) => r.states.push(st),
    after(ms, fn) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    cancel: (id) => void timers.delete(id),
  };
  r.preview = new WorldPreview(deps, BASE);
  r.advance = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  r.flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise<void>((res) => setTimeout(res, 0));
  };
  return r;
}

describe('worldKey', () => {
  it('differs for every setting that decides the world and nothing else', () => {
    const k = worldKey(BASE);
    for (const patch of [{ seed: 2 }, { trackStyle: 'sprint' as const }, { gateCount: 16 }, { laps: 1 }, { difficulty: 0.9 }, { quality: 'low' as const }]) {
      expect(worldKey({ ...BASE, ...patch })).not.toBe(k);
    }
    expect(worldKey({ ...BASE })).toBe(k);
  });

  it('ignores gate counts a style clamps away and laps a point-to-point style does not fly', () => {
    const sprint = { ...BASE, trackStyle: 'sprint' as const };
    expect(worldKey({ ...sprint, gateCount: 12 })).toBe(worldKey({ ...sprint, gateCount: 30 }));
    expect(worldKey({ ...sprint, laps: 1 })).toBe(worldKey({ ...sprint, laps: 9 }));
    expect(worldKey({ ...BASE, gateCount: 18 })).toBe(worldKey({ ...BASE, gateCount: 40 }));
  });
});

describe('WorldPreview', () => {
  it('starts out showing the track already on screen', () => {
    const r = rig();
    expect(r.preview.current()).toMatchObject({ status: 'ready', track: r.world.track });
  });

  it('ignores settings that do not shape the world, and everything once flying', () => {
    const r = rig();
    r.settings = { ...BASE, gateCount: 9 };
    r.preview.settingsChanged(['fov', 'windSpeed']);
    r.advance(5000);
    expect(r.calls).toEqual([]);
    r.locked = true;
    r.preview.settingsChanged(['gateCount']);
    r.advance(5000);
    expect(r.calls).toEqual([]);
  });

  it('builds once after a burst of changes (debounce) and only the track when the terrain stays', async () => {
    const r = rig();
    for (const gates of [9, 10, 11]) {
      r.settings = { ...BASE, gateCount: gates };
      r.preview.settingsChanged(['gateCount']);
      r.advance(PREVIEW_DEBOUNCE_MS - 50);
    }
    expect(r.calls).toEqual([]);
    expect(r.states.at(-1)?.status).toBe('working');
    r.advance(100);
    await r.flush();
    expect(r.calls).toEqual(['track:1337:race:11', 'apply:1337']);
    expect(r.states.at(-1)).toMatchObject({ status: 'ready', track: r.world.track });
    expect(r.world.track.gates).toHaveLength(11);
  });

  it('rebuilds the terrain for a new seed or quality, reports progress and keeps the old map meanwhile', async () => {
    const r = rig();
    const old = r.world.track;
    r.settings = { ...BASE, seed: 42 };
    r.preview.settingsChanged(['seed']);
    r.advance(PREVIEW_DEBOUNCE_MS);
    await r.flush();
    expect(r.calls).toEqual(['world:42']);
    const working = r.states.at(-1)!;
    expect(working).toMatchObject({ status: 'working', stage: 'Generating terrain', progress: 0.4, track: old });
    r.gate.release!();
    await r.flush();
    expect(r.calls).toEqual(['world:42', 'apply:42']);
    expect(r.states.at(-1)).toMatchObject({ status: 'ready' });
    expect(r.world.baseSeed).toBe(42);
    r.settings = { ...r.settings, quality: 'low' };
    r.preview.settingsChanged(['quality']);
    r.advance(PREVIEW_DEBOUNCE_MS);
    await r.flush();
    expect(r.calls.filter((c) => c === 'world:42')).toHaveLength(2);
  });

  it('drops a result that a newer change has made stale and builds the newer one', async () => {
    const r = rig();
    r.settings = { ...BASE, seed: 7 };
    r.preview.settingsChanged(['seed']);
    r.advance(PREVIEW_DEBOUNCE_MS);
    await r.flush();
    r.settings = { ...BASE, seed: 8 };
    r.preview.settingsChanged(['seed']);
    r.advance(PREVIEW_DEBOUNCE_MS);
    r.gate.release!();
    await r.flush();
    expect(r.calls).toEqual(['world:7', 'world:8', 'apply:8']);
    expect(r.world.baseSeed).toBe(8);
  });

  it('shows the problem and keeps the old world when a build fails, and recovers on the next change', async () => {
    const r = rig();
    r.failNext = 'no valid layout';
    r.settings = { ...BASE, gateCount: 30 };
    r.preview.settingsChanged(['gateCount']);
    r.advance(PREVIEW_DEBOUNCE_MS);
    await r.flush();
    expect(r.states.at(-1)).toMatchObject({ status: 'error', message: 'Could not build that world: no valid layout' });
    expect(r.world.track.gates).toHaveLength(3);
    r.failNext = null;
    r.settings = { ...BASE, gateCount: 14 };
    r.preview.settingsChanged(['gateCount']);
    r.advance(PREVIEW_DEBOUNCE_MS);
    await r.flush();
    expect(r.states.at(-1)?.status).toBe('ready');
    expect(r.world.track.gates).toHaveLength(14);
  });

  it('goes back to ready without building when the settings return to what is on screen', async () => {
    const r = rig();
    r.settings = { ...BASE, laps: 5 };
    r.preview.settingsChanged(['laps']);
    r.advance(100);
    r.settings = { ...BASE };
    r.preview.settingsChanged(['laps']);
    r.advance(5000);
    await r.flush();
    expect(r.calls).toEqual([]);
    expect(r.states.at(-1)?.status).toBe('ready');
  });

  it('retries while the app is busy and lands the world once it can', async () => {
    const r = rig();
    r.applyOk = false;
    r.settings = { ...BASE, difficulty: 0.8 };
    r.preview.settingsChanged(['difficulty']);
    r.advance(PREVIEW_DEBOUNCE_MS);
    await r.flush();
    expect(r.calls).toEqual(['track:1337:race:12', 'apply:1337']);
    r.advance(600);
    expect(r.calls.filter((c) => c.startsWith('apply'))).toHaveLength(2);
    r.applyOk = true;
    r.advance(600);
    expect(r.calls.filter((c) => c.startsWith('apply'))).toHaveLength(3);
    expect(r.states.at(-1)?.status).toBe('ready');
  });
});
