/**
 * One frame of the app, in two halves that the real-time loop runs back to back and the deterministic `advance` runs
 * separately (it renders only its last few frames): `simulate` moves the world forward and aims the camera, `present`
 * draws it and feeds audio, HUD and the perf overlay. Neither allocates.
 *
 * Order in `simulate`: wind, session.frame (input poll, actions, physics steps, gate events), interpolated quad state,
 * orbit input, sim clock -> astro, camera rig, then the module handles (quad visibility, active gate, prop wash).
 * Order in `present`: renderer.render, audio, HUD/OSD, perf overlay, error check.
 */
import type { PerfSample, PerfSource } from '../ui/perfModel';
import { buildHud } from '../ui/hud';
import { renderSettings, reportError, type AppCtx } from './state';
import { pushWind } from './scene';

/** Seconds between pushes of the breathing wind to the render modules (the objects module allocates per call). */
const WIND_PUSH_S = 0.05;
/** Auto-orbit of the start screen, radians per second (the rig turns 0.005 rad per input pixel). */
const INTRO_ORBIT_PX_PER_S = 30;
/** Set true to also draw the OSD in chase and free cameras (the corners and race panel, without the horizon). */
export const OSD_IN_ALL_CAMERAS = false;
const OMEGA_HOVER_SCALE = 1.1e-6;

/** Renders that make the exposure controller and the TAA history settle; `advance` and warm-up finish with this many. */
export const SETTLE_RENDERS = 8;

function pushWindIfMoved(ctx: AppCtx, dt: number): void {
  const w = ctx.wind;
  const l = ctx.last;
  l.windSince += dt;
  if (l.windSince < WIND_PUSH_S) return;
  l.windSince = 0;
  if (w.speed === l.windSpeed && w.dirXZ[0] === l.windX && w.dirXZ[1] === l.windZ) return;
  pushWind(ctx);
}

export function simulate(ctx: AppCtx, dt: number): void {
  const { session, rig, mods, wind, physics, astro } = ctx;
  const settings = ctx.store.get();
  ctx.time += dt;
  wind.update(dt);
  physics.setWind(wind.physics);
  pushWindIfMoved(ctx, dt);

  session.frame(dt);
  const rs = session.renderState();

  // Start screen: the camera circles the quad on its pad; afterwards the pilot's camera, with mouse orbit in free mode.
  const intro = !session.started && session.state === 'menu';
  const mode = intro ? 'free' : ctx.camPreferred;
  if (rig.mode !== mode) rig.mode = mode;
  const orbit = ctx.orbit;
  ctx.input.takeOrbit(orbit);
  if (intro) {
    orbit.dx = INTRO_ORBIT_PX_PER_S * dt;
    orbit.dy = 0;
    orbit.wheel = 0;
    rig.applyOrbit(orbit);
  } else if (mode === 'free') {
    rig.applyOrbit(orbit);
  }

  astro.setTimeMs(session.clock.timeMs);
  const cs = ctx.camSettings;
  cs.fov = settings.fov;
  cs.cameraTiltDeg = settings.cameraTiltDeg;
  cs.camVibration = settings.camVibration;
  rig.update(dt, rs, cs, ctx.aspect);
  const fpv = rig.mode === 'fpv';
  if (fpv !== ctx.last.fpvFx) {
    ctx.last.fpvFx = fpv;
    ctx.renderer.setSettings(renderSettings(settings, rig.mode));
  }

  session.snapshot(ctx.snap);
  const hide = !rig.quadVisible;
  if (hide !== ctx.last.hide) {
    ctx.last.hide = hide;
    mods.objects.setHideQuad(hide);
  }
  const next = ctx.snap.race.nextGate;
  if (next !== ctx.last.gate) {
    ctx.last.gate = next;
    mods.objects.setActiveGate(next);
  }
  const w = rs.motorOmega;
  const thrust = rs.armed ? OMEGA_HOVER_SCALE * (w[0] * w[0] + w[1] * w[1] + w[2] * w[2] + w[3] * w[3]) : 0;
  mods.vegetation.setQuad(rs.pos, rs.vel, thrust);

  const f = ctx.frame;
  f.dt = dt;
  f.time = ctx.time;
  f.camera = rig.camera;
  f.astro = astro.state();
  f.quad = rs;
}

export function present(ctx: AppCtx, frameMs: number, nowMs: number): void {
  const { renderer, snap, rig, audio, ui } = ctx;
  const f = ctx.frame;
  const rs = f.quad;
  renderer.render(f);
  if (rs) {
    const muted = snap.state === 'menu' || snap.state === 'paused' || ctx.hidden;
    audio.setMuted(muted);
    const a = ctx.audioCtx;
    a.speed = Math.hypot(rs.vel[0], rs.vel[2]);
    a.agl = rs.pos[1] - ctx.ground.groundHeightAt(rs.pos[0], rs.pos[2]);
    a.dt = f.dt;
    a.cameraMode = rig.mode;
    a.windSpeed = ctx.wind.speed;
    audio.update(rs, a);
    const settings = ctx.store.get();
    buildHud(rs, snap, settings, ctx.ground.groundHeightAt(rs.pos[0], rs.pos[2]), ui.hud, rig.mode);
    if (!OSD_IN_ALL_CAMERAS && rig.mode !== 'fpv') ui.hud.visible = false;
  }
  ui.osd.draw(ui.hud, nowMs);
  ui.perf.frame(frameMs, nowMs);
  checkErrors(ctx);
}

/** Renderer errors and a lost device become `window.__fpv.error` (the renderer already console.errors them). */
export function checkErrors(ctx: AppCtx): void {
  const r = ctx.renderer;
  if (r.errors.length > 0) reportError(`renderer: ${r.errors[0]}`);
  else if (r.lost) reportError(`renderer: device lost (${r.lost})`);
}

/** What the F3 overlay shows besides frame times; the context is looked up lazily because the UI is built before it. */
export function makePerfSource(get: () => AppCtx | null): PerfSource {
  return {
    sample(out: PerfSample): void {
      const c = get();
      if (!c) return;
      const st = c.renderer.stats;
      out.cpuMs = st.cpuMs;
      out.gpuMs = st.gpuMs ?? NaN;
      out.renderWidth = st.renderWidth;
      out.renderHeight = st.renderHeight;
      out.scale = st.dynamicScale;
      out.physicsMs = c.session.stats.physicsMs;
      out.physicsSteps = c.session.stats.stepsThisFrame;
      out.quality = c.store.get().quality;
      out.adapter = st.adapter;
    },
  };
}
