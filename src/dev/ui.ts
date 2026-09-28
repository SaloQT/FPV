import type { QuadState } from '../contracts';
import { createSessionSnapshot, type SessionSnapshot } from '../game/sessionTypes';
import type { GameState } from '../game/stateMachine';
import { HelpOverlay } from '../ui/help';
import { buildHud, createHudModel } from '../ui/hud';
import { MenuUI } from '../ui/menu';
import type { MenuAction, TabId } from '../ui/menuSchema';
import { OsdRenderer } from '../ui/osd';
import { PerfOverlay } from '../ui/perf';
import type { PerfSource } from '../ui/perfModel';
import { SettingsStore } from '../ui/settingsStore';

type Panel = 'start' | 'settings' | 'help' | 'perf' | 'hud';

const PANELS: readonly Panel[] = ['start', 'settings', 'help', 'perf', 'hud'];
const TABS: readonly TabId[] = ['graphics', 'camera', 'controls', 'simulation', 'audio'];
const PRESETS = [{ id: 'QUAD_5IN_6S', label: '5 inch race, 6S' }, { id: 'QUAD_3IN_4S', label: '3 inch cinewhoop, 4S' }];
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

/** `?panel=start|settings|help|perf|hud`, and with settings `&tab=graphics|camera|controls|simulation|audio`. Esc, F1 and F3 work as in the game. */
export default async function run(_canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const panel = readPanel();
  document.documentElement.style.background = BACKDROP;
  document.body.style.background = BACKDROP;
  const root = document.getElementById('ui') as HTMLElement;
  const store = new SettingsStore(null);
  const pad = fakePad();
  const quad = fakeQuad();
  const model = createHudModel();
  const osd = OsdRenderer.forCanvas(osdCanvas);
  let state: GameState = panel === 'start' ? 'menu' : panel === 'settings' ? 'paused' : 'flying';
  const rebuild = (): void => void buildHud(quad, fakeSnapshot(state), store.get(), 0, model, 'fpv');
  const setState = (next: GameState): void => {
    state = next;
    rebuild();
  };

  const menu = new MenuUI({
    root, settings: store.get(), presets: PRESETS, gamepad: pad.view,
    onChange: (patch) => store.patch(patch),
    onAction: (action: MenuAction) => {
      if (action === 'reset-settings') store.reset();
      else if (action !== 'new-track') {
        setState('flying');
        menu.hide();
      }
    },
  });
  store.subscribe((s) => {
    menu.setSettings(s);
    rebuild();
  });
  const help = new HelpOverlay({ root });
  const perf = new PerfOverlay({ root, source: perfSource });
  const frames = fakeFrames();

  if (panel === 'start') menu.showStart();
  else if (panel === 'settings') menu.showSettings(readTab());
  else if (panel === 'help') help.show();
  else if (panel === 'perf') perf.show();
  rebuild();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1') help.toggle();
    else if (e.code === 'F3') perf.toggle();
    else if (e.code === 'Escape' && state !== 'menu') {
      const open = menu.visible;
      setState(open ? 'flying' : 'paused');
      if (open) menu.hide();
      else menu.showSettings();
    } else return;
    e.preventDefault();
  });

  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    pad.animate(now);
    perf.frame(frames(), now);
    osd.draw(model, now);
  };
  for (let i = 0; i < 240; i++) perf.frame(frames(), performance.now());
  requestAnimationFrame(tick);
  window.__fpv.stats = { panel };
  window.__fpv.ready = true;
}
