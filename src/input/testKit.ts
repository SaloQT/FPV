import { InputManager, type InputManagerOptions } from './inputManager';
import { defaultGamepadConfig, type PadLike } from './gamepadMap';
import type { InputSettings, InputSettingsStore } from './types';

/** Node has no DOM: these minimal stand-ins let InputManager tests dispatch real Events without jsdom. */
export class FakeDocument extends EventTarget {
  pointerLockElement: unknown = null;
  exitCalls = 0;

  exitPointerLock(): void {
    this.exitCalls++;
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  }
}

export class FakeCanvas extends EventTarget {
  lockRequests = 0;
  constructor(readonly ownerDocument: FakeDocument) {
    super();
  }

  requestPointerLock(): Promise<void> {
    this.lockRequests++;
    this.ownerDocument.pointerLockElement = this;
    this.ownerDocument.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  }
}

export function makeSettings(over: Partial<InputSettings> = {}): InputSettingsStore & { patches: Partial<InputSettings>[] } {
  let cur: InputSettings = { mode: 'acro', mouseSensitivity: 1, mouseCentering: 0.6, mouseExpo: 0, mouseDeadzone: 0, invertY: false, gamepad: defaultGamepadConfig(), ...over };
  const patches: Partial<InputSettings>[] = [];
  return {
    patches,
    get: () => cur,
    patch: (p) => {
      patches.push(p);
      cur = { ...cur, ...p };
    },
  };
}

export function keyEvent(type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false }, extra);
  return e;
}

export function moveEvent(dx: number, dy: number, buttons = 0, type = 'mousemove'): Event {
  return Object.assign(new Event(type), { movementX: dx, movementY: dy, buttons });
}

export function padWith(axes: number[], pressed: number[] = []): PadLike {
  return { axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: 0 })), mapping: '', id: 'radio', connected: true };
}

export interface Rig {
  input: InputManager;
  win: EventTarget;
  doc: FakeDocument;
  canvas: FakeCanvas;
  settings: ReturnType<typeof makeSettings>;
  pads: (PadLike | null)[];
  clock: { t: number };
  press(code: string, extra?: Record<string, unknown>): Event;
  release(code: string): void;
  /** Polls `seconds` of frames at 60 Hz and returns the last stick. */
  run(seconds: number): ReturnType<InputManager['poll']>;
  lock(): void;
}

export function makeRig(over: Partial<InputSettings> = {}, opts: InputManagerOptions = {}): Rig {
  const win = new EventTarget();
  const doc = new FakeDocument();
  const canvas = new FakeCanvas(doc);
  const settings = makeSettings(over);
  const pads: (PadLike | null)[] = [null];
  const clock = { t: 1000 };
  const input = new InputManager(win as unknown as Window, canvas as unknown as HTMLCanvasElement, settings, { pads: () => pads, now: () => clock.t, ...opts });
  const dispatch = (e: Event): Event => (win.dispatchEvent(e), e);
  return {
    input, win, doc, canvas, settings, pads, clock,
    press: (code, extra) => dispatch(keyEvent('keydown', code, extra)),
    release: (code) => void dispatch(keyEvent('keyup', code)),
    run(seconds) {
      let stick = input.poll(0);
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        clock.t += 1000 / 60;
        stick = input.poll(1 / 60);
      }
      return stick;
    },
    lock() {
      canvas.dispatchEvent(new Event('click'));
      clock.t += 100;
    },
  };
}
