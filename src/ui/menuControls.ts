import { el, setText } from './dom';
import { buildGamepadPanel } from './menuGamepad';
import { rowFor, type BuiltControl, type ControlHost, type Row } from './menuHost';
import {
  MAX_DATE_YEAR, MIN_DATE_YEAR,
  type ButtonControl, type Control, type DateControl, type NumberControl, type SelectControl, type SliderControl, type ToggleControl,
} from './menuSchema';

/** A range input and its value box. `input` is exposed for controls that re-range the slider as the settings change. */
export interface SliderRow {
  row: Row;
  input: HTMLInputElement;
  paint(value: number): void;
}

/** Builds the range input of a slider control and keeps the value box and the fill in step with it. */
export function buildSliderRow(c: SliderControl, host: ControlHost): SliderRow {
  const r = rowFor(c, 'slider');
  const input = el('input', 'fpv-range');
  input.type = 'range';
  input.id = r.id;
  input.min = String(c.min);
  input.max = String(c.max);
  input.step = String(c.step);
  const out = el('output', 'fpv-value');
  out.htmlFor = r.id;
  r.ctl.append(input, out);
  r.describe(input);
  const paint = (v: number): void => {
    const text = c.format(v);
    input.style.setProperty('--fill', `${((v - c.min) / (c.max - c.min)) * 100}%`);
    input.setAttribute('aria-valuetext', text);
    setText(out, text);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    host.change(c.write(v, host.settings()));
  });
  return { row: r, input, paint };
}

function sliderControl(c: SliderControl, host: ControlHost): BuiltControl {
  const { row, input, paint } = buildSliderRow(c, host);
  let dragging = false;
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    input.addEventListener(type, () => { dragging = type === 'pointerdown'; });
  }
  return {
    root: row.root,
    sync(s) {
      if (dragging) return;
      const v = c.read(s);
      input.value = String(v);
      paint(v);
    },
  };
}

function toggleControl(c: ToggleControl, host: ControlHost): BuiltControl {
  const r = rowFor(c, 'toggle');
  const input = el('input', 'fpv-switch');
  input.type = 'checkbox';
  input.role = 'switch';
  input.id = r.id;
  r.ctl.append(input);
  r.describe(input);
  input.addEventListener('change', () => host.change(c.write(input.checked, host.settings())));
  return { root: r.root, sync: (s) => { input.checked = c.read(s); } };
}

function selectControl(c: SelectControl, host: ControlHost): BuiltControl {
  const r = rowFor(c, 'select');
  const select = el('select', 'fpv-select');
  select.id = r.id;
  for (const o of c.options) select.append(new Option(o.label, o.value));
  r.ctl.append(select);
  r.describe(select);
  select.addEventListener('change', () => host.change(c.write(select.value, host.settings())));
  return {
    root: r.root,
    sync(s) {
      const v = c.read(s);
      if (!Array.from(select.options).some((o) => o.value === v)) select.append(new Option(v, v));
      select.value = v;
    },
  };
}

function numberControl(c: NumberControl, host: ControlHost): BuiltControl {
  const r = rowFor(c, 'number');
  const input = el('input', 'fpv-input');
  input.type = 'number';
  input.id = r.id;
  input.min = String(c.min);
  input.max = String(c.max);
  input.step = '1';
  input.inputMode = 'numeric';
  r.ctl.append(input);
  r.describe(input);
  const show = (): void => { input.value = String(c.read(host.settings())); };
  input.addEventListener('change', () => {
    const v = Math.round(Number(input.value));
    if (input.value.trim().length === 0 || !Number.isFinite(v)) show();
    else host.change(c.write(v, host.settings()));
    show();
  });
  if (c.random) {
    const dice = el('button', 'fpv-btn fpv-btn--small', 'Random');
    dice.type = 'button';
    dice.setAttribute('aria-label', `Random ${c.label.toLowerCase()}`);
    dice.addEventListener('click', () => {
      host.change(c.write(c.min + Math.floor(Math.random() * (c.max - c.min + 1)), host.settings()));
      show();
    });
    r.ctl.append(dice);
  }
  return { root: r.root, sync: (s) => { if (document.activeElement !== input) input.value = String(c.read(s)); } };
}

function dateControl(c: DateControl, host: ControlHost): BuiltControl {
  const r = rowFor(c, 'date');
  const input = el('input', 'fpv-input');
  input.type = 'date';
  input.id = r.id;
  input.min = `${MIN_DATE_YEAR}-01-01`;
  input.max = `${MAX_DATE_YEAR}-12-31`;
  r.ctl.append(input);
  r.describe(input);
  input.addEventListener('change', () => {
    if (input.value.length > 0) host.change(c.write(input.value, host.settings()));
    input.value = c.read(host.settings());
  });
  return { root: r.root, sync: (s) => { if (document.activeElement !== input) input.value = c.read(s); } };
}

function buttonControl(c: ButtonControl, host: ControlHost): BuiltControl {
  const root = el('div', 'fpv-row fpv-row--action');
  const b = el('button', `fpv-btn fpv-btn--${c.tone}`, c.label);
  b.type = 'button';
  b.addEventListener('click', () => host.action(c.action));
  root.append(b);
  if (c.hint !== undefined) root.append(el('p', 'fpv-hint', c.hint));
  return { root, sync: () => {} };
}

/** Builds the DOM for one control; `sync` writes the current settings into it. */
export function buildControl(c: Control, host: ControlHost): BuiltControl {
  switch (c.kind) {
    case 'slider': return sliderControl(c, host);
    case 'toggle': return toggleControl(c, host);
    case 'select': return selectControl(c, host);
    case 'number': return numberControl(c, host);
    case 'date': return dateControl(c, host);
    case 'button': return buttonControl(c, host);
    case 'gamepad': return buildGamepadPanel(host);
    case 'custom': return c.build(host);
  }
}
