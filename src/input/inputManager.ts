import type { FlightMode, StickInput } from '../contracts';
import { compileBindings, DEFAULT_BINDINGS, REPEATABLE_ACTIONS, SWALLOWED_KEYS, UI_ACTIONS, type Bindings, type CompiledBindings } from './bindings';
import { clamp, shapeStick } from './curves';
import { GamepadInput, type PadProvider } from './gamepad';
import { padThrottle, resolveThrottleMode } from './gamepadMap';
import type { PadAction } from './padActions';
import { KEYBOARD_YAW_LIMIT, KeyboardStick, type KeyboardAxes } from './keyboardStick';
import { MouseStick } from './mouseStick';
import { PointerInput, type OrbitDelta } from './pointer';
import type { InputAction, InputSettingsStore, InputSource } from './types';

export interface InputManagerOptions {
  bindings?: Bindings;
  /** Gamepad source; defaults to `navigator.getGamepads`. */
  pads?: PadProvider;
  now?: () => number;
}

const MODES: readonly FlightMode[] = ['acro', 'angle', 'horizon'];
const MAX_QUEUED = 32;
/**
 * Which app action each bindable pad action raises. `turtle` is a held state rather than an edge, so it
 * is read from the sample in `poll` instead of appearing here.
 */
const PAD_ACTION_INPUT: readonly (readonly [PadAction, InputAction])[] = [
  ['arm', 'arm-toggle'], ['camera', 'camera-cycle'], ['respawn', 'respawn'], ['resetTrack', 'reset-track'],
  ['newTrack', 'new-track'], ['modeCycle', 'mode-cycle'], ['menu', 'toggle-menu'], ['help', 'toggle-help'], ['perf', 'toggle-perf'],
];
/** Esc can reach us both as a key and as a lost pointer lock; report the menu toggle once. */
const MENU_DEDUPE_MS = 150;
/** A stalled frame must not turn into a huge stick ramp. */
const MAX_DT = 0.1;
const FORM_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isFormField(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  return el !== null && ((el.tagName !== undefined && FORM_TAGS.has(el.tagName)) || el.isContentEditable === true);
}

function anyHeld(held: ReadonlySet<string>, codes: readonly string[]): boolean {
  for (let i = 0; i < codes.length; i++) if (held.has(codes[i])) return true;
  return false;
}

/**
 * Merges keyboard, mouse (Pointer Lock) and gamepad into one StickInput. Call `poll` once per render frame, then drain
 * `takeActions`. A pad that moved in the last 2 s overrides keyboard and mouse; the throttle is one latch shared by all three.
 */
export class InputManager implements InputSource {
  readonly gamepad: GamepadInput;
  private readonly kb = new KeyboardStick();
  private readonly mouse = new MouseStick();
  private readonly pointer: PointerInput;
  private readonly held = new Set<string>();
  private readonly axes: KeyboardAxes = { throttleUp: false, throttleDown: false, throttleCut: false, boost: false, yawLeft: false, yawRight: false, rollLeft: false, rollRight: false, pitchUp: false, pitchDown: false };
  private readonly out: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: false, mode: 'acro', turtle: false };
  private readonly cleanups: (() => void)[] = [];
  private readonly now: () => number;
  private bindings: Bindings;
  private compiled: CompiledBindings;
  private queue: InputAction[] = [];
  private spare: InputAction[] = [];
  private isArmed = false;
  private enabled = true;
  private lastMenuMs = -Infinity;
  private keyboardThrottle = true;

  constructor(
    target: HTMLElement | Window,
    canvas: HTMLCanvasElement,
    private readonly settings: InputSettingsStore,
    opts: InputManagerOptions = {},
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.bindings = opts.bindings ?? DEFAULT_BINDINGS;
    this.compiled = compileBindings(this.bindings);
    this.gamepad = new GamepadInput(opts.pads);
    this.pointer = new PointerInput(canvas, this.mouse, this.now, () => this.pushAction('toggle-menu'));
    this.listen(target, 'keydown', this.onKeyDown);
    this.listen(target, 'keyup', this.onKeyUp);
    this.listen(target, 'blur', this.releaseKeys);
    if (typeof window !== 'undefined' && (target as unknown) !== window) this.listen(window, 'blur', this.releaseKeys);
    this.listen(canvas.ownerDocument, 'visibilitychange', this.releaseKeys);
  }

  get armed(): boolean {
    return this.isArmed;
  }

  get pointerLocked(): boolean {
    return this.pointer.locked;
  }

  setArmed(armed: boolean): void {
    this.isArmed = armed;
  }

  setThrottle(value: number): void {
    this.kb.throttle = clamp(value, 0, 1);
    this.keyboardThrottle = true;
  }

  recenter(): void {
    this.mouse.reset();
    this.kb.roll = this.kb.pitch = this.kb.yaw = 0;
  }

  /** While disabled (menu open) game keys are not captured or suppressed, sticks read zero, and only menu/help/perf actions fire. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.pointer.enabled = enabled;
    if (enabled) return;
    this.releaseKeys();
    this.mouse.reset();
    this.pointer.exitLock();
  }

  requestPointerLock(): void {
    this.pointer.requestLock();
  }

  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
    this.compiled = compileBindings(bindings);
    this.held.clear();
  }

  /** Mouse drag and wheel travel accumulated while the pointer is not locked (free camera orbit); resets the accumulators. */
  takeOrbit(out: OrbitDelta): void {
    this.pointer.takeOrbit(out);
  }

  /** The returned object is reused: read it before the next `poll`. */
  poll(dt: number): StickInput {
    const cfg = this.settings.get();
    const step = dt > MAX_DT ? MAX_DT : dt;
    const pad = this.gamepad;
    pad.poll(cfg.gamepad, this.now());
    this.applyPadEdges();
    const out = this.out;
    if (this.enabled) {
      this.readAxes();
      const s = pad.sample;
      const padOn = pad.connected && pad.active;
      if (padOn) this.keyboardThrottle = false;
      else if (this.axes.throttleUp || this.axes.throttleDown || this.axes.throttleCut) this.keyboardThrottle = true;
      this.kb.update(step, this.axes, this.keyboardThrottle);
      // Disarmed, a released keyboard throttle is back at zero at once, so arming is never refused while it eases down.
      if (!this.isArmed && this.keyboardThrottle && !this.axes.throttleUp && !this.axes.throttleDown) this.kb.throttle = 0;
      this.mouse.update(step, cfg.mouseCentering, cfg.mouseSensitivity, cfg.invertY);
      if (padOn) this.kb.throttle = padThrottle(resolveThrottleMode(cfg.gamepad, s.profile), s, this.kb.throttle, step, cfg.gamepad.hoverThrottle);
      out.roll = padOn ? s.roll : clamp(this.kb.roll + shapeStick(this.mouse.x, cfg.mouseDeadzone, cfg.mouseExpo), -1, 1);
      out.pitch = padOn ? s.pitch : clamp(this.kb.pitch + shapeStick(this.mouse.y, cfg.mouseDeadzone, cfg.mouseExpo), -1, 1);
      out.yaw = padOn ? s.yaw : this.kb.yaw * KEYBOARD_YAW_LIMIT;
      out.turtle = anyHeld(this.held, this.bindings.axes.turtle) || (pad.connected && s.aux.turtle);
    } else {
      out.roll = out.pitch = out.yaw = 0;
      out.turtle = false;
    }
    out.throttle = this.kb.throttle;
    out.armed = this.isArmed;
    out.mode = cfg.mode;
    return out;
  }

  /** The returned array is reused: read it before the next `takeActions`. */
  takeActions(): readonly InputAction[] {
    const taken = this.queue;
    this.queue = this.spare;
    this.queue.length = 0;
    this.spare = taken;
    return taken;
  }

  dispose(): void {
    this.pointer.dispose();
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  private pushAction(action: InputAction): void {
    if (!this.enabled && !UI_ACTIONS.has(action)) return;
    if (action === 'toggle-menu') {
      const t = this.now();
      if (t - this.lastMenuMs < MENU_DEDUPE_MS) return;
      this.lastMenuMs = t;
    }
    if (action === 'mode-cycle') this.settings.patch({ mode: MODES[(MODES.indexOf(this.settings.get().mode) + 1) % MODES.length] });
    if (this.queue.length < MAX_QUEUED) this.queue.push(action);
  }

  private applyPadEdges(): void {
    const e = this.gamepad.edges;
    for (const [action, inputAction] of PAD_ACTION_INPUT) {
      if (e.aux[action]) this.pushAction(inputAction);
    }
    if (e.armSwitchOn && !this.isArmed) this.pushAction('arm-toggle');
    if (e.armSwitchOff && this.isArmed) this.pushAction('arm-toggle');
    if (e.modeSwitchChanged && this.enabled) this.settings.patch({ mode: this.gamepad.sample.modeSwitch });
  }

  private readAxes(): void {
    const a = this.axes;
    const b = this.bindings.axes;
    const h = this.held;
    a.throttleUp = anyHeld(h, b.throttleUp);
    a.throttleDown = anyHeld(h, b.throttleDown);
    a.throttleCut = anyHeld(h, b.throttleCut);
    a.boost = anyHeld(h, b.boost);
    a.yawLeft = anyHeld(h, b.yawLeft);
    a.yawRight = anyHeld(h, b.yawRight);
    a.rollLeft = anyHeld(h, b.rollLeft);
    a.rollRight = anyHeld(h, b.rollRight);
    a.pitchUp = anyHeld(h, b.pitchUp);
    a.pitchDown = anyHeld(h, b.pitchDown);
  }

  private readonly releaseKeys = (): void => {
    this.held.clear();
    this.kb.releaseSticks();
  };

  private readonly onKeyDown = (e: Event): void => {
    const k = e as KeyboardEvent;
    const action = this.compiled.action.get(k.code);
    if (action !== undefined && UI_ACTIONS.has(action)) {
      k.preventDefault();
      if (!k.repeat) this.pushAction(action);
      return;
    }
    if (!this.enabled || isFormField(k.target) || k.ctrlKey || k.metaKey || k.altKey) return;
    const isAxis = this.compiled.axis.has(k.code);
    if (action === undefined && !isAxis && !SWALLOWED_KEYS.has(k.code)) return;
    k.preventDefault();
    if (isAxis) this.held.add(k.code);
    if (action !== undefined && (!k.repeat || REPEATABLE_ACTIONS.has(action))) this.pushAction(action);
  };

  private readonly onKeyUp = (e: Event): void => {
    this.held.delete((e as KeyboardEvent).code);
  };
}
