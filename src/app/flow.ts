/**
 * The session flow around the sim: the race-start beeps and switch, the clock mode a saved choice starts with, the result
 * card's buttons and leaderboard, the live sky for the menus, the pause badge, the mouse-capture hint and the start screen's track
 * preview.
 */
import type { FinishChoice } from '../ui/finish';
import { bootTime, hourOf, skyReadout } from '../ui/clockModel';
import type { LiveSky } from '../ui/menuHost';
import type { GameState } from '../game/stateMachine';
import { WorldPreview, worldLink } from './preview';
import { buildTrackOnly, buildWorldQuietly, landWorld, newTrack } from './scene';
import type { AppCtx } from './state';

const sky: LiveSky = { timeMs: 0, sunElevation: 0, moonElevation: 0, moonIlluminatedFraction: 0 };

/** The countdown follows the pilot's option; scripted `autostart` runs skip it unless the URL asks (`countdown=1`). */
export function raceStartEnabled(ctx: AppCtx): boolean {
  return ctx.params.countdown ?? (ctx.ui.options.get().raceStart && !ctx.params.autostart);
}

/** The sim clock and where the sun and moon stand, from the same sources the renderer's sky uses. The returned object is reused. */
export function liveSky(ctx: AppCtx): LiveSky {
  const a = ctx.astro.state();
  sky.timeMs = ctx.session.clock.timeMs;
  sky.sunElevation = a.sunElevation;
  sky.moonElevation = a.moonElevation;
  sky.moonIlluminatedFraction = a.moonIlluminatedFraction;
  return sky;
}

/**
 * Puts the saved clock choice into the settings: a fixed hour stands still, real time starts from the wall clock, a day cycle
 * runs at its speed. A `t=` URL hour keeps the time it sets; only the speed follows the choice then.
 */
export function applyBootTime(ctx: AppCtx): void {
  const s = ctx.store.get();
  const p = bootTime(ctx.ui.options.get(), s.timeMs, s.observer.longitudeDeg, Date.now());
  ctx.store.patch(ctx.params.hours !== undefined ? { timeScale: p.timeScale } : p);
}

/** Back to the pad with a fresh race. Runs inside a click or key press, so the mouse can be captured again. */
export function restartRun(ctx: AppCtx): void {
  ctx.session.resetTrack();
  ctx.audio.reset();
  ctx.session.closeMenu();
  ctx.ui.menu.hide();
  ctx.input.requestPointerLock();
}

export function finishChoice(ctx: AppCtx, choice: FinishChoice): void {
  switch (choice) {
    case 'restart':
      restartRun(ctx);
      break;
    case 'new-track':
      void newTrack(ctx).then((ok) => {
        if (ok) ctx.input.requestPointerLock();
      });
      break;
    case 'menu':
      ctx.session.openMenu();
      break;
    case 'builder':
      ctx.builder.open();
      break;
  }
}

/** The mouse hint shows while flying with the pointer free and no radio or pad connected; scripted runs never lock it, so they do not show it. */
export function updateHints(ctx: AppCtx): void {
  const s = ctx.session.state;
  const flying = s === 'ready' || s === 'flying' || s === 'crashed';
  ctx.ui.lockHint.visible = flying && !ctx.params.autostart && !ctx.input.pointerLocked && !ctx.input.gamepad.connected;
}

/** The time keys moved the sim clock off the wall clock: real time becomes a day cycle at real speed from here. */
export function onTimeNudged(ctx: AppCtx): void {
  if (ctx.ui.options.get().timeMode === 'real') ctx.ui.options.patch({ timeMode: 'cycle', cycleScale: 1 });
}

/** The leaderboard entry of the last finish, shown again when the finish card comes back after the menu. */
let lastFinish: ReturnType<AppCtx['builder']['record']> = null;

/** Called from the session's state hook after the menu logic. */
export function onStateChange(ctx: AppCtx, state: GameState, prev: GameState): void {
  const { ui, session } = ctx;
  if (state === 'finished') {
    session.snapshot(ctx.snap);
    // Record only the real finish (from flying); coming back to the card from the menu shows the same result again. The quad's
    // pilot is you, or the brain that flew any of the run (in a brain race the rivals are recorded by BrainHub.onResult).
    if (prev === 'flying') {
      const brain = ctx.brains.runPilot();
      lastFinish = ctx.builder.record(brain ?? 'You', brain === null ? 'you' : 'brain', ctx.snap.race);
    }
    ui.finish.show(ctx.snap.race, ctx.builder.finishBoard(lastFinish));
  } else {
    ui.finish.hide();
  }
  if (state === 'paused') {
    const live = liveSky(ctx);
    const r = skyReadout(hourOf(live.timeMs, ctx.store.get().observer.longitudeDeg), live);
    ui.badge.show(r.time, `${r.text.slice(r.time.length).trim()}  ·  P resumes`);
  } else {
    ui.badge.hide();
  }
  // The settings' `timeMs` goes stale while the clock runs (and the time keys only move the session's clock): bring both up to date.
  if (state === 'menu' && prev !== 'menu') {
    ctx.store.patch({ timeMs: session.clock.timeMs });
    if (ui.options.get().timeMode === 'fixed') ui.options.patch({ fixedHour: hourOf(session.clock.timeMs, ctx.store.get().observer.longitudeDeg) });
  }
  updateHints(ctx);
}

/** Connects everything that does not depend on the settings store. Call once, after the session hooks are set. */
export function wireFlow(ctx: AppCtx): void {
  const { session, ui, audio } = ctx;
  session.onCountdown = (n) => audio.countdown(n);
  const apply = (): void => {
    session.setRaceStart(raceStartEnabled(ctx));
    ui.hud.sticksEnabled = ui.options.get().showSticks;
  };
  ui.options.subscribe(apply);
  apply();
  ui.menu.setLive(() => liveSky(ctx));
  ui.help.setLive(() => ({ sky: liveSky(ctx), longitudeDeg: ctx.store.get().observer.longitudeDeg }));
  ui.onFinish = (choice) => finishChoice(ctx, choice);
  ctx.brains.onResult = (name, snap) => ctx.builder.record(name, 'brain', snap);
  document.addEventListener('pointerlockchange', () => updateHints(ctx));
  document.addEventListener('pointerlockerror', () => updateHints(ctx));
}

/** The start screen's live track preview: builds the world the settings ask for in the background and shows its map. */
export function createPreview(ctx: AppCtx): WorldPreview {
  const preview = new WorldPreview(
    {
      settings: () => ctx.store.get(),
      world: () => ctx.world,
      locked: () => ctx.session.started,
      buildTrack: buildTrackOnly,
      buildWorld: buildWorldQuietly,
      apply: (world) => landWorld(ctx, world),
      emit: (state) => ctx.ui.menu.setPreview(state),
      after: (ms, fn) => window.setTimeout(fn, ms),
      cancel: (handle) => window.clearTimeout(handle),
    },
    ctx.store.get(),
  );
  ctx.ui.menu.setPreview(preview.current());
  ctx.ui.menu.setSharedWorld(() => {
    const w = worldLink(ctx.world, preview.current().status, ctx.session.started);
    return w === false ? { fileTrack: true, terrainSeed: ctx.world.terrainSeed, quality: ctx.world.quality } : w;
  });
  // A link to an N-key track: the boot world is built from the seed, so the link's own track replaces it before the first flight.
  const link = ctx.params.trackSeed;
  if (link !== undefined && link !== ctx.world.seed) preview.launch(link);
  return preview;
}
