import { beginRange, centerFromRaw, defaultGamepadConfig, extendRange, type GamepadConfig } from '../input/gamepadMap';
import { el, setHidden, setText } from './dom';
import type { BuiltControl, ControlHost, PadView } from './menuHost';

type Sample = PadView['sample'];

const STICKS = [
  { role: 'roll', label: 'Roll', signed: true, read: (s: Sample) => s.roll },
  { role: 'pitch', label: 'Pitch', signed: true, read: (s: Sample) => s.pitch },
  { role: 'yaw', label: 'Yaw', signed: true, read: (s: Sample) => s.yaw },
  { role: 'throttle', label: 'Throttle', signed: false, read: (s: Sample) => s.throttleDirect },
] as const;
const IDLE_NOTE = 'Set centre with the sticks released. To calibrate the range, press the button, sweep every stick to its ends, then press it again.';
const SWEEP_NOTE = 'Move every stick to all of its limits, then press Finish range.';
const MAX_RAW_BARS = 12;

interface Bar {
  root: HTMLElement;
  set(value: number, signed: boolean): void;
}

/** A meter with a centre tick: signed values grow from the middle, unsigned ones from the left. */
function makeBar(label: string, className = ''): Bar {
  const fill = el('div', 'fpv-bar-fill');
  const value = el('span', 'fpv-bar-value', '0.00');
  const text = el('span', 'fpv-bar-label', label);
  const track = el('div', 'fpv-bar', fill, el('div', 'fpv-bar-mid'));
  track.setAttribute('role', 'presentation');
  const root = el('div', `fpv-bar-row ${className}`.trim(), text, track, value);
  let key = NaN;
  return {
    root,
    set(v, signed) {
      const c = Math.min(Math.max(v, signed ? -1 : 0), 1);
      const left = Math.round((signed ? 50 + Math.min(c, 0) * 50 : 0) * 2) / 2;
      const width = Math.round((signed ? Math.abs(c) * 50 : c * 100) * 2) / 2;
      const k = left * 1000 + width;
      if (k !== key) {
        key = k;
        fill.style.left = `${left}%`;
        fill.style.width = `${width}%`;
      }
      setText(value, c.toFixed(2));
    },
  };
}

function widened(a: GamepadConfig, b: GamepadConfig): boolean {
  return STICKS.some(({ role }) => a.cal[role].min !== b.cal[role].min || a.cal[role].max !== b.cal[role].max);
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'fpv-btn fpv-btn--small', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** The Controls tab's gamepad block: live stick meters, raw axes and the calibration buttons. */
export function buildGamepadPanel(host: ControlHost): BuiltControl {
  const status = el('p', 'fpv-pad-status');
  status.setAttribute('aria-live', 'polite');
  const sticks = STICKS.map((s) => ({ stick: s, bar: makeBar(s.label) }));
  const rawBars = Array.from({ length: MAX_RAW_BARS }, (_, i) => makeBar(`Axis ${i + 1}`, 'fpv-bar-row--raw'));
  const rawList = el('div', 'fpv-pad-raw');
  const rawTitle = el('h4', 'fpv-pad-subtitle', 'Raw axes');
  const note = el('p', 'fpv-hint');
  let sweeping = false;
  let shownRaw = -1;

  const profile = (): 'standard' | 'radio' => host.pad()?.sample.profile ?? 'radio';
  const cfg = (): GamepadConfig => host.settings().gamepad;
  const raw = (): ArrayLike<number> => host.pad()?.raw ?? [];

  const centre = actionButton('Set centre', () => {
    host.change({ gamepad: centerFromRaw(cfg(), profile(), raw()) });
    setText(note, 'Centre saved from the sticks as they are now.');
  });
  const range = actionButton('Calibrate range', () => {
    sweeping = !sweeping;
    if (sweeping) host.change({ gamepad: beginRange(cfg(), profile(), raw()) });
    paintMode(sweeping ? SWEEP_NOTE : 'Range saved.');
  });
  const reset = actionButton('Reset calibration', () => {
    sweeping = false;
    host.change({ gamepad: { ...cfg(), cal: defaultGamepadConfig().cal } });
    paintMode('Calibration cleared.');
  });

  function paintMode(message: string): void {
    setText(range, sweeping ? 'Finish range' : 'Calibrate range');
    range.classList.toggle('fpv-btn--primary', sweeping);
    setText(note, message);
  }

  function showRawBars(n: number): void {
    if (n === shownRaw) return;
    shownRaw = n;
    rawList.replaceChildren(...rawBars.slice(0, n).map((b) => b.root));
  }

  setText(note, IDLE_NOTE);
  const meters = el('div', 'fpv-pad-bars', ...sticks.map((s) => s.bar.root));
  const raws = el('div', 'fpv-pad-rawbox', rawTitle, rawList);
  const actions = el('div', 'fpv-pad-actions', centre, range, reset);
  const root = el('div', 'fpv-pad', status, meters, raws, actions, note);

  return {
    root,
    sync() {},
    tick() {
      const view = host.pad();
      const connected = view !== null && view.connected;
      root.classList.toggle('fpv-pad--idle', !connected);
      setText(status, connected ? `${view.padId.length > 0 ? view.padId : 'Gamepad'} (${view.sample.profile === 'standard' ? 'game controller' : 'radio'})` : 'No gamepad or radio detected. Connect one and move a stick.');
      for (const b of [centre, range, reset]) if (b.disabled === connected) b.disabled = !connected;
      setHidden(raws, !connected);
      if (!connected) return;
      const s = view.sample;
      for (const { stick, bar } of sticks) bar.set(stick.read(s), stick.signed);
      const n = Math.min(view.raw.length, MAX_RAW_BARS);
      showRawBars(n);
      for (let i = 0; i < n; i++) rawBars[i].set(view.raw[i], true);
      if (sweeping) {
        const next = extendRange(cfg(), s.profile, view.raw);
        if (widened(cfg(), next)) host.change({ gamepad: next });
      }
    },
    deactivate() {
      if (!sweeping) return;
      sweeping = false;
      paintMode(IDLE_NOTE);
    },
  };
}
