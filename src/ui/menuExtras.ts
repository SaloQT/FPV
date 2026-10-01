/**
 * Controls for the pilot options and the real airframe list, and the step that puts them into the settings tabs. The tabs
 * come from `buildTabs` (menuTabs.ts); this keeps their order and sections and swaps or adds only what the session flow owns.
 */
import { el } from './dom';
import { rowFor, type BuiltControl, type ControlHost } from './menuHost';
import type { Control, CustomControl, MenuPreset, MenuSection, MenuTab } from './menuSchema';
import { buildTimeControl } from './menuTime';
import type { PilotOptions } from './pilotOptions';

type ToggleKey = { [K in keyof PilotOptions]: PilotOptions[K] extends boolean ? K : never }[keyof PilotOptions];

/** A switch bound to one boolean pilot option. */
export function buildOptionToggle(key: ToggleKey, label: string, hint: string | undefined, host: ControlHost): BuiltControl {
  const r = rowFor({ label, hint }, 'toggle');
  const input = el('input', 'fpv-switch');
  input.type = 'checkbox';
  input.role = 'switch';
  input.id = r.id;
  r.ctl.append(input);
  r.describe(input);
  input.addEventListener('change', () => host.patchOptions({ [key]: input.checked }));
  host.onOptions((o) => { input.checked = o[key]; });
  return { root: r.root, sync: () => { input.checked = host.options()[key]; } };
}

export function optionToggle(key: ToggleKey, label: string, hint?: string): CustomControl {
  return { kind: 'custom', id: `option.${key}`, label, hint, build: (host) => buildOptionToggle(key, label, hint, host) };
}

export const RACE_START_TOGGLE = optionToggle('raceStart', 'Race start countdown', 'A 3-2-1-GO on the pad keeps the quad disarmed until GO. Off is free flight: arm and fly at once.');
export const STICKS_TOGGLE = optionToggle('showSticks', 'Stick indicator', 'Two boxes at the bottom of the picture show the roll, pitch, yaw and throttle you are sending.');

const AIRFRAME_HINT = 'Physics, flight controller and model are tuned for this airframe.';

/** The airframe line. With one real airframe it is plain text, not a choice that does nothing. */
export function airframeRow(preset: MenuPreset): CustomControl {
  return {
    kind: 'custom', id: 'airframe', label: 'Airframe', hint: AIRFRAME_HINT,
    build() {
      const r = rowFor({ label: 'Airframe', hint: AIRFRAME_HINT }, 'info');
      r.ctl.append(el('span', 'fpv-static', preset.label));
      return { root: r.root, sync: () => {} };
    },
  };
}

export const TIME_CONTROL: CustomControl = { kind: 'custom', id: 'time', label: 'Time of day', build: buildTimeControl };

const TIME_IDS: ReadonlySet<string> = new Set(['timeOfDay', 'date', 'timeScale']);

function mapSection(s: MenuSection, fn: (controls: readonly Control[]) => readonly Control[]): MenuSection {
  return { ...s, controls: fn(s.controls) };
}

function withTime(controls: readonly Control[]): readonly Control[] {
  const out: Control[] = [];
  let placed = false;
  for (const c of controls) {
    if (!TIME_IDS.has(c.id)) out.push(c);
    else if (!placed) {
      out.push(TIME_CONTROL);
      placed = true;
    }
  }
  return placed ? out : [TIME_CONTROL, ...out];
}

function withAirframe(controls: readonly Control[], presets: readonly MenuPreset[]): readonly Control[] {
  const out = presets.length === 1 ? controls.map((c) => (c.id === 'quadPreset' ? airframeRow(presets[0]) : c)) : [...controls];
  return [...out, RACE_START_TOGGLE];
}

/** The tabs with the clock control, the race-start switch, the stick-indicator switch and an honest airframe row added. */
export function extendTabs(tabs: readonly MenuTab[], presets: readonly MenuPreset[]): readonly MenuTab[] {
  return tabs.map((t) => {
    if (t.id === 'simulation') {
      return {
        ...t,
        sections: t.sections.map((s) => (s.title === 'Environment' ? mapSection(s, withTime) : s.title === 'Flight' ? mapSection(s, (c) => withAirframe(c, presets)) : s)),
      };
    }
    if (t.id === 'camera') {
      return { ...t, sections: t.sections.map((s) => (s.title === 'On-screen display' ? mapSection(s, (c) => [...c, STICKS_TOGGLE]) : s)) };
    }
    return t;
  });
}
