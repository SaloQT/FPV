import { el, setHidden, setText } from './dom';
import './ui.css';
import './flow.css';

const FADE_MS = 320;

/** A full-screen progress bar shown while the renderer and the world initialise. */
export class LoadingOverlay {
  readonly element: HTMLElement;
  private readonly stageText = el('p', 'fpv-loading-stage', 'Starting');
  private readonly fill = el('div', 'fpv-loading-fill');
  private readonly bar = el('div', 'fpv-loading-bar', this.fill);
  private fadeTimer = 0;

  constructor(root: HTMLElement) {
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-label', 'Loading');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', '100');
    this.bar.setAttribute('aria-valuenow', '0');
    this.element = el('div', 'fpv-loading', el('h1', 'fpv-brand', 'FPV Sim'), this.bar, this.stageText);
    this.element.setAttribute('aria-live', 'polite');
    root.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** `fraction` is 0..1 overall progress; `stage` says what is happening. Reopens the overlay if it was hidden. */
  setProgress(stage: string, fraction: number): void {
    window.clearTimeout(this.fadeTimer);
    this.element.classList.remove('fpv-loading--out');
    setHidden(this.element, false);
    const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    this.fill.style.transform = `scaleX(${f})`;
    this.bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    setText(this.stageText, stage);
  }

  /** Fades the overlay out and removes it from layout. */
  hide(): void {
    if (!this.visible) return;
    this.element.classList.add('fpv-loading--out');
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => setHidden(this.element, true), FADE_MS);
  }

  dispose(): void {
    window.clearTimeout(this.fadeTimer);
    this.element.remove();
  }
}
