import type { Bindings } from '../input/bindings';
import { el, keyCapsEl, setText, uid } from './dom';
import { startSummary } from './helpModel';
import { ControlGroup, type ControlHost } from './menuHost';
import { buildTimeControl } from './menuTime';
import { WorldCard } from './menuWorld';
import type { AppSettings } from './settingsSchema';
import type { PreviewState } from './trackPreviewModel';

const HERO_TEXT = 'Click to fly';

/**
 * The first screen: title, the one big button, the world to fly in (with a map of its track), the time of day, a controls reminder,
 * and the ways to Settings and to the track builder.
 */
export class StartPanel {
  readonly root: HTMLElement;
  private readonly group = new ControlGroup();
  private readonly hero: HTMLButtonElement;
  private readonly world: WorldCard;

  constructor(host: ControlHost, bindings: Bindings, onStart: () => void, onSettings: () => void, onBuilder?: () => void) {
    const title = el('h1', 'fpv-brand', 'FPV Sim');
    title.id = uid('fpv-title');
    this.hero = el('button', 'fpv-hero', HERO_TEXT);
    this.hero.type = 'button';
    this.hero.addEventListener('click', onStart);
    const head = el('header', 'fpv-start-head', el('div', 'fpv-start-brand', title, el('p', 'fpv-tagline', 'Racing quad simulator')), el('div', 'fpv-start-go', this.hero, el('p', 'fpv-hero-note', 'The mouse is captured while you fly.')));
    const keys = el('dl', 'fpv-keylist');
    for (const row of startSummary(bindings)) keys.append(el('div', 'fpv-keyrow', el('dt', '', keyCapsEl(row.keys)), el('dd', '', row.label)));
    this.world = new WorldCard(host);
    const time = this.group.add(buildTimeControl(host));
    const side = el('div', 'fpv-start-side',
      el('section', 'fpv-card', el('h3', 'fpv-section-title', 'Time of day'), time.root),
      el('section', 'fpv-card', el('h3', 'fpv-section-title', 'Controls'), keys));
    const settings = el('button', 'fpv-btn fpv-btn--default', 'Settings');
    settings.type = 'button';
    settings.addEventListener('click', onSettings);
    const foot = el('footer', 'fpv-start-foot', settings);
    if (onBuilder !== undefined) {
      const builder = el('button', 'fpv-btn fpv-btn--default', 'Track builder');
      builder.type = 'button';
      builder.title = 'Design a track from variables, race brains on it and keep leaderboards';
      builder.addEventListener('click', onBuilder);
      foot.append(builder);
    }
    foot.append(el('span', 'fpv-hint', 'Everything is adjustable in Settings; the track builder makes your own courses.'));
    this.root = el('section', 'fpv-panel fpv-start', head, el('div', 'fpv-start-cols', this.world.root, side), foot);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', title.id);
  }

  sync(settings: AppSettings): void {
    this.group.sync(settings);
    this.world.sync(settings);
  }

  /** The map and the build progress of the track the settings ask for. Flying waits until what is on screen is what the settings say. */
  setPreview(state: PreviewState): void {
    this.world.setPreview(state);
    const busy = state.status === 'working';
    this.hero.disabled = busy;
    setText(this.hero, busy ? 'Building the world...' : HERO_TEXT);
    if (!busy && document.activeElement === document.body && !this.root.hidden) this.hero.focus();
  }

  /** Every frame while the start screen is up: the clock readout follows the sim. */
  tick(): void {
    this.group.tick();
  }

  focus(): void {
    this.hero.focus();
    this.world.refresh();
  }
}
