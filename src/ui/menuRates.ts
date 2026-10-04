/**
 * The Controls tab's stick-rate block: the rate type, the named presets, the per-axis numbers and the stick-to-rate
 * response table the WebFPV rate calculator prints. It is one custom control because the slider ranges are the rate
 * type's own units and because the pitch rows have to follow the separate-pitch switch.
 */
import {
  CUSTOM_RATES, RATE_FIELDS, RATE_PRESETS, cloneRateSettings, matchRatePreset, rateProfileOf, rateResponse,
  RESPONSE_STICKS, type RateAxis, type RateSettings,
} from '../sim/fc/ratePresets';
import { RATE_TYPES, type RateType } from '../sim/fc/rates';
import { el } from './dom';
import { buildSliderRow } from './menuControls';
import { rowFor, type BuiltControl, type ControlHost } from './menuHost';
import type { CustomControl, SliderControl } from './menuSchema';

const AXES: readonly { axis: RateAxis; label: string }[] = [
  { axis: 'roll', label: 'Roll' },
  { axis: 'pitch', label: 'Pitch' },
  { axis: 'yaw', label: 'Yaw' },
];
const FIELDS = ['rcRate', 'superRate', 'expo'] as const;

const TYPE_LABELS: Readonly<Record<RateType, string>> = {
  actual: 'Actual (deg/s)',
  betaflight: 'Betaflight',
  quick: 'Quick',
};

/** Betaflight's own field names, which is what the WebFPV calculator calls them. */
const FIELD_LABELS: Readonly<Record<(typeof FIELDS)[number], string>> = {
  rcRate: 'RC rate',
  superRate: 'Super rate',
  expo: 'RC expo',
};

const TYPE_HINT = 'Betaflight reads RC rate as a multiplier on 200 deg/s and Super rate as a 0 to 0.99 knee. Actual and Quick read both in deg/s.';
const SEPARATE_HINT = 'Off makes the pitch axis follow the roll numbers, which is what Betaflight\'s separate-pitch switch does.';
const PRESET_HINT = 'Pick a named curve or edit the numbers below; anything hand-tuned shows as Custom.';
const RESPONSE_HINT = `What the flight controller is told to do, in deg/s at ${RESPONSE_STICKS.map((f) => `${Math.round(f * 100)}%`).join(', ')} stick.`;
const RATES_HINT = `How far the quad is told to turn for a given stick deflection. The throttle stick is absolute over its calibrated travel and has no rate curve of its own. ${RESPONSE_HINT}`;

/** Betaflight's numbers are small, the deg/s types are not: two decimals under 10, none above. */
function rateText(value: number): string {
  return value < 10 ? value.toFixed(2) : String(Math.round(value));
}

function optionLabel(v: string): string {
  if (v === CUSTOM_RATES) return 'Custom';
  return TYPE_LABELS[v as RateType] ?? RATE_PRESETS.find((p) => p.id === v)?.label ?? v;
}

interface SelectRow {
  root: HTMLElement;
  sync(value: string): void;
}

function selectRow(label: string, hint: string, values: readonly string[], initial: string, onChange: (v: string) => void): SelectRow {
  const r = rowFor({ label, hint }, 'select');
  const select = el('select', 'fpv-select');
  select.id = r.id;
  const known = [...values];
  for (const v of known) select.append(new Option(optionLabel(v), v));
  select.value = initial;
  r.ctl.append(select);
  r.describe(select);
  select.addEventListener('change', () => onChange(select.value));
  return {
    root: r.root,
    sync(value) {
      // A stored value the current build does not offer is still shown, rather than silently swapped for a default.
      if (!known.includes(value)) {
        known.push(value);
        select.append(new Option(optionLabel(value), value));
      }
      select.value = value;
    },
  };
}

interface NumberRow {
  root: HTMLElement;
  set(value: number, type: RateType): void;
  setEnabled(on: boolean): void;
}

interface AxisRows {
  root: HTMLElement;
  /** Writes the type's ranges, the stored numbers and the separate-pitch state into the three sliders. */
  sync(settings: RateSettings): void;
}

/** One axis' RC rate / Super rate / RC expo sliders, re-ranged when the rate type changes. */
function axisRows(axis: RateAxis, label: string, host: ControlHost): AxisRows {
  const inputs = FIELDS.map((field) => {
    const control: SliderControl = {
      kind: 'slider', id: `rates.${axis}.${field}`, label: FIELD_LABELS[field],
      min: 0, max: 1, step: 0.01, format: rateText,
      read: (s) => s.rates[axis][field],
      write: (v, s) => ({ rates: { ...s.rates, [axis]: { ...s.rates[axis], [field]: v } } }),
    };
    const { row, input, paint } = buildSliderRow(control, host);
    return {
      field,
      input,
      row,
      set(value: number, type: RateType): void {
        const f = RATE_FIELDS[type][field];
        input.min = String(f.min);
        input.max = String(f.max);
        input.step = String(f.step);
        if (document.activeElement !== input) input.value = String(value);
        paint(value);
      },
      setEnabled(on: boolean): void {
        input.disabled = !on;
        row.root.classList.toggle('fpv-row--off', !on);
      },
    };
  });
  const root = el('div', 'fpv-rates-group', el('h4', 'fpv-rates-subtitle', label), ...inputs.map((i) => i.row.root));
  return {
    root,
    sync(settings) {
      const type = settings.type;
      const enabled = axis === 'pitch' ? settings.separatePitch : true;
      // The numbers come from the settings argument, not from the host, so a slider mid-drag is not fought over.
      for (const i of inputs) {
        i.set(settings[axis][i.field], type);
        i.setEnabled(enabled);
      }
    },
  };
}

/** The Controls tab's rate block. */
export function buildRatesPanel(host: ControlHost): BuiltControl {
  const rates = (): RateSettings => host.settings().rates;
  const set = (patch: Partial<RateSettings>): void => { host.change({ rates: { ...rates(), ...patch } }); };

  const preset = selectRow('Rate preset', PRESET_HINT, [...RATE_PRESETS.map((p) => p.id), CUSTOM_RATES], matchRatePreset(rates()), (v) => {
    const p = RATE_PRESETS.find((x) => x.id === v);
    if (p) set(cloneRateSettings(p.settings));
  });
  const type = selectRow('Rate type', TYPE_HINT, RATE_TYPES, rates().type, (v) => set({ type: v as RateType }));

  const sepRow = rowFor({ label: 'Separate pitch', hint: SEPARATE_HINT }, 'toggle');
  const sepInput = el('input', 'fpv-switch');
  sepInput.type = 'checkbox';
  sepInput.role = 'switch';
  sepInput.id = sepRow.id;
  sepRow.ctl.append(sepInput);
  sepRow.describe(sepInput);
  sepInput.addEventListener('change', () => set({ separatePitch: sepInput.checked }));

  const groups = AXES.map(({ axis, label }) => axisRows(axis, label, host));
  const response = el('div', 'fpv-rates-response');
  const root = el('div', 'fpv-rates', preset.root, type.root, sepRow.root, ...groups.map((g) => g.root), response);

  return {
    root,
    sync(s) {
      const r = s.rates;
      preset.sync(matchRatePreset(r));
      type.sync(r.type);
      sepInput.checked = r.separatePitch;
      for (const g of groups) g.sync(r);
      const profile = rateProfileOf(r);
      const lines = AXES.map(({ axis, label }) => {
        const dps = rateResponse(profile, axis).join('  /  ');
        const line = el('p', 'fpv-rates-line', `${label}  ${dps} deg/s`);
        line.setAttribute('aria-label', `${label}: ${dps} degrees per second at ${RESPONSE_STICKS.map((f) => `${Math.round(f * 100)}%`).join(', ')} stick`);
        return line;
      });
      response.replaceChildren(...lines);
    },
  };
}

export const RATES_PANEL: CustomControl = {
  kind: 'custom', id: 'rates', label: 'Stick rates', hint: RATES_HINT, build: buildRatesPanel,
};
