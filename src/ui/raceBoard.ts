/**
 * The spectator race leaderboard: a small table in the top right corner, one row per racer in race order. A big race shows
 * its leaders and the followed quad, the rest as a count, and a line per brain that flies several quads.
 */
import { el, setHidden, setText } from './dom';
import './brains.css';

export interface BoardRow {
  /** Race position, 1 for the leader. */
  place: number;
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

/** A brain flying several quads of the race. */
export interface BoardTeam {
  name: string;
  colour: string;
  /** Its quads in the race. */
  count: number;
  /** Best race position of any of them, 1 for the leader. */
  best: number;
  /** How many of them have finished. */
  finished: number;
}

const ordinal = (n: number): string => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
};

export class RaceBoard {
  private readonly root: HTMLElement;
  private readonly title = el('div', 'fpv-board-title', 'Race');
  private readonly teams = el('ul', 'fpv-board-teams');
  private readonly body = el('ol', 'fpv-board-rows');
  private readonly more = el('div', 'fpv-board-more', '');
  private osdScale = 1;

  constructor(parent: HTMLElement) {
    this.root = el('aside', 'fpv-board', this.title, this.teams, this.body, this.more);
    this.root.setAttribute('aria-live', 'polite');
    setHidden(this.root, true);
    parent.append(this.root);
  }

  /** `more`: racers left out of `rows`. */
  show(title: string, rows: readonly BoardRow[], teams: readonly BoardTeam[] = [], more = 0): void {
    setText(this.title, title);
    fit(this.teams, teams.length, () => el('li', 'fpv-board-team', el('span', 'fpv-board-dot'), el('span', 'fpv-board-name'), el('span', 'fpv-board-progress')));
    teams.forEach((t, i) => {
      const [dot, name, info] = Array.from((this.teams.children[i] as HTMLElement).children) as HTMLElement[];
      dot.style.background = t.colour;
      setText(name, `${t.name} ×${t.count}`);
      setText(info, `best ${ordinal(t.best)} · ${t.finished}/${t.count} finished`);
    });
    setHidden(this.teams, teams.length === 0);
    fit(this.body, rows.length, () => el('li', 'fpv-board-row', el('span', 'fpv-board-place'), el('span', 'fpv-board-dot'), el('span', 'fpv-board-name'), el('span', 'fpv-board-progress'), el('span', 'fpv-board-time')));
    rows.forEach((r, i) => {
      const li = this.body.children[i] as HTMLElement;
      const [place, dot, name, progress, time] = Array.from(li.children) as HTMLElement[];
      setText(place, String(r.place));
      dot.style.background = r.colour;
      setText(name, r.name);
      setText(progress, r.progress);
      setText(time, r.time);
      li.classList.toggle('fpv-board-row--followed', r.followed);
    });
    setText(this.more, more > 0 ? `+ ${more} more` : '');
    setHidden(this.more, more <= 0);
    setHidden(this.root, false);
  }

  hide(): void {
    setHidden(this.root, true);
  }

  /** Keeps the board under the OSD's race panel, which grows with the OSD scale. */
  place(osdScale: number): void {
    if (this.osdScale === osdScale) return;
    this.osdScale = osdScale;
    this.root.style.setProperty('--fpv-osd-scale', String(osdScale));
  }
}

/** Adds or removes children of `list` until it has `n`. */
function fit(list: HTMLElement, n: number, make: () => HTMLElement): void {
  while (list.children.length > n) list.lastElementChild?.remove();
  while (list.children.length < n) list.append(make());
}
