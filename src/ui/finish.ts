import { el, setHidden } from './dom';
import { buildFinishView, type FinishBoardView, type FinishView } from './finishModel';
import type { RaceSnapshot } from '../game/gateTimer';
import './flow.css';
import './builder.css';

export type FinishChoice = 'restart' | 'new-track' | 'menu' | 'builder';

export interface FinishOptions {
  /** The `#ui` element the panel is appended to. */
  root: HTMLElement;
  /** A button (or its key) was used. `restart` and `new-track` run inside a user gesture, so they may grab the pointer. */
  onChoice(choice: FinishChoice): void;
}

function stat(label: string, value: string): HTMLElement {
  return el('div', 'fpv-finish-stat', el('span', 'fpv-finish-label', label), el('strong', 'fpv-finish-value', value));
}

/**
 * The result card after the last gate: total and best lap, every lap against the best, the best lap's gate-to-gate times as
 * bars, the track's leaderboard, and the ways on (back to the track builder when the track came from it). It is not a backdrop:
 * the quad hovering behind it stays in view, and R, N and B work as keys.
 */
export class FinishPanel {
  readonly element: HTMLElement;
  private readonly body = el('div', 'fpv-finish-body');
  private readonly restart: HTMLButtonElement;
  private readonly builder: HTMLButtonElement;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyR') this.pick(e, 'restart');
    else if (e.code === 'KeyN') this.pick(e, 'new-track');
    else if (e.code === 'KeyB' && !this.builder.hidden) this.pick(e, 'builder');
  };

  constructor(private readonly opts: FinishOptions) {
    const title = el('h2', 'fpv-finish-title', 'Finished');
    this.restart = this.button('Restart run  (R)', 'primary', 'restart');
    this.builder = this.button('Back to builder  (B)', 'default', 'builder');
    this.builder.hidden = true;
    const foot = el('footer', 'fpv-finish-foot', this.restart, this.button('New track  (N)', 'default', 'new-track'), this.builder, el('span', 'fpv-spacer'), this.button('Menu', 'default', 'menu'));
    const card = el('section', 'fpv-finish-card', title, this.body, foot);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', (title.id = 'fpv-finish-title'));
    this.element = el('div', 'fpv-finish', card);
    this.element.hidden = true;
    opts.root.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** Shows the result of `race` (and the track's leaderboard) and puts the keyboard focus on Restart, so Enter goes on at once. */
  show(race: RaceSnapshot, board: FinishBoardView | null = null): void {
    this.render(buildFinishView(race), board);
    setHidden(this.builder, board === null || !board.backToBuilder);
    setHidden(this.element, false);
    window.addEventListener('keydown', this.onKey, true);
    this.restart.focus({ preventScroll: true });
  }

  hide(): void {
    window.removeEventListener('keydown', this.onKey, true);
    setHidden(this.element, true);
  }

  dispose(): void {
    this.hide();
    this.element.remove();
  }

  private button(label: string, tone: string, choice: FinishChoice): HTMLButtonElement {
    const b = el('button', `fpv-btn fpv-btn--${tone}`, label);
    b.type = 'button';
    b.addEventListener('click', () => this.opts.onChoice(choice));
    return b;
  }

  private pick(e: KeyboardEvent, choice: FinishChoice): void {
    e.preventDefault();
    e.stopPropagation();
    this.opts.onChoice(choice);
  }

  private render(v: FinishView, board: FinishBoardView | null): void {
    const stats = el('div', 'fpv-finish-stats', stat('Total time', v.total), stat(v.bestLabel, v.best), stat('Gates missed', v.missed));
    const children: HTMLElement[] = [stats];
    if (v.rows.length > 0) {
      const rows = v.rows.map((r) => {
        const row = el('div', r.best ? 'fpv-finish-row fpv-finish-row--best' : 'fpv-finish-row', el('span', '', r.label), el('span', 'fpv-finish-time', r.time), el('span', 'fpv-finish-delta', r.best ? 'best' : r.delta));
        return row;
      });
      children.push(el('div', 'fpv-finish-laps', ...rows));
    }
    if (v.splits.length > 1) {
      const bars = v.splits.map((s) => {
        const bar = el('div', s.slowest ? 'fpv-finish-bar fpv-finish-bar--slow' : 'fpv-finish-bar');
        bar.style.height = `${Math.max(6, Math.round(s.ratio * 100))}%`;
        const col = el('div', 'fpv-finish-col', bar, el('span', 'fpv-finish-gate', s.label));
        col.title = `${s.label}: ${s.segment} from the previous gate, ${s.cumulative} into the lap`;
        return col;
      });
      children.push(el('h3', 'fpv-section-title', 'Best lap, gate to gate'), el('div', 'fpv-finish-bars', ...bars));
    }
    if (board !== null && board.rows.length > 0) {
      const rows = board.rows.map((r) => el('div', r.fresh ? 'fpv-finish-row fpv-finish-row--best fpv-finish-board-row' : 'fpv-finish-row fpv-finish-board-row',
        el('span', 'fpv-finish-rank', String(r.rank)), el('span', '', r.kind === 'you' ? r.pilot : `${r.pilot} (AI)`), el('span', 'fpv-finish-time', r.total), el('span', 'fpv-finish-delta', r.date)));
      const title = el('h3', 'fpv-section-title', 'Leaderboard');
      title.title = board.title;
      children.push(title);
      if (board.headline.length > 0) children.push(el('p', 'fpv-finish-headline', board.headline));
      children.push(el('div', 'fpv-finish-laps fpv-finish-board', ...rows));
    }
    this.body.replaceChildren(...children);
  }
}
