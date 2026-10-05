/**
 * App entry: builds the renderer and the first world side by side, wires every subsystem to the shared `AppCtx`, warms
 * the renderer up and starts the real-time loop. `main.ts` calls the default export once.
 */
import { CameraRig } from '../game/cameraRig';
import { GameSession } from '../game/session';
import { createSessionSnapshot } from '../game/sessionTypes';
import { InputManager } from '../input/inputManager';
import { createPostProcessor } from '../render/post';
import { Renderer } from '../render/renderer';
import { rateProfileOf } from '../sim/fc/ratePresets';
import { getPreset } from '../sim/presets';
import { QuadPhysics } from '../sim/quad';
import { classifyStartupError } from '../ui/errorMessages';
import { LoadingOverlay } from '../ui/loading';
import { newPerfSample } from '../ui/perfModel';
import { defaultAppSettings, SETTINGS_KEY, type AppSettings } from '../ui/settingsSchema';
import { SettingsStore, type StorageLike } from '../ui/settingsStore';
import { SimClock as AstroClock } from '../world/astro';
import { menuAction, startAudioOnGesture, wireSession, wireSettings } from './actions';
import { AppAudio } from './audio';
import { BrainHub } from './brains';
import { BuilderHub } from './builder';
import { startBench } from './bench';
import { failApp, installGlobalErrorHandlers } from './failure';
import { SETTLE_RENDERS, makePerfSource } from './frame';
import { createLoop, attachResize } from './loop';
import { PadGround } from './padGround';
import { hasPersistentOverrides, parseParams, settingsPatch, type AppParams } from './params';
import { benchSettingsPatch, parsePerfParams, perfSettingsPatch, withBench, type PerfParams } from './perfParams';
import { createAppModules, installRecovery } from './recover';
import { measureRefresh } from './refresh';
import { ScenarioPilot } from './scenario';
import { loadWorld, recipeRequest, trackRequest, worldDeps } from './scene';
import type { AppCtx, AppMods } from './state';
import { advanceFrames, installHooks, markReady } from './testHooks';
import { createUi } from './ui';
import { WindModel } from './wind';
import { buildWorld, type World, type WorldRequest } from './world';

/** Share of the loading bar: GPU device, then the world (terrain 0.9, track), then the scene upload and warm-up. */
const BAR_DEVICE = 0.4;
const BAR_WORLD = 0.5;
const BAR_START = 0.05;

/**
 * URL overrides must not overwrite the pilot's saved settings: the store works on an in-memory copy of what is saved,
 * so the page still starts from the pilot's choices but never writes back.
 */
function memoryCopyOfSaved(): StorageLike {
  const data = new Map<string, string>();
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved !== null) data.set(SETTINGS_KEY, saved);
  } catch (e) {
    console.error('settings: storage is not readable', e);
  }
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/**
 * The first world: the terrain of `seed`, and the track of `tseed` when the URL names one (a share link to an N-key track), also with
 * `autostart=1`. A track-builder link (`trk=`) builds its recipe on that terrain instead.
 */
export function initialWorldRequest(settings: AppSettings, params: Pick<AppParams, 'trackSeed' | 'recipe'>): WorldRequest {
  const track = params.recipe !== undefined ? recipeRequest(params.recipe) : trackRequest(settings, params.trackSeed);
  return { ...track, terrainSeed: settings.seed, quality: settings.quality };
}

function createStore(search: string, perf: PerfParams): { store: SettingsStore; params: ReturnType<typeof parseParams> } {
  const params = withBench(parseParams(search), perf);
  const saved = new SettingsStore();
  const patch = { ...settingsPatch(params, saved.get()), ...perfSettingsPatch(perf) };
  if (perf.bench) Object.assign(patch, benchSettingsPatch(params, perf, saved.get(), defaultAppSettings()));
  const store = hasPersistentOverrides(patch) ? new SettingsStore(memoryCopyOfSaved()) : saved;
  store.patch(patch);
  return { store, params };
}

export default async function boot(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const root = document.getElementById('ui') ?? document.body;
  installGlobalErrorHandlers(root);
  const loading = new LoadingOverlay(root);
  loading.setProgress('Starting', 0);
  const perf = parsePerfParams(location.search);
  let ctx: AppCtx;
  try {
    ctx = await start(canvas, osdCanvas, root, loading, perf);
  } catch (e) {
    loading.hide();
    failApp(root, classifyStartupError(e), e);
    return;
  }
  loading.hide();
  markReady(ctx);
  const loop = createLoop(ctx);
  installRecovery(ctx, loop);
  if (ctx.params.hold) return; // frozen frame for tools; a lost device still shows the panel, and Recover starts the loop
  if (perf.bench) void startBench(ctx, loop, perf);
  loop.start();
}

/** The refresh rate of the display: from `?refresh=`, else measured over ~60 idle frames before the heavy startup work begins. */
async function displayRefresh(perf: PerfParams, loading: LoadingOverlay): Promise<{ hz: number; source: 'override' | 'measured' | 'fallback' }> {
  if (perf.refresh !== undefined) return { hz: perf.refresh, source: 'override' };
  loading.setProgress('Measuring the display', 0.02);
  const m = await measureRefresh();
  if (m.source === 'fallback') console.warn('display refresh could not be measured (hidden tab or throttled frames): assuming 60 Hz');
  return m;
}

async function start(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement, root: HTMLElement, loading: LoadingOverlay, perf: PerfParams): Promise<AppCtx> {
  const { store, params } = createStore(location.search, perf);
  const settings = store.get();
  const refreshHz = await displayRefresh(perf, loading);

  const { mods, list: modules } = createAppModules();

  // The GPU device and the terrain/track both take a while and do not depend on each other.
  let deviceDone = 0;
  let worldFrac = 0;
  const bar = (stage: string): void => loading.setProgress(stage, BAR_START + BAR_DEVICE * deviceDone + BAR_WORLD * worldFrac);
  bar('Starting the GPU');
  const rendererP = Renderer.create(canvas, settings, modules, createPostProcessor(), { gpuProfile: perf.gpuProfile }).then((r) => {
    r.setDisplayRefresh(refreshHz.hz, refreshHz.source);
    deviceDone = 1;
    bar('GPU ready');
    return r;
  });
  const worldP = buildWorld(initialWorldRequest(settings, params), worldDeps, (stage, f) => {
    worldFrac = f;
    bar(stage);
  });
  // The first failure shows at once (a missing GPU must not wait for the terrain to finish); the other side is abandoned: its outcome
  // is swallowed and a renderer that still got built is released.
  const [renderer, world] = await Promise.all([rendererP, worldP]).catch((e) => {
    void rendererP.then((r) => r.destroy(), () => undefined);
    worldP.catch(() => undefined);
    throw e;
  });

  loading.setProgress('Setting up the sim', 0.92);
  const ctx = assemble({ canvas, osdCanvas, root, loading, store, params, renderer, mods, world });
  attachResize(ctx);
  wireSession(ctx);
  wireSettings(ctx);
  startAudioOnGesture(ctx);

  loading.setProgress('Uploading the scene', 0.94);
  loadWorld(ctx, world);
  installHooks(ctx);
  void ctx.brains.init(location.search);

  if (params.autostart) {
    ctx.session.closeMenu();
    ctx.ui.menu.hide();
  } else if (params.mode === 'builder') {
    ctx.builder.open();
  } else {
    ctx.ui.menu.showStart();
  }

  loading.setProgress('Warming up', 0.97);
  await advanceFrames(ctx, Math.max(params.advance, SETTLE_RENDERS));
  return ctx;
}

interface Parts {
  canvas: HTMLCanvasElement;
  osdCanvas: HTMLCanvasElement;
  root: HTMLElement;
  loading: LoadingOverlay;
  store: SettingsStore;
  params: ReturnType<typeof parseParams>;
  renderer: Renderer;
  mods: AppMods;
  world: World;
}

/** Creates the sim objects and the shared context. Nothing here touches the GPU. */
function assemble(p: Parts): AppCtx {
  const { canvas, store, params, world } = p;
  const settings = store.get();
  const physics = new QuadPhysics(getPreset(settings.quadPreset), world.sampler, settings.seed);
  physics.fc.setRates(rateProfileOf(settings.rates));
  physics.setAtmosphere(settings.observer.altitudeM, 15);
  const ground = new PadGround(world.sampler, null);
  const wind = new WindModel(settings.seed);
  const input = new InputManager(window, canvas, store);
  const snap = createSessionSnapshot();

  let session!: GameSession;
  const pilot = params.scenario
    ? new ScenarioPilot(input, params.scenario, {
        quad: () => physics.state,
        state: () => session.state,
        track: () => session.raceTrack,
        nextGate: () => snap.race.nextGate,
        groundHeightAt: ground.groundHeightAt,
        hoverAgl: params.agl,
      })
    : input;
  session = new GameSession({
    physics,
    input: pilot,
    track: null,
    settings: { physicsHz: settings.physicsHz, autoRespawn: settings.autoRespawn, timeMs: settings.timeMs, timeScale: settings.timeScale },
    groundHeightAt: ground.groundHeightAt,
  });
  const rig = new CameraRig(ground.groundHeightAt);
  rig.mode = params.cam ?? 'fpv';
  const astro = new AstroClock({ timeMs: settings.timeMs, timeScale: settings.timeScale, observer: settings.observer });
  const audio = new AppAudio(settings);

  let self: AppCtx | null = null;
  const brains = new BrainHub(() => self);
  const builder = new BuilderHub(() => self);
  const ui = createUi(p.root, p.osdCanvas, settings, input.gamepad, {
    onChange: (patch) => store.patch(patch),
    onAction: (action) => {
      if (self) menuAction(self, action);
    },
    perfSource: makePerfSource(() => self),
    brains,
    builder,
  });

  const aspect = canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 16 / 9;
  const ctx: AppCtx = {
    params, canvas, root: p.root, store, renderer: p.renderer, mods: p.mods, physics, ground, wind, input, session, rig, astro, audio, ui, brains, builder,
    loading: p.loading, colliders: [],
    world, preview: null, busy: false, hidden: document.hidden, camPreferred: params.cam ?? 'fpv', aspect, time: 0,
    frame: { dt: 0, time: 0, camera: rig.camera, astro: astro.state(), quad: null },
    snap,
    orbit: { dx: 0, dy: 0, wheel: 0 },
    camSettings: { fov: settings.fov, cameraTiltDeg: settings.cameraTiltDeg, camVibration: settings.camVibration },
    audioCtx: { speed: 0, agl: 0, dt: 0, cameraMode: 'fpv', windSpeed: 0 },
    perfSample: newPerfSample(),
    last: { hide: null, gate: -1, windSince: 0, windSpeed: NaN, windX: NaN, windZ: NaN, frameMs: 0, wall: 0, fpvFx: true },
  };
  self = ctx;
  return ctx;
}
