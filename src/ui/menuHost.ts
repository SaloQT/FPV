import type { PadSample } from '../input/gamepadMap';
import { el, uid } from './dom';
import type { Control, MenuAction } from './menuSchema';
import type { AppSettings } from './settingsSchema';

/** The live pad state the calibration readout draws; `GamepadInput` satisfies it. */
export interface PadView {
  readonly connected: boolean;
  readonly padId: string;
  readonly raw: ArrayLike<number>;
  readonly sample: Readonly<Pick<PadSample, 'roll' | 'pitch' | 'yaw' | 'throttleDirect' | 'profile'>>;
}

/** What a control needs from the menu: the current settings and the two ways to talk to the app. */
export interface ControlHost {
  settings(): AppSettings;
  change(patch: Partial<AppSettings>): void;
  action(action: MenuAction): void;
  pad(): PadView | null;
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
