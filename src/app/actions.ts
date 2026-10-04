/**
 * Glue between the session, the menu, the settings store and the rest of the app: what happens on a state change, a gate
 * event, an input action, a menu button and a changed setting.
 */
import type { AppSettings } from '../ui/settingsSchema';
import type { MenuAction } from '../ui/menuSchema';
import { CAMERA_MODES } from '../game/cameraRig';
import { rateProfileOf } from '../sim/fc/ratePresets';
import { applyBootTime, createPreview, onStateChange, onTimeNudged, restartRun, wireFlow } from './flow';
import { applyWind, newTrack, newWorld, refreshColliders } from './scene';
import { renderSettings, type AppCtx } from './state';

/** Settings that change what the renderer draws; anything else does not need `Renderer.setSettings`. */
const RENDER_KEYS: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>([
  'quality', 'performance240', 'targetFps', 'frameCap', 'dynamicResolution', 'renderScale', 'fov', 'cameraTiltDeg', 'lensDistortion', 'videoNoise', 'observer', 'mode',
]);
const SESSION_KEYS: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>(['physicsHz', 'autoRespawn', 'timeMs', 'timeScale']);
const VOLUME_KEYS: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>(['masterVolume', 'motorVolume', 'windVolume']);
const WIND_KEYS: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>(['windSpeed', 'windDirDeg']);

const any = (changed: readonly (keyof AppSettings)[], set: ReadonlySet<keyof AppSettings>): boolean => changed.some((k) => set.has(k));

/** Session hooks: state changes drive the menu, gate events drive the gate lights and beeps, the rest of the actions are ours. */
export function wireSession(ctx: AppCtx): void {
  const { session, ui, audio, mods } = ctx;
  session.onStateChange = (state, prev) => {
    if (state === 'menu') {
      if (session.started) ui.menu.showSettings();
      else ui.menu.showStart();
    } else if (prev === 'menu') {
      ui.menu.hide();
    }
    if ((prev === 'crashed' || prev === 'finished') && (state === 'ready' || state === 'flying')) audio.reset();
    onStateChange(ctx, state, prev);
  };
  session.onGate = (event, gate) => {
    if (event === 'missed' || event === 'none') return;
    mods.objects.setGatePassed(gate);
    if (event === 'gate') audio.gatePass();
    else if (event === 'lap') audio.lap();
    else audio.finished();
  };
  session.onAction = (action) => {
    switch (action) {
      case 'camera-cycle':
        ctx.camPreferred = CAMERA_MODES[(CAMERA_MODES.indexOf(ctx.camPreferred) + 1) % CAMERA_MODES.length];
        break;
      case 'toggle-help':
        ui.help.toggle();
        break;
      case 'toggle-perf':
        ui.perf.toggle();
        break;
      case 'new-track':
        if (session.state !== 'menu') void newTrack(ctx);
        break;
      case 'respawn':
      case 'reset-track':
        audio.reset();
        break;
      case 'time-forward':
      case 'time-back':
        onTimeNudged(ctx);
        break;
      default:
        break;
    }
  };
  wireFlow(ctx);
}

/** Everything that follows a setting live. Only the keys that changed are looked at. */
export function wireSettings(ctx: AppCtx): () => void {
  const preview = createPreview(ctx);
  const off = ctx.store.subscribe((s, changed) => {
    ctx.ui.menu.setSettings(s);
    preview.settingsChanged(changed);
    if (any(changed, RENDER_KEYS)) ctx.renderer.setSettings(renderSettings(s, ctx.rig.mode));
    if (any(changed, SESSION_KEYS)) {
      ctx.session.applySettings({
        physicsHz: s.physicsHz, autoRespawn: s.autoRespawn, timeScale: s.timeScale,
        ...(changed.includes('timeMs') ? { timeMs: s.timeMs } : {}),
      });
    }
    if (changed.includes('observer')) {
      ctx.astro.setObserver(s.observer);
      ctx.physics.setAtmosphere(s.observer.altitudeM, 15);
    }
    if (any(changed, VOLUME_KEYS)) ctx.audio.setVolumes(s);
    if (any(changed, WIND_KEYS)) {
      applyWind(ctx);
      refreshColliders(ctx);
    }
    if (changed.includes('rates')) ctx.physics.fc.setRates(rateProfileOf(s.rates));
  });
  applyBootTime(ctx);
  return off;
}

/** The menu's buttons. `start` and `resume` run inside a click, so the pointer lock request is legal here. */
export function menuAction(ctx: AppCtx, action: MenuAction): void {
  const { session, ui, input, audio } = ctx;
  switch (action) {
    case 'start':
    case 'resume':
      audio.start();
      session.closeMenu();
      ui.menu.hide();
      input.requestPointerLock();
      break;
    case 'restart':
      restartRun(ctx);
      break;
    case 'new-track':
      void newWorld(ctx, true);
      break;
    case 'reset-settings':
      ctx.store.reset();
      ui.options.reset();
      applyBootTime(ctx);
      break;
  }
}

/** Audio needs a user gesture: the first key or click anywhere starts it. */
export function startAudioOnGesture(ctx: AppCtx): void {
  const start = (): void => {
    ctx.audio.start();
    window.removeEventListener('pointerdown', start, true);
    window.removeEventListener('keydown', start, true);
  };
  window.addEventListener('pointerdown', start, true);
  window.addEventListener('keydown', start, true);
}
