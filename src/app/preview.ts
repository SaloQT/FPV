/**
 * Live track preview of the start screen. When the seed, style, length, laps, difficulty or quality change before the first
 * flight, the world for those settings is built in the background (terrain in a worker, the track in one slice after a yield)
 * and put on screen when it is done; the menu shows the map of what is on screen and how far the next one is. Pure logic over
 * injected builders so it can be tested without a GPU.
 */
import type { AppSettings } from '../ui/settingsSchema';
import { effectiveGates, effectiveLaps } from '../ui/trackLimits';
import { idlePreview, type PreviewState } from '../ui/trackPreviewModel';
import type { ProgressFn } from '../contracts';
import type { ShareWorld } from '../ui/seedModel';
import type { World, WorldRequest } from './world';

/** Settings that decide what world is built. */
export const WORLD_KEYS: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>(['seed', 'trackStyle', 'gateCount', 'laps', 'difficulty', 'quality']);

/** Quiet time after the last change before a build starts, so dragging a slider or typing a seed builds once. */
export const PREVIEW_DEBOUNCE_MS = 350;
const RETRY_MS = 500;

export type WorldSettings = Pick<AppSettings, 'seed' | 'trackStyle' | 'gateCount' | 'laps' | 'difficulty' | 'quality'> & {
  /** The track's own seed when it is not `seed` (a link to an N-key track); the terrain is always `seed`'s. */
  trackSeed?: number;
};

/** Identifies the world a set of settings builds: a count or lap setting the style ignores does not make another world. */
export function worldKey(s: WorldSettings): string {
  return [s.seed, s.trackStyle, effectiveGates(s.trackStyle, s.gateCount), effectiveLaps(s.trackStyle, s.laps), s.difficulty.toFixed(3), s.quality, s.trackSeed ?? ''].join('|');
}

/**
 * The world a share link describes, or null while the start screen is still building the one its settings ask for (the link then
 * follows the settings). From the first flight on it is always the world on screen: the settings can be edited without rebuilding.
 * A track-builder track is described by its recipe. A track loaded from a file (no recipe, no generator call: `attempts` 0) has
 * nothing a link could rebuild it from, so it gives null too.
 */
export function shareableWorld(world: World, preview: PreviewState['status'], started: boolean): ShareWorld | null {
  const s = worldLink(world, preview, started);
  return s === null || s === false ? null : s;
}

/**
 * Like `shareableWorld`, but tells the two kinds of "no link" apart: null while the start screen is still building the settings'
 * world (a link then follows the settings), false when the world on screen is a track from a file that no link can rebuild.
 */
export function worldLink(world: World, preview: PreviewState['status'], started: boolean): ShareWorld | null | false {
  if (!started && (preview === 'working' || preview === 'error')) return null;
  const r = world.request;
  const recipe = world.track.recipe;
  if (recipe === undefined && world.attempts === 0) return false;
  const share: ShareWorld = { terrainSeed: world.terrainSeed, trackSeed: r.seed, style: r.style, gateCount: r.gateCount, laps: r.laps, difficulty: r.difficulty, quality: world.quality };
  if (recipe !== undefined) share.recipe = recipe;
  return share;
}

export interface PreviewDeps {
  settings(): WorldSettings;
  /** The world on screen. */
  world(): World;
  /** The first flight has started: from then on only the explicit new-track actions rebuild. */
  locked(): boolean;
  /** Same terrain, new track (seed, style, length ...); resolves after yielding to the event loop. */
  buildTrack(current: World, s: WorldSettings): Promise<World>;
  /** New terrain and track, reporting progress as 0..1 of the whole build. */
  buildWorld(s: WorldSettings & Pick<WorldRequest, 'quality'>, progress: ProgressFn): Promise<World>;
  /** Puts the world on screen; false when the app is busy with something else and wants it later. */
  apply(world: World): boolean;
  emit(state: PreviewState): void;
  after(ms: number, fn: () => void): number;
  cancel(handle: number): void;
}

export class WorldPreview {
  private builtKey: string;
  private token = 0;
  private timer = -1;
  private state: PreviewState;
  private trackSeed: number | undefined;
  /** Someone else owns the world on screen (`hold` until `resume`): settings changes wait. */
  private holding = false;
  /** A build was dropped, or a settings change waited, while held: `resume` runs it. */
  private dropped = false;
  /** Builds run one after another: a terrain worker cannot be cancelled, so a newer request waits for it instead of piling on. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PreviewDeps, built: WorldSettings) {
    this.builtKey = worldKey(built);
    this.state = idlePreview(deps.world().track);
  }

  current(): PreviewState {
    return this.state;
  }

  /** Call for every settings change; only the keys that decide the world start a build. */
  settingsChanged(changed: readonly (keyof AppSettings)[]): void {
    if (this.deps.locked() || !changed.some((k) => WORLD_KEYS.has(k))) return;
    this.trackSeed = undefined;
    if (this.holding) {
      this.dropped = true;
      return;
    }
    this.schedule();
  }

  /**
   * Someone else put `world` on screen (the track builder): a pending build is dropped and the map shows it. A later change of a
   * world setting before the first flight builds the settings' world again.
   */
  adopt(world: World): void {
    this.token++;
    this.cancelTimer();
    this.dropped = false;
    this.trackSeed = undefined;
    // The world on screen is no longer the one any settings build, so the next world-setting change always rebuilds.
    this.builtKey = '';
    this.publish(idlePreview(world.track));
  }

  /**
   * Someone else takes over the world on screen for a while (the track builder opened): a pending or running build is dropped so
   * it cannot swap the world underneath. `resume` builds it again if nothing else was put on screen in between.
   */
  hold(): void {
    this.holding = true;
    const busy = this.state.status === 'working' || this.state.status === 'error';
    this.dropped = this.dropped || busy;
    this.token++;
    this.cancelTimer();
    if (busy) this.publish(idlePreview(this.deps.world().track));
  }

  /**
   * The takeover ended. When nothing was put on screen in between (`adopt`), a build `hold` dropped, or a settings change that
   * waited, runs now for the current settings.
   */
  resume(): void {
    if (!this.holding) return;
    this.holding = false;
    const again = this.dropped;
    this.dropped = false;
    if (again && !this.deps.locked()) this.schedule();
  }

  /** The page was opened from a share link whose track is not the one the world seed builds first: build that track on the same terrain. */
  launch(trackSeed: number): void {
    if (this.deps.locked()) return;
    this.trackSeed = trackSeed;
    if (this.holding) {
      this.dropped = true;
      return;
    }
    this.schedule();
  }

  private settings(): WorldSettings {
    return this.trackSeed === undefined ? this.deps.settings() : { ...this.deps.settings(), trackSeed: this.trackSeed };
  }

  private schedule(): void {
    const s = this.settings();
    this.token++;
    this.cancelTimer();
    if (worldKey(s) === this.builtKey) {
      this.publish(idlePreview(this.deps.world().track));
      return;
    }
    this.publish({ status: 'working', stage: 'Waiting for the last change', progress: 0, track: this.deps.world().track, message: '' });
    this.timer = this.deps.after(PREVIEW_DEBOUNCE_MS, () => {
      this.timer = -1;
      const token = this.token;
      this.chain = this.chain.then(() => this.run(token));
    });
  }

  private async run(token: number): Promise<void> {
    if (token !== this.token) return;
    if (this.deps.locked()) {
      this.publish(idlePreview(this.deps.world().track));
      return;
    }
    const s = this.settings();
    const key = worldKey(s);
    const current = this.deps.world();
    const sameTerrain = s.seed === current.baseSeed && s.quality === current.quality;
    const old = current.track;
    const progress = (stage: string, f: number): void => {
      if (token === this.token) this.publish({ status: 'working', stage, progress: Math.min(Math.max(f, 0), 1), track: old, message: '' });
    };
    try {
      let world: World;
      if (sameTerrain) {
        progress('Placing track', 0.5);
        world = await this.deps.buildTrack(current, s);
      } else {
        progress('Generating terrain', 0);
        world = await this.deps.buildWorld(s, progress);
      }
      if (token !== this.token) return;
      this.land(world, key, token);
    } catch (e) {
      if (token !== this.token) return;
      this.publish({ status: 'error', stage: '', progress: 0, track: old, message: `Could not build that world: ${(e as Error).message}` });
    }
  }

  private land(world: World, key: string, token: number): void {
    if (!this.deps.apply(world)) {
      this.timer = this.deps.after(RETRY_MS, () => {
        this.timer = -1;
        if (token === this.token) this.land(world, key, token);
      });
      return;
    }
    this.builtKey = key;
    this.publish(idlePreview(world.track));
  }

  private publish(state: PreviewState): void {
    this.state = state;
    this.deps.emit(state);
  }

  private cancelTimer(): void {
    if (this.timer >= 0) this.deps.cancel(this.timer);
    this.timer = -1;
  }
}
