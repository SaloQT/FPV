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
import type { World, WorldRequest } from './world';

/** Settings that decide what world is built. */
export const WORLD_KEYS: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>(['seed', 'trackStyle', 'gateCount', 'laps', 'difficulty', 'quality']);

/** Quiet time after the last change before a build starts, so dragging a slider or typing a seed builds once. */
export const PREVIEW_DEBOUNCE_MS = 350;
const RETRY_MS = 500;

export type WorldSettings = Pick<AppSettings, 'seed' | 'trackStyle' | 'gateCount' | 'laps' | 'difficulty' | 'quality'>;

/** Identifies the world a set of settings builds: a count or lap setting the style ignores does not make another world. */
export function worldKey(s: WorldSettings): string {
  return [s.seed, s.trackStyle, effectiveGates(s.trackStyle, s.gateCount), effectiveLaps(s.trackStyle, s.laps), s.difficulty.toFixed(3), s.quality].join('|');
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
    const s = this.deps.settings();
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
    const s = this.deps.settings();
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
