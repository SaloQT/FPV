import type { PadSample } from '../input/gamepadMap';
import type { SkyBodies } from './clockModel';
import { el, uid } from './dom';
import type { Control, MenuAction } from './menuSchema';
import type { PilotOptions } from './pilotOptions';
import type { AppSettings } from './settingsSchema';

/** The live pad state the calibration readout draws; `GamepadInput` satisfies it. */
export interface PadView {
  readonly connected: boolean;
  readonly padId: string;
  readonly raw: ArrayLike<number>;
  readonly sample: Readonly<Pick<PadSample, 'roll' | 'pitch' | 'yaw' | 'throttleDirect' | 'profile'>>;
}

/** The running sim as the menu shows it: the sim clock and where the sun and moon stand. */
export interface LiveSky extends SkyBodies {
  /** Simulated time, ms since the epoch (UTC). The settings' `timeMs` goes stale while the clock runs. */
  timeMs: number;
}

/** What a control needs from the menu: the current settings and the two ways to talk to the app. */
export interface ControlHost {
  settings(): AppSettings;
  change(patch: Partial<AppSettings>): void;
  action(action: MenuAction): void;
  pad(): PadView | null;
  /** The pilot options (clock mode, race start, stick indicator); `onOptions` listens for changes and returns the unsubscribe. */
  options(): PilotOptions;
  patchOptions(patch: Partial<PilotOptions>): void;
  onOptions(fn: (o: PilotOptions) => void): () => void;
  /** Live sim clock and sky, or null while the app has not connected it. */
  live(): LiveSky | null;
  /** A link that opens the world the pilot is looking at: the same terrain and the same track. */
  shareLink(): string;
}

export interface BuiltControl {
  root: HTMLElement;
  sync(settings: AppSettings): void;
  /** Called every frame while the control is on screen. */
  tick?(): void;
  /** Called when the control leaves the screen. */
  deactivate?(): void;
}

export interface Row {
  root: HTMLElement;
  id: string;
  /** Where the control itself goes; the label and hint sit in the column beside it. */
  ctl: HTMLElement;
  /** Points an input at the row's hint for screen readers. */
  describe(input: HTMLElement): void;
}

/** The two-column row every setting uses: label and hint on the left, the control on the right. */
export function rowFor(c: Pick<Control, 'label' | 'hint'>, kind: string): Row {
  const id = uid('fpv-c');
  const root = el('div', `fpv-row fpv-row--${kind}`);
  const label = el('label', 'fpv-label', c.label);
  label.htmlFor = id;
  const text = el('div', 'fpv-row-text', label);
  const ctl = el('div', 'fpv-row-ctl');
  let hintId = '';
  if (c.hint !== undefined) {
    hintId = `${id}-hint`;
    const hint = el('p', 'fpv-hint', c.hint);
    hint.id = hintId;
    text.append(hint);
  }
  root.append(text, ctl);
  return { root, id, ctl, describe: (input) => { if (hintId.length > 0) input.setAttribute('aria-describedby', hintId); } };
}

/** Controls that share a screen; they are re-synced when their settings object is out of date. */
export class ControlGroup {
  private readonly items: BuiltControl[] = [];
  private synced: AppSettings | null = null;

  add(item: BuiltControl): BuiltControl {
    this.items.push(item);
    return item;
  }

  /** Writes `settings` into the controls unless they already show exactly this object. */
  sync(settings: AppSettings): void {
    if (this.synced === settings) return;
    this.synced = settings;
    for (const i of this.items) i.sync(settings);
  }

  tick(): void {
    for (const i of this.items) i.tick?.();
  }

  deactivate(): void {
    for (const i of this.items) i.deactivate?.();
  }
}
