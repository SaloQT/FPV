import { el, setHidden, setText, uid } from './dom';
import { buildControl } from './menuControls';
import { ControlGroup, type ControlHost } from './menuHost';
import type { MenuTab, TabId } from './menuSchema';
import type { AppSettings } from './settingsSchema';

export type SettingsOrigin = 'pause' | 'start';

interface TabView {
  id: TabId;
  button: HTMLButtonElement;
  panel: HTMLElement;
  group: ControlGroup;
}

function footerButton(label: string, tone: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `fpv-btn fpv-btn--${tone}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** The tabbed settings dialog: opened from the pause menu or from the start screen. */
export class SettingsPanel {
  readonly root: HTMLElement;
  private readonly tabs: TabView[] = [];
  private readonly title = el('h2', 'fpv-title');
  private readonly primary: HTMLButtonElement;
  private readonly restart: HTMLButtonElement;
  private active = 0;

  constructor(tabs: readonly MenuTab[], private readonly host: ControlHost, private readonly onBack: () => void) {
    const list = el('div', 'fpv-tabs');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Settings categories');
    const panels = el('div', 'fpv-tabpanels');
    for (const t of tabs) {
      const view = this.buildTab(t);
      this.tabs.push(view);
      list.append(view.button);
      panels.append(view.panel);
    }
    list.addEventListener('keydown', (e) => this.onTabKey(e));
    this.primary = footerButton('Resume', 'primary', onBack);
    this.restart = footerButton('Restart run', 'default', () => host.action('restart'));
    const reset = footerButton('Reset settings', 'danger', () => host.action('reset-settings'));
    const foot = el('footer', 'fpv-panel-foot', reset, el('span', 'fpv-spacer'), this.restart, this.primary);
    const head = el('header', 'fpv-panel-head', this.title);
    this.title.id = uid('fpv-title');
    this.root = el('section', 'fpv-panel fpv-settings', head, list, panels, foot);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', this.title.id);
    this.select(0, false);
  }

  private buildTab(t: MenuTab): TabView {
    const id = uid('fpv-tab');
    const button = el('button', 'fpv-tab', t.label);
    button.type = 'button';
    button.id = id;
    button.setAttribute('role', 'tab');
    const panel = el('div', 'fpv-tabpanel');
    panel.id = `${id}-panel`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', id);
    button.setAttribute('aria-controls', panel.id);
    const group = new ControlGroup();
    for (const s of t.sections) {
      const body = el('div', 'fpv-section-body');
      for (const c of s.controls) body.append(group.add(buildControl(c, this.host)).root);
      panel.append(el('section', 'fpv-section', el('h3', 'fpv-section-title', s.title), body));
    }
    const index = this.tabs.length;
    button.addEventListener('click', () => this.select(index, false));
    return { id: t.id, button, panel, group };
  }

  private onTabKey(e: KeyboardEvent): void {
    const n = this.tabs.length;
    let next: number;
    switch (e.key) {
      case 'ArrowRight': next = this.active + 1; break;
      case 'ArrowLeft': next = this.active - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = n - 1; break;
      default: return;
    }
    e.preventDefault();
    this.select((next + n) % n, true);
  }

  /** Shows one tab; `focus` moves the keyboard focus to its button. */
  select(index: number, focus: boolean): void {
    this.tabs[this.active].group.deactivate();
    this.active = index;
    this.tabs.forEach((t, i) => {
      const on = i === index;
      t.button.setAttribute('aria-selected', String(on));
      t.button.tabIndex = on ? 0 : -1;
      t.button.classList.toggle('fpv-tab--on', on);
      setHidden(t.panel, !on);
    });
    this.tabs[index].group.sync(this.host.settings());
    this.tabs[index].button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focus) this.tabs[index].button.focus();
  }

  /** Follows `id` when it is one of the tabs. */
  selectTab(id: TabId): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i >= 0) this.select(i, false);
  }

  setOrigin(origin: SettingsOrigin): void {
    setText(this.title, origin === 'start' ? 'Settings' : 'Paused');
    setText(this.primary, origin === 'start' ? 'Back' : 'Resume');
    setHidden(this.restart, origin === 'start');
  }

  /** Writes new settings into the visible tab; the others catch up when they are shown. */
  sync(settings: AppSettings): void {
    this.tabs[this.active].group.sync(settings);
  }

  tick(): void {
    this.tabs[this.active].group.tick();
  }

  deactivate(): void {
    this.tabs[this.active].group.deactivate();
  }

  /** Focus for keyboard users: the selected tab. */
  focus(): void {
    this.tabs[this.active].button.focus();
    this.tabs[this.active].button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
