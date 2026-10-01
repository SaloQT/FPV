import { withLocalSolarHours } from '../game/clock';
import { formatHours } from '../game/units';
import {
  CYCLE_SCALES, cycleScaleAt, describeScale, hourOf, nearestCycleIndex, skyReadout, TIME_MODES, TIME_MODE_LABELS, timePatch, type TimeMode,
} from './clockModel';
import { el, setText, uid } from './dom';
import type { BuiltControl, ControlHost } from './menuHost';
import { MAX_DATE_YEAR, MIN_DATE_YEAR, solarDate, withSolarDate } from './menuSchema';
import type { AppSettings } from './settingsSchema';
import './flow.css';

const HOUR_STEP = 0.25;
const MODE_HINTS: Readonly<Record<TimeMode, string>> = {
  fixed: 'Time stands still. Move the hour to pick the light.',
  real: 'The sky follows your clock, at the flying site.',
  cycle: 'Time runs on from the hour shown, faster as you raise the speed.',
};

function range(min: number, max: number, step: number): HTMLInputElement {
  const input = el('input', 'fpv-range');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.id = uid('fpv-t');
  return input;
}

function fill(input: HTMLInputElement): void {
  const min = Number(input.min), max = Number(input.max);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

function line(label: string, input: HTMLInputElement, out: HTMLElement): HTMLElement {
  const l = el('label', 'fpv-label', label);
  l.htmlFor = input.id;
  return el('div', 'fpv-time-line', l, input, out);
}

/**
 * Time of day for the start screen and the Simulation tab: a live clock readout with the sun or moon, and three ways to run
 * the sky: a fixed hour, the real clock, or an accelerated day cycle (1x to 1000x). Every choice becomes the same two
 * settings the sim already follows (`timeMs`, `timeScale`), so it reaches the atmosphere through the session clock.
 */
export function buildTimeControl(host: ControlHost): BuiltControl {
  const readout = el('strong', 'fpv-time-now', '--:--');
  const body = el('span', 'fpv-time-body', '');
  const modes = el('div', 'fpv-segment');
  modes.setAttribute('role', 'radiogroup');
  modes.setAttribute('aria-label', 'Time mode');
  const buttons = new Map<TimeMode, HTMLButtonElement>();
  for (const m of TIME_MODES) {
    const b = el('button', 'fpv-segment-btn', TIME_MODE_LABELS[m]);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => chooseMode(m));
    buttons.set(m, b);
    modes.append(b);
  }
  const hour = range(0, 24 - HOUR_STEP, HOUR_STEP);
  const hourOut = el('output', 'fpv-value');
  const speed = range(0, CYCLE_SCALES.length - 1, 1);
  const speedOut = el('output', 'fpv-value fpv-value--wide');
  const date = el('input', 'fpv-input');
  date.type = 'date';
  date.min = `${MIN_DATE_YEAR}-01-01`;
  date.max = `${MAX_DATE_YEAR}-12-31`;
  date.id = uid('fpv-t');
  const dateLabel = el('label', 'fpv-label', 'Date');
  dateLabel.htmlFor = date.id;
  const hint = el('p', 'fpv-hint', '');
  const root = el('div', 'fpv-time', el('div', 'fpv-time-head', readout, body), modes, line('Hour', hour, hourOut), line('Speed', speed, speedOut), el('div', 'fpv-time-line', dateLabel, date, el('span')), hint);

  let draggingHour = false;
  const lon = (): number => host.settings().observer.longitudeDeg;
  const liveMs = (): number => host.live()?.timeMs ?? host.settings().timeMs;

  function chooseMode(mode: TimeMode): void {
    const o = host.options();
    const choice = { ...o, timeMode: mode };
    const p = timePatch(choice, liveMs(), Date.now());
    host.patchOptions({ timeMode: mode, fixedHour: hourOf(p.timeMs, lon()) });
    host.change(p);
    paintMode();
  }

  hour.addEventListener('input', () => {
    const h = Number(hour.value);
    const o = host.options();
    const timeMs = withLocalSolarHours(liveMs(), lon(), h);
    const mode: TimeMode = o.timeMode === 'real' ? 'fixed' : o.timeMode;
    host.patchOptions({ timeMode: mode, fixedHour: h });
    host.change(timePatch({ ...o, timeMode: mode }, timeMs, Date.now()));
    setText(hourOut, formatHours(h));
    fill(hour);
    paintMode();
  });
  hour.addEventListener('pointerdown', () => { draggingHour = true; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) hour.addEventListener(type, () => { draggingHour = false; });

  speed.addEventListener('input', () => {
    const scale = cycleScaleAt(Number(speed.value));
    host.patchOptions({ cycleScale: scale });
    if (host.options().timeMode === 'cycle') host.change({ timeScale: scale });
    paintSpeed();
  });

  date.addEventListener('change', () => {
    if (date.value.length > 0) host.change({ timeMs: withSolarDate(liveMs(), lon(), date.value) });
    date.value = solarDate(liveMs(), lon());
  });

  function paintMode(): void {
    const mode = host.options().timeMode;
    for (const [m, b] of buttons) {
      b.setAttribute('aria-checked', String(m === mode));
      b.classList.toggle('fpv-segment-btn--on', m === mode);
    }
    speed.disabled = mode !== 'cycle';
    setText(hint, MODE_HINTS[mode]);
  }

  function paintSpeed(): void {
    const scale = cycleScaleAt(Number(speed.value));
    setText(speedOut, describeScale(scale));
    fill(speed);
  }

  function paintLive(): void {
    const live = host.live();
    const h = hourOf(liveMs(), lon());
    const r = live === null ? null : skyReadout(h, live);
    setText(readout, formatHours(h));
    setText(body, r === null ? '' : `${r.body}${r.phase === 'day' || r.phase === 'night' ? '' : `  ·  ${r.phase}`}`);
    if (!draggingHour && document.activeElement !== hour) {
      const v = String(Math.floor(h / HOUR_STEP) * HOUR_STEP);
      if (hour.value !== v) {
        hour.value = v;
        fill(hour);
      }
      setText(hourOut, formatHours(h));
    }
    if (document.activeElement !== date) {
      const d = solarDate(liveMs(), lon());
      if (date.value !== d) date.value = d;
    }
  }

  host.onOptions(() => {
    paintMode();
    syncSpeed();
  });

  function syncSpeed(): void {
    if (document.activeElement !== speed) speed.value = String(nearestCycleIndex(host.options().cycleScale));
    paintSpeed();
  }

  return {
    root,
    sync(_s: AppSettings) {
      paintMode();
      syncSpeed();
      paintLive();
    },
    tick: paintLive,
    deactivate() {
      draggingHour = false;
    },
  };
}
