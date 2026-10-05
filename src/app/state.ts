/**
 * The app's shared state: one object handed to the frame, scene, action and test-hook modules so none of them reach for
 * globals. Everything allocated per frame lives here once (reused frame input, snapshot, orbit delta, scratch contexts).
 */
import type { AudioUpdateContext } from '../audio';
import type { ObstacleCollider } from '../contracts';
import type { CameraMode, CameraRig, CameraSettings } from '../game/cameraRig';
import type { GameSession } from '../game/session';
import type { SessionSnapshot } from '../game/sessionTypes';
import type { InputManager } from '../input/inputManager';
import type { OrbitDelta } from '../input/pointer';
import type { AtmosphereModule } from '../render/atmosphere';
import type { ObjectsModule } from '../render/objects';
import type { FrameInput, Renderer } from '../render/renderer';
import type { VegetationModule } from '../render/vegetation';
import type { QuadPhysics } from '../sim/quad';
import type { LoadingOverlay } from '../ui/loading';
import type { PerfSample } from '../ui/perfModel';
import type { AppSettings } from '../ui/settingsSchema';
import type { SettingsStore } from '../ui/settingsStore';
import type { SimClock as AstroClock } from '../world/astro';
import type { AppAudio } from './audio';
import type { BrainHub } from './brains';
import type { BuilderHub } from './builder';
import type { AppParams } from './params';
import type { PadGround } from './padGround';
import type { WorldPreview } from './preview';
import type { AppUi } from './ui';
import type { WindModel } from './wind';
import type { World } from './world';

export interface AppMods {
  atmosphere: AtmosphereModule;
  objects: ObjectsModule;
  vegetation: VegetationModule;
}

export interface AppCtx {
  readonly params: AppParams;
  readonly canvas: HTMLCanvasElement;
  readonly root: HTMLElement;
  readonly store: SettingsStore;
  readonly renderer: Renderer;
  readonly mods: AppMods;
  readonly physics: QuadPhysics;
  readonly ground: PadGround;
  readonly wind: WindModel;
  readonly input: InputManager;
  readonly session: GameSession;
  readonly rig: CameraRig;
  readonly astro: AstroClock;
  readonly audio: AppAudio;
  readonly ui: AppUi;
  readonly loading: LoadingOverlay;
  /** Trained brains: flying the player's quad and the spectator race. */
  readonly brains: BrainHub;
  /** The track builder mode: recipe, builds, its camera, saved tracks and the per-track leaderboards. */
  readonly builder: BuilderHub;

  /** The world on screen; replaced by `scene.ts` when a new track or terrain is built. */
  world: World;
  /** The start screen's live preview (set by wireSettings); the builder hands it the worlds it puts on screen. */
  preview: WorldPreview | null;
  /** What the quad can hit (track boxes, trees, rocks); `refreshColliders` replaces it. */
  colliders: ObstacleCollider[];
  /** A rebuild is running: the frame loop idles until it is done. */
  busy: boolean;
  /** The tab is hidden: the loop idles. */
  hidden: boolean;
  /** Camera the pilot picked (query param or C key); the start screen overrides it with an orbit shot. */
  camPreferred: CameraMode;
  /** Canvas aspect ratio, kept up to date by the resize handler. */
  aspect: number;
  /** Seconds of app time (sum of frame dts) for shaders that animate. */
  time: number;

  // Per-frame scratch, reused so a frame allocates nothing.
  readonly frame: FrameInput;
  readonly snap: SessionSnapshot;
  readonly orbit: OrbitDelta;
  readonly camSettings: CameraSettings;
  readonly audioCtx: AudioUpdateContext;
  readonly perfSample: PerfSample;
  /** Change detection so the module setters are only called when something moved. */
  readonly last: { hide: boolean | null; gate: number; windSince: number; windSpeed: number; windX: number; windZ: number; frameMs: number; wall: number; fpvFx: boolean };
}

/** Lens distortion and video noise are the FPV camera's picture; the chase and free cameras render without them. */
export function renderSettings(s: AppSettings, mode: CameraMode): AppSettings {
  return mode === 'fpv' || (s.lensDistortion === 0 && s.videoNoise === 0) ? s : { ...s, lensDistortion: 0, videoNoise: 0 };
}

/** Publishes a fatal problem where tests and the shot tool can see it. */
export function reportError(message: string): void {
  console.error(message);
  const hook = (window as unknown as { __fpv?: { error?: string } }).__fpv;
  if (hook && hook.error === undefined) hook.error = message;
}
