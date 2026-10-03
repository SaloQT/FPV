import {
  AXIS_DETECT_THRESHOLD, beginRange, bindAxis, centerFromRaw, defaultGamepadConfig, detectPadInput, extendRange,
  resolvedAxisMap, type GamepadConfig, type StickRole,
} from '../input/gamepadMap';
import {
  BIND_KIND_LABELS, PAD_ACTIONS, PAD_ACTION_INFO, describeBind, flipBind, nextStep, unboundBind,
  type ActionBind, type BindKind, type PadAction,
} from '../input/padActions';
import { blurActive, el, setHidden, setText } from './dom';
import type { BuiltControl, ControlHost, PadView } from './menuHost';

type Sample = PadView['sample'];

const STICKS = [
  { role: 'roll', label: 'Roll', signed: true, read: (s: Sample) => s.roll },
  { role: 'pitch', label: 'Pitch', signed: true, read: (s: Sample) => s.pitch },
  { role: 'yaw', label: 'Yaw', signed: true, read: (s: Sample) => s.yaw },
  { role: 'throttle', label: 'Throttle', signed: false, read: (s: Sample) => s.throttleDirect },
] as const;
const IDLE_NOTE = 'Set centre with the sticks released. To calibrate the range, press the button, sweep every stick to its ends, then press it again. To fix a controller that mixes its axes up, click a stick above and move it: the axis you move is the one it gets.';
const SWEEP_NOTE = 'Move every stick to all of its limits, then press Finish range.';
const MAX_RAW_BARS = 12;
const MAX_RAW_BUTTONS = 16;
/** How long a confirmed rebinding stays on screen before the row goes back to showing its binding. */
const CONFIRM_MS = 2200;
/** What the pilot is being asked to move, if anything. */
type Waiting = { kind: 'role'; role: StickRole } | { kind: 'action'; action: PadAction };

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

/** A button that lights up while it is held, so the pilot can name the one they pressed. */
function makeButtonChip(index: number): { root: HTMLButtonElement; set(pressed: boolean): void } {
  const btn = el('button', 'fpv-pad-btn', `B${index + 1}`);
  btn.type = 'button';
  btn.tabIndex = -1;
  btn.disabled = true;
  btn.setAttribute('aria-hidden', 'true');
  const set = (pressed: boolean): void => {
    btn.classList.toggle('fpv-pad-btn--on', pressed);
  };
  return { root: btn, set };
}

interface BindButton {
  root: HTMLButtonElement;
  /** Idle shows the binding, listening asks for a movement, confirmed reports what changed. */
  set(state: 'idle' | 'listening' | 'confirmed', text: string, waiting: string): void;
}

/** Indices are shown 1-based, matching the "Raw axes" and "Buttons" lists underneath. */
const whereLabel = (kind: 'axis' | 'button', index: number): string => `${kind === 'button' ? 'Button' : 'Axis'} ${index + 1}`;

function makeBind(onClick: () => void): BindButton {
  const badge = el('span', 'fpv-pad-bind-value', '—');
  const btn = el('button', 'fpv-pad-bind', badge);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  const set = (state: 'idle' | 'listening' | 'confirmed', text: string, waiting: string): void => {
    btn.classList.toggle('fpv-pad-bind--listening', state === 'listening');
    btn.classList.toggle('fpv-pad-bind--confirmed', state === 'confirmed');
    btn.setAttribute('aria-pressed', String(state === 'listening'));
    setText(badge, state === 'listening' ? `${waiting}…` : text);
    btn.title = state === 'listening' ? `Move or press the ${waiting} you want for this control, or press Escape` : 'Click, then move or press the control to use';
  };
  return { root: btn, set };
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

function bindFromInput(kind: 'axis' | 'button', index: number, previous: ActionBind): ActionBind {
  // A button can only be a press. An axis keeps whichever way the pilot asked to read it, so a switch
  // they already had stays a switch.
  if (kind === 'button') return { kind: 'button', index, dir: previous.dir, step: previous.step };
  const k: BindKind = previous.kind === 'none' || previous.kind === 'button' ? 'switch2' : previous.kind;
  return { kind: k, index, dir: previous.dir, step: previous.step };
}

/** The Controls tab's gamepad block: live stick meters, raw axes, the bindings and the calibration buttons. */
export function buildGamepadPanel(host: ControlHost): BuiltControl {
  const status = el('p', 'fpv-pad-status');
  status.setAttribute('aria-live', 'polite');
  const sticks = STICKS.map((s) => ({ stick: s, bar: makeBar(s.label) }));
  const rawBars = Array.from({ length: MAX_RAW_BARS }, (_, i) => makeBar(`Axis ${i + 1}`, 'fpv-bar-row--raw'));
  const rawList = el('div', 'fpv-pad-raw');
  const rawTitle = el('h4', 'fpv-pad-subtitle', 'Raw axes');
  const buttonChips = Array.from({ length: MAX_RAW_BUTTONS }, (_, i) => makeButtonChip(i));
  const buttonList = el('div', 'fpv-pad-buttons');
  const buttonTitle = el('h4', 'fpv-pad-subtitle', 'Buttons');
  const note = el('p', 'fpv-hint');
  let sweeping = false;
  let shownRaw = -1;
  let shownButtons = -1;
  // Rebinding: what the pilot is being asked to move, where every input sat when they started, and the
  // last confirmed rebinding (so the pilot can see what changed without opening anything).
  let waiting: Waiting | null = null;
  let baseline: { axes: number[]; buttons: number[] } | null = null;
  let confirmed: { what: string; at: number } | null = null;

  const profile = (): 'standard' | 'radio' => host.pad()?.sample.profile ?? 'radio';
  const cfg = (): GamepadConfig => host.settings().gamepad;
  const raw = (): ArrayLike<number> => host.pad()?.raw ?? [];

  const nameOf = (w: Waiting): string => (w.kind === 'role' ? STICKS.find((s) => s.role === w.role)?.label ?? w.role : PAD_ACTION_INFO[w.action].label);

  const stickBinds = new Map<StickRole, BindButton>();
  const actionBinds = new Map<PadAction, BindButton>();
  function toggleRole(role: StickRole): void {
    const next: Waiting = { kind: 'role', role };
    if (waiting?.kind === 'role' && waiting.role === role) return stopListening();
    waiting = next;
    baseline = null;
    confirmed = null;
    setText(note, `Move the stick you want for ${nameOf(next)}. Anything already deflected is taken as its rest position, so let go first.`);
  }
  function toggleAction(action: PadAction): void {
    const next: Waiting = { kind: 'action', action };
    if (waiting?.kind === 'action' && waiting.action === action) return stopListening();
    waiting = next;
    baseline = null;
    confirmed = null;
    setText(note, `Press the button, or move the switch, you want for ${nameOf(next)}. A three-way switch is read by its detent; you can change that afterwards.`);
  }
  function stopListening(): void {
    waiting = null;
    baseline = null;
    setText(note, IDLE_NOTE);
  }
  /** The role's current binding, or the layout's axis when the pilot has not moved it. */
  function boundAxis(role: StickRole): number {
    return resolvedAxisMap(cfg(), profile())[role];
  }
  function paintBinds(): void {
    const axes = resolvedAxisMap(cfg(), profile());
    for (const { stick } of sticks) {
      const button = stickBinds.get(stick.role);
      if (!button) continue;
      const where = whereLabel('axis', axes[stick.role]);
      const listening = waiting?.kind === 'role' && waiting.role === stick.role;
      const showing = confirmed !== null && confirmed.what === stick.label && performance.now() - confirmed.at < CONFIRM_MS;
      button.set(listening ? 'listening' : showing ? 'confirmed' : 'idle', where, 'stick');
    }
    for (const action of PAD_ACTIONS) {
      const button = actionBinds.get(action);
      if (!button) continue;
      const bind = cfg().actions[action];
      const showing = confirmed !== null && confirmed.what === PAD_ACTION_INFO[action].label && performance.now() - confirmed.at < CONFIRM_MS;
      const listening = waiting?.kind === 'action' && waiting.action === action;
      button.set(listening ? 'listening' : showing ? 'confirmed' : 'idle', describeBind(bind), PAD_ACTION_INFO[action].label);
    }
  }

  for (const { stick, bar } of sticks) {
    const button = makeBind(() => toggleRole(stick.role));
    stickBinds.set(stick.role, button);
    bar.root.classList.add('fpv-bar-row--bind');
    bar.root.append(button.root);
  }

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

  function showButtons(n: number): void {
    if (n === shownButtons) return;
    shownButtons = n;
    buttonList.replaceChildren(...buttonChips.slice(0, n).map((b) => b.root));
  }

  /** The action rows: what the switch does, how it is read, and the input it is bound to. */
  const actionRows = PAD_ACTIONS.map((action) => {
    const info = PAD_ACTION_INFO[action];
    const kind = el('select', 'fpv-select fpv-pad-kind');
    for (const k of ['none', 'button', 'switch2', 'switch3'] as const) kind.append(new Option(BIND_KIND_LABELS[k], k));
    const chip = makeBind(() => toggleAction(action));
    actionBinds.set(action, chip);
    const cycle = actionButton('⇄', () => {
      const bind = cfg().actions[action];
      const next = kind.value === 'switch2' ? flipBind(bind) : kind.value === 'switch3' ? nextStep(bind) : bind;
      host.change({ gamepad: { ...cfg(), actions: { ...cfg().actions, [action]: next } } });
      paintBinds();
    });
    const row = el('div', 'fpv-row fpv-row--bind');
    const text = el('div', 'fpv-row-text', el('label', 'fpv-label', info.label), el('p', 'fpv-hint', `${info.hint} Keyboard: ${info.key}.`));
    const ctl = el('div', 'fpv-row-ctl', kind, cycle, chip.root);
    row.append(text, ctl);
    const sync = (connected: boolean): void => {
      const bind = cfg().actions[action];
      kind.value = bind.kind;
      // Flipping the end of a switch or stepping a three-way one only means something for a switch.
      const isSwitch = bind.kind === 'switch2' || bind.kind === 'switch3';
      cycle.disabled = !isSwitch || !connected;
      chip.root.disabled = !connected;
      setText(cycle, bind.kind === 'switch3' ? '▶' : '⇄');
      cycle.title = bind.kind === 'switch3' ? 'Use the next detent of this three-position switch' : 'Swap which end of this switch is on';
    };
    kind.addEventListener('change', () => {
      const k = kind.value as BindKind;
      const was = cfg().actions[action];
      // Switching kind keeps the index so changing between 2- and 3-position does not lose the binding.
      const next: ActionBind = { kind: k, index: k === 'none' ? -1 : was.index, dir: was.dir, step: was.step };
      host.change({ gamepad: { ...cfg(), actions: { ...cfg().actions, [action]: next } } });
      paintBinds();
    });
    return { row, sync };
  });

  setText(note, IDLE_NOTE);
  const meters = el('div', 'fpv-pad-bars', ...sticks.map((s) => s.bar.root));
  const raws = el('div', 'fpv-pad-rawbox', rawTitle, rawList);
  const rawButtons = el('div', 'fpv-pad-rawbox', buttonTitle, buttonList);
  const actions = el('div', 'fpv-pad-actions', centre, range, reset);
  const actionList = el('div', 'fpv-pad-bindlist', ...actionRows.map((r) => r.row));
  const switches = el('div', 'fpv-pad-rawbox', el('h4', 'fpv-pad-subtitle', 'Switches and buttons'), actionList);
  const root = el('div', 'fpv-pad', status, meters, actions, switches, raws, rawButtons, note);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && waiting !== null) {
      e.stopPropagation();
      stopListening();
    }
  });
  paintBinds();
  for (const r of actionRows) r.sync(false);

  return {
    root,
    sync() {},
    tick() {
      const view = host.pad();
      const connected = view !== null && view.connected;
      root.classList.toggle('fpv-pad--idle', !connected);
      setText(status, connected ? `${view.padId.length > 0 ? view.padId : 'Gamepad'} (${view.sample.profile === 'standard' ? 'game controller' : 'radio'})` : 'No gamepad or radio detected. Connect one and move a stick.');
      for (const b of [centre, range, reset]) if (b.disabled === connected) b.disabled = !connected;
      for (const b of stickBinds.values()) b.root.disabled = !connected;
      for (const r of actionRows) r.sync(connected);
      setHidden(raws, !connected);
      setHidden(rawButtons, !connected);
      if (!connected) {
        if (waiting !== null) stopListening();
        return;
      }
      const s = view.sample;
      for (const { stick, bar } of sticks) bar.set(stick.read(s), stick.signed);
      const n = Math.min(view.raw.length, MAX_RAW_BARS);
      showRawBars(n);
      for (let i = 0; i < n; i++) rawBars[i].set(view.raw[i], true);
      const nb = Math.min(view.buttons.length, MAX_RAW_BUTTONS);
      showButtons(nb);
      for (let i = 0; i < nb; i++) buttonChips[i].set(view.buttons[i].pressed || view.buttons[i].value > 0.5);
      if (sweeping) {
        const next = extendRange(cfg(), s.profile, view.raw);
        if (widened(cfg(), next)) host.change({ gamepad: next });
      }
      if (waiting !== null) {
        // First frame of waiting only records where every input rests; the pilot may have a stick
        // half-depressed, and that position has to be the zero the movement is measured against.
        if (baseline === null) {
          baseline = { axes: Array.from(view.raw), buttons: Array.from(view.buttons, (b) => (b.pressed || b.value > 0.5 ? 1 : 0)) };
        } else {
          const found = detectPadInput(
            { axes: baseline.axes, buttons: baseline.buttons.map((v) => ({ pressed: v > 0.5, value: v })) },
            { axes: view.raw, buttons: view.buttons },
          );
          if (found !== null) {
            const target = waiting;
            const label = nameOf(target);
            let previous = '';
            if (target.kind === 'role') {
              previous = whereLabel('axis', boundAxis(target.role));
              host.change({ gamepad: bindAxis(cfg(), target.role, found.index) });
            } else {
              const was = cfg().actions[target.action];
              previous = describeBind(was);
              host.change({ gamepad: { ...cfg(), actions: { ...cfg().actions, [target.action]: bindFromInput(found.kind, found.index, was) } } });
            }
            confirmed = { what: label, at: performance.now() };
            waiting = null;
            baseline = null;
            const now = whereLabel(found.kind, found.index);
            setText(note, found.kind === 'button' ? `${label}: ${now}.` : previous === now
              ? `${label} was already on ${now}.`
              : `${label}: ${previous} → ${now}.`);
            // The clicked button would otherwise keep the keyboard, which belongs to the sim.
            blurActive();
          }
        }
      }
      paintBinds();
    },
    deactivate() {
      if (waiting !== null) stopListening();
      if (!sweeping) return;
      sweeping = false;
      paintMode(IDLE_NOTE);
    },
  };
}
