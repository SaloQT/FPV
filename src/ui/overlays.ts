import { el, keyCapsEl, setHidden, setText } from './dom';
import './flow.css';

/** Small label under the OSD's PAUSED: the sim time and the sun or moon, so the frozen sky is explained. */
export class PauseBadge {
  readonly element: HTMLElement;
  private readonly time = el('strong', '', '');
  private readonly rest = el('span', '', '');

  constructor(root: HTMLElement) {
    this.element = el('div', 'fpv-badge', this.time, this.rest);
    this.element.hidden = true;
    root.append(this.element);
  }

  /** `time` is the clock reading ("14:32"), `rest` the sky and the way back ("sun 48°  ·  P resumes"). */
  show(time: string, rest: string): void {
    setText(this.time, time);
    setText(this.rest, rest);
    setHidden(this.element, false);
  }

  hide(): void {
    setHidden(this.element, true);
  }
}

/** Shown while flying with the mouse free: the first click on the picture captures it, which is what the roll and pitch need. */
export class LockHint {
  readonly element: HTMLElement;

  constructor(root: HTMLElement) {
    this.element = el('div', 'fpv-hint-lock', 'Click the picture to capture the mouse (roll and pitch).  ', keyCapsEl(['Esc']), ' lets go.');
    this.element.hidden = true;
    root.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  set visible(on: boolean) {
    setHidden(this.element, !on);
  }
}
