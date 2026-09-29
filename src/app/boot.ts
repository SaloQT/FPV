/**
 * App entry: builds the renderer and the first world side by side, wires every subsystem to the shared `AppCtx`, warms
 * the renderer up and starts the real-time loop. `main.ts` calls the default export once.
 */
import { CameraRig } from '../game/cameraRig';
import { GameSession } from '../game/session';
import { createSessionSnapshot } from '../game/sessionTypes';
import { InputManager } from '../input/inputManager';
import { createAtmosphereModule } from '../render/atmosphere';
import { createObjectsModule } from '../render/objects';
import { createPostProcessor } from '../render/post';
import { Renderer } from '../render/renderer';
import { createRTModule } from '../render/rt';
import { createTerrainModule } from '../render/terrain';
import { createVegetationModule } from '../render/vegetation';
import { getPreset } from '../sim/presets';
import { QuadPhysics } from '../sim/quad';
import { LoadingOverlay } from '../ui/loading';
import { newPerfSample } from '../ui/perfModel';
import { SETTINGS_KEY } from '../ui/settingsSchema';
import { SettingsStore, type StorageLike } from '../ui/settingsStore';
import { SimClock as AstroClock } from '../world/astro';
import { menuAction, startAudioOnGesture, wireSession, wireSettings } from './actions';
import { AppAudio } from './audio';
import { SETTLE_RENDERS, makePerfSource } from './frame';
import { createLoop, attachResize } from './loop';
import { PadGround } from './padGround';
import { hasPersistentOverrides, parseParams, settingsPatch } from './params';
import { ScenarioPilot } from './scenario';
import { fail, loadWorld, trackRequest, worldDeps } from './scene';
import { reportError, type AppCtx, type AppMods } from './state';
import { advanceFrames, installHooks, markReady } from './testHooks';
import { createUi, showMessage } from './ui';
import { WindModel } from './wind';
import { buildWorld, type World } from './world';

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

function createStore(search: string): { store: SettingsStore; params: ReturnType<typeof parseParams> } {
  const params = parseParams(search);
  const saved = new SettingsStore();
  const patch = settingsPatch(params, saved.get());
  const store = hasPersistentOverrides(patch) ? new SettingsStore(memoryCopyOfSaved()) : saved;
  store.patch(patch);
  return { store, params };
}

export default async function boot(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const root = document.getElementById('ui') ?? document.body;
  if (!('gpu' in navigator) || !navigator.gpu) {
    showMessage(root, 'WebGPU is not available', 'This simulator needs a browser with WebGPU (Chrome or Edge 113+, Safari 18+, or Firefox with WebGPU enabled) and a supported graphics card.');
    reportError('WebGPU is not available in this browser (navigator.gpu is missing)');
    return;
  }
  const loading = new LoadingOverlay(root);
  loading.setProgress('Starting', 0);
  let ctx: AppCtx | null = null;
  try {
    ctx = await start(canvas, osdCanvas, root, loading);
  } catch (e) {
    loading.hide();
    if (ctx) fail(ctx, 'The simulator could not start', e);
    else {
      reportError(`The simulator could not start: ${(e as Error)?.message ?? e}`);
      if (e instanceof Error && e.stack) console.error(e.stack);
      showMessage(root, 'The simulator could not start', String((e as Error)?.message ?? e));
    }
    return;
  }
  loading.hide();
  markReady(ctx);
  if (!ctx.params.hold) createLoop(ctx).start();
}

async function start(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement, root: HTMLElement, loading: LoadingOverlay): Promise<AppCtx> {
  const { store, params } = createStore(location.search);
  const settings = store.get();

  const mods: AppMods = { atmosphere: createAtmosphereModule(), objects: createObjectsModule(), vegetation: createVegetationModule() };
  const modules = [mods.atmosphere, createTerrainModule(), mods.vegetation, mods.objects, createRTModule()];

  // The GPU device and the terrain/track both take a while and do not depend on each other.
  let deviceDone = 0;
  let worldFrac = 0;
  const bar = (stage: string): void => loading.setProgress(stage, BAR_START + BAR_DEVICE * deviceDone + BAR_WORLD * worldFrac);
  bar('Starting the GPU');
  const rendererP = Renderer.create(canvas, settings, modules, createPostProcessor()).then((r) => {
    deviceDone = 1;
    bar('GPU ready');
    return r;
  });
  const worldP = buildWorld({ ...trackRequest(settings), quality: settings.quality }, worldDeps, (stage, f) => {
    worldFrac = f;
    bar(stage);
  });
  // If one side fails the other must not become an unhandled rejection.
  const [renderer, world] = await Promise.all([rendererP, worldP]).catch(async (e) => {
    await Promise.allSettled([rendererP, worldP]);
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

  if (params.autostart) {
    ctx.session.closeMenu();
    ctx.ui.menu.hide();
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
  const ui = createUi(p.root, p.osdCanvas, settings, input.gamepad, {
    onChange: (patch) => store.patch(patch),
    onAction: (action) => {
      if (self) menuAction(self, action);
    },
    perfSource: makePerfSource(() => self),
  });

  const aspect = canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 16 / 9;
  const ctx: AppCtx = {
    params, canvas, root: p.root, store, renderer: p.renderer, mods: p.mods, physics, ground, wind, input, session, rig, astro, audio, ui,
    loading: p.loading,
    world, busy: false, hidden: document.hidden, camPreferred: params.cam ?? 'fpv', aspect, time: 0,
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
