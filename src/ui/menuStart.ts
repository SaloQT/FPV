import type { Bindings } from '../input/bindings';
import { el, keyCapsEl, uid } from './dom';
import { startSummary } from './helpModel';
import { buildControl } from './menuControls';
import { ControlGroup, type ControlHost } from './menuHost';
import { button } from './menuSchema';
import { TRACK_SETUP } from './menuTabs';
import type { AppSettings } from './settingsSchema';

/** The first screen: title, the one big button, a controls reminder and the world to fly in. */
export class StartPanel {
  readonly root: HTMLElement;
  private readonly group = new ControlGroup();
  private readonly hero: HTMLButtonElement;

  constructor(host: ControlHost, bindings: Bindings, onStart: () => void, onSettings: () => void) {
    const title = el('h1', 'fpv-brand', 'FPV Sim');
    title.id = uid('fpv-title');
    const head = el('header', 'fpv-start-head', title, el('p', 'fpv-tagline', 'Racing quad simulator'));
    this.hero = el('button', 'fpv-hero', 'Click to fly');
    this.hero.type = 'button';
    this.hero.addEventListener('click', onStart);
    const note = el('p', 'fpv-hero-note', 'The mouse is captured while you fly.');
    const keys = el('dl', 'fpv-keylist');
    for (const row of startSummary(bindings)) keys.append(el('div', 'fpv-keyrow', el('dt', '', keyCapsEl(row.keys)), el('dd', '', row.label)));
    const world = el('div', 'fpv-start-world');
    for (const c of [...TRACK_SETUP, button('new-track', 'Generate track', 'new-track')]) world.append(this.group.add(buildControl(c, host)).root);
    const settings = el('button', 'fpv-btn fpv-btn--default', 'Settings');
    settings.type = 'button';
    settings.addEventListener('click', onSettings);
    const cols = el('div', 'fpv-start-cols',
      el('section', 'fpv-card', el('h3', 'fpv-section-title', 'Controls'), keys),
      el('section', 'fpv-card', el('h3', 'fpv-section-title', 'World'), world));
    const foot = el('footer', 'fpv-start-foot', settings, el('span', 'fpv-hint', 'Everything is adjustable in Settings.'));
    this.root = el('section', 'fpv-panel fpv-start', head, this.hero, note, cols, foot);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', title.id);
  }

  sync(settings: AppSettings): void {
    this.group.sync(settings);
  }

  focus(): void {
    this.hero.focus();
  }
}
