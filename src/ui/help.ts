import { DEFAULT_BINDINGS, type Bindings } from '../input/bindings';
import { el, keyCapsEl, setHidden } from './dom';
import { buildHelp, keyCaps } from './helpModel';
import './ui.css';

export interface HelpOptions {
  /** The `#ui` element the overlay is appended to. */
  root: HTMLElement;
  bindings?: Bindings;
}

/**
 * The F1 cheat sheet. It is not modal: the flight goes on underneath and every key keeps working, so the
 * page behind it stays clickable except where the card sits.
 */
export class HelpOverlay {
  readonly element: HTMLElement;
  private readonly columns = el('div', 'fpv-help-columns');
  private readonly closeKeys = el('span', 'fpv-help-close');

  constructor(opts: HelpOptions) {
    const title = el('h2', 'fpv-title', 'Controls');
    const close = el('button', 'fpv-btn fpv-btn--small', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => this.hide());
    const head = el('header', 'fpv-help-head', title, el('span', 'fpv-spacer'), this.closeKeys, close);
    const card = el('section', 'fpv-panel fpv-help-card', head, el('div', 'fpv-help-scroll', this.columns));
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Controls');
    this.element = el('div', 'fpv-help', card);
    this.element.hidden = true;
    this.setBindings(opts.bindings ?? DEFAULT_BINDINGS);
    opts.root.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(): void {
    setHidden(this.element, false);
  }

  hide(): void {
    setHidden(this.element, true);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /** Rebuilds the sheet so it reflects the bindings in use. */
  setBindings(bindings: Bindings): void {
    this.columns.replaceChildren(
      ...buildHelp(bindings).map((s) =>
        el('section', 'fpv-help-section',
          el('h3', 'fpv-section-title', s.title),
          ...s.rows.map((r) => el('div', 'fpv-help-row', el('span', 'fpv-help-keys', keyCapsEl(r.keys)), el('span', 'fpv-help-label', r.label))))),
    );
    this.closeKeys.replaceChildren(keyCapsEl(keyCaps(bindings.actions['toggle-help'])), ' closes this');
  }

  dispose(): void {
    this.element.remove();
  }
}
