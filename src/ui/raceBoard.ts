/** The spectator race leaderboard: a small table in the top right corner, one row per racer in race order. */
import { el, setHidden, setText } from './dom';
import './brains.css';

export interface BoardRow {
  name: string;
  /** CSS colour of the racer's LEDs. */
  colour: string;
  /** "Lap 2/3 · gate 5/12", "Finished", ... */
  progress: string;
  /** Race time or result, already formatted. */
  time: string;
  /** The camera rides with this one. */
  followed: boolean;
}

export class RaceBoard {
  private readonly root: HTMLElement;
  private readonly title = el('div', 'fpv-board-title', 'Race');
  private readonly body = el('ol', 'fpv-board-rows');

  constructor(parent: HTMLElement) {
    this.root = el('aside', 'fpv-board', this.title, this.body);
    this.root.setAttribute('aria-live', 'polite');
    setHidden(this.root, true);
    parent.append(this.root);
  }

  show(title: string, rows: readonly BoardRow[]): void {
    setText(this.title, title);
    while (this.body.children.length > rows.length) this.body.lastElementChild?.remove();
    while (this.body.children.length < rows.length) {
      this.body.append(el('li', 'fpv-board-row', el('span', 'fpv-board-dot'), el('span', 'fpv-board-name'), el('span', 'fpv-board-progress'), el('span', 'fpv-board-time')));
    }
    rows.forEach((r, i) => {
      const li = this.body.children[i] as HTMLElement;
      const [dot, name, progress, time] = Array.from(li.children) as HTMLElement[];
      dot.style.background = r.colour;
      setText(name, r.name);
      setText(progress, r.progress);
      setText(time, r.time);
      li.classList.toggle('fpv-board-row--followed', r.followed);
    });
    setHidden(this.root, false);
  }

  hide(): void {
    setHidden(this.root, true);
  }
}
