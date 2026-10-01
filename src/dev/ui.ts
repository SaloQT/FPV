import type { QuadState } from '../contracts';
import { StartCountdown } from '../game/countdown';
import { createSessionSnapshot, type SessionSnapshot } from '../game/sessionTypes';
import type { GameState } from '../game/stateMachine';
import { menuPresets } from '../app/ui';
import { FinishPanel } from '../ui/finish';
import { HelpOverlay } from '../ui/help';
import { buildHud, createHudModel } from '../ui/hud';
import { MenuUI } from '../ui/menu';
import type { LiveSky } from '../ui/menuHost';
import type { MenuAction, TabId } from '../ui/menuSchema';
import { OsdRenderer } from '../ui/osd';
import { PauseBadge } from '../ui/overlays';
import { PerfOverlay } from '../ui/perf';
import type { PerfSource } from '../ui/perfModel';
import { PilotOptionsStore } from '../ui/pilotOptions';
import { SettingsStore } from '../ui/settingsStore';
import { idlePreview, type PreviewState } from '../ui/trackPreviewModel';
import { SimClock } from '../world/astro';
import { generateTrack } from '../world/track/generator';
import { makeTestSampler } from '../world/track/testTerrain';

type Panel = 'start' | 'settings' | 'help' | 'perf' | 'hud' | 'finish' | 'countdown';

const PANELS: readonly Panel[] = ['start', 'settings', 'help', 'perf', 'hud', 'finish', 'countdown'];
const TABS: readonly TabId[] = ['graphics', 'camera', 'controls', 'simulation', 'audio'];
/** Bright sky over green ground, so text is judged against something like the real picture, not black. */
const BACKDROP = 'linear-gradient(180deg, #5f9fd8 0%, #b9d9ee 46%, #8fae72 47%, #4b6b3a 100%)';

function fakeQuad(): QuadState {
  const x = -0.13;
  const z = 0.09;
  return {
    time: 74.3, pos: [12, 18.5, -62], vel: [3, 1.2, -21], quat: [x, 0, z, Math.sqrt(1 - x * x - z * z)], angVel: [0, 0.4, 0],
    motorOmega: [2400, 2380, 2410, 2395], motorCmd: [0.58, 0.57, 0.59, 0.58], batteryVoltage: 21.7, batteryCurrent: 38, batteryMah: 640,
    gForce: [0, 1.6, 0], armed: true, onGround: false, crashed: false, impactSpeed: 0,
  };
}

function fakeSnapshot(state: GameState): SessionSnapshot {
  const s = createSessionSnapshot();
  s.state = state;
  s.simTime = 74.3;
  s.flightTime = 74.3;
  s.throttle = 0.58;
  Object.assign(s.race, {
    active: true, started: true, gateCount: 8, nextGate: 3, gatesPassed: 3, lap: 2, laps: 3, lapTime: 21.42, totalTime: 53.9,
    lastLap: 32.48, bestLap: 32.48, splitDelta: -0.42, splitAt: 72.5, lapTimes: [32.48],
  });
  s.stick = { roll: 0.35, pitch: -0.2, yaw: -0.6 };
  return s;
}

function readPanel(): Panel {
  const p = new URLSearchParams(location.search).get('panel');
  return PANELS.find((x) => x === p) ?? 'start';
}

function readTab(): TabId | undefined {
  const t = new URLSearchParams(location.search).get('tab');
  return TABS.find((x) => x === t);
}

/** A radio that wiggles its sticks so the calibration readout has something to show. */
function fakePad() {
  const pad = { connected: true, padId: 'Dev Radio (Vendor: 1209 Product: 4f54)', raw: new Float32Array(8), sample: { roll: 0, pitch: 0, yaw: 0, throttleDirect: 0, profile: 'radio' as const } };
  return {
    view: pad,
    animate(nowMs: number): void {
      const t = nowMs / 1000;
      for (let i = 0; i < pad.raw.length; i++) pad.raw[i] = Math.sin(t * (0.7 + 0.31 * i) + i) * 0.8;
      pad.sample.roll = pad.raw[0];
      pad.sample.pitch = pad.raw[1];
      pad.sample.throttleDirect = (pad.raw[2] + 1) / 2;
      pad.sample.yaw = pad.raw[3];
    },
  };
}

/** Steady numbers with the odd stutter, to show what the sparkline looks like when something hitches. */
function fakeFrames(): () => number {
  let seed = 7;
  const rand = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return () => 4.2 + rand() * 0.8 + (rand() < 0.03 ? 6 + rand() * 6 : 0);
}

const perfSource: PerfSource = {
  sample(out) {
    out.cpuMs = 1.84;
    out.gpuMs = 3.12;
    out.renderWidth = 2176;
    out.renderHeight = 1224;
    out.scale = 0.85;
    out.physicsMs = 0.21;
    out.physicsSteps = 17;
    out.quality = 'ultra';
    out.adapter = 'Dev Adapter (fake numbers)';
  },
};

/** A finished three-lap race with per-gate splits, for the result card. */
function finishedRace(): SessionSnapshot['race'] {
  const s = createSessionSnapshot();
  Object.assign(s.race, {
    active: true, started: true, finished: true, gateCount: 8, laps: 3, totalTime: 101.7, bestLap: 32.48, lastLap: 34.1, totalMissed: 1,
    lapTimes: [35.12, 32.48, 34.1],
    bestSplits: [4.1, 8.9, 13.2, 17.0, 20.6, 24.4, 28.8, 32.48].map((time, i) => ({ gate: (i + 1) % 8, time })),
  });
  return s.race;
}

const PREVIEW_MS = 450;

/** Builds tracks on a procedural test terrain so the map and its progress bar can be tried without WebGPU. */
function previewDriver(store: SettingsStore, menu: MenuUI): void {
  let timer = 0;
  let sampler = makeTestSampler({ seed: store.get().seed, resolution: 512, cellSize: 3 });
  let terrainSeed = store.get().seed;
  const build = (): PreviewState => {
    const s = store.get();
    if (s.seed !== terrainSeed) {
      terrainSeed = s.seed;
      sampler = makeTestSampler({ seed: s.seed, resolution: 512, cellSize: 3 });
    }
    return idlePreview(generateTrack({ seed: s.seed, style: s.trackStyle, gateCount: s.gateCount, laps: s.laps, difficulty: s.difficulty }, sampler));
  };
  let current = build();
  menu.setPreview(current);
  let last = store.get();
  store.subscribe((s) => {
    if (s.seed === last.seed && s.trackStyle === last.trackStyle && s.gateCount === last.gateCount && s.laps === last.laps && s.difficulty === last.difficulty) return;
    last = s;
    window.clearTimeout(timer);
    menu.setPreview({ status: 'working', stage: 'Placing track', progress: 0.3, track: current.track, message: '' });
    timer = window.setTimeout(() => {
      try {
        current = build();
        menu.setPreview(current);
      } catch (e) {
        menu.setPreview({ status: 'error', stage: '', progress: 0, track: current.track, message: String((e as Error).message) });
      }
    }, PREVIEW_MS);
  });
}

/** `?panel=start|settings|help|perf|hud|finish|countdown`, and with settings `&tab=graphics|camera|controls|simulation|audio`. Esc, F1 and F3 work as in the game. */
export default async function run(_canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const panel = readPanel();
  document.documentElement.style.background = BACKDROP;
  document.body.style.background = BACKDROP;
  const root = document.getElementById('ui') as HTMLElement;
  const store = new SettingsStore(null);
  const options = new PilotOptionsStore(null);
  const pad = fakePad();
  const quad = fakeQuad();
  const model = createHudModel();
  const osd = OsdRenderer.forCanvas(osdCanvas);
  const astro = new SimClock({ timeMs: store.get().timeMs, timeScale: store.get().timeScale, observer: store.get().observer });
  let clockMs = store.get().timeMs;
  let lastNow = performance.now();
  let state: GameState = panel === 'start' ? 'menu' : panel === 'settings' ? 'paused' : 'flying';
  const count = new StartCountdown();
  const snapshot = (): SessionSnapshot => {
    const snap = fakeSnapshot(state);
    if (panel === 'countdown') count.snapshot(snap.countdown);
    return snap;
  };
  const rebuild = (): void => {
    model.sticksEnabled = options.get().showSticks;
    void buildHud(quad, snapshot(), store.get(), 0, model, 'fpv');
  };
  const setState = (next: GameState): void => {
    state = next;
    rebuild();
  };

  const menu = new MenuUI({
    root, settings: store.get(), presets: menuPresets(), gamepad: pad.view, options,
    onChange: (patch) => {
      store.patch(patch);
      if (patch.timeMs !== undefined) clockMs = store.get().timeMs;
    },
    onAction: (action: MenuAction) => {
      if (action === 'reset-settings') store.reset();
      else if (action !== 'new-track') {
        setState('flying');
        menu.hide();
      }
    },
  });
  const live: LiveSky = { timeMs: clockMs, sunElevation: 0, moonElevation: 0, moonIlluminatedFraction: 0 };
  const liveNow = (): LiveSky => {
    astro.setTimeMs(clockMs);
    const a = astro.state();
    Object.assign(live, { timeMs: clockMs, sunElevation: a.sunElevation, moonElevation: a.moonElevation, moonIlluminatedFraction: a.moonIlluminatedFraction });
    return live;
  };
  menu.setLive(liveNow);
  store.subscribe((s) => {
    menu.setSettings(s);
    rebuild();
  });
  previewDriver(store, menu);
  const help = new HelpOverlay({ root });
  help.setLive(() => ({ sky: liveNow(), longitudeDeg: store.get().observer.longitudeDeg }));
  const perf = new PerfOverlay({ root, source: perfSource });
  const badge = new PauseBadge(root);
  const finish = new FinishPanel({ root, onChoice: (choice) => { window.__fpv.stats = { panel, choice }; } });
  const frames = fakeFrames();

  if (panel === 'start') menu.showStart();
  else if (panel === 'settings') menu.showSettings(readTab());
  else if (panel === 'help') help.show();
  else if (panel === 'perf') perf.show();
  else if (panel === 'finish') finish.show(finishedRace());
  else if (panel === 'countdown') {
    state = 'ready';
    count.start();
  }
  rebuild();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1') help.toggle();
    else if (e.code === 'F3') perf.toggle();
    else if (e.code === 'Escape' && state !== 'menu') {
      const open = menu.visible;
      setState(open ? 'flying' : 'paused');
      if (open) menu.hide();
      else menu.showSettings();
    } else if (e.code === 'KeyP' && !menu.visible) {
      const paused = state !== 'paused';
      setState(paused ? 'paused' : 'flying');
      if (paused) badge.show('14:32', 'sun 48°  ·  P resumes');
      else badge.hide();
    } else return;
    e.preventDefault();
  });

  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const dt = (now - lastNow) / 1000;
    lastNow = now;
    clockMs += dt * 1000 * store.get().timeScale;
    pad.animate(now);
    perf.frame(frames(), now);
    if (panel === 'countdown') {
      count.advance(dt);
      if (!count.active) count.start();
      rebuild();
    }
    osd.draw(model, now);
  };
  for (let i = 0; i < 240; i++) perf.frame(frames(), performance.now());
  requestAnimationFrame(tick);
  window.__fpv.stats = { panel };
  window.__fpv.ready = true;
}
