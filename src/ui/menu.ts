import { DEFAULT_BINDINGS, type Bindings } from '../input/bindings';
import { blurActive, el, setHidden } from './dom';
import type { ControlHost, PadView } from './menuHost';
import type { MenuAction, MenuPreset, TabId } from './menuSchema';
import { SettingsPanel, type SettingsOrigin } from './menuSettings';
import { StartPanel } from './menuStart';
import { buildTabs } from './menuTabs';
import { sanitizeSettings, type AppSettings } from './settingsSchema';
import './ui.css';

export type MenuScreen = 'none' | 'start' | 'settings';

export interface MenuOptions {
  /** The `#ui` element the menu is appended to. */
  root: HTMLElement;
  settings: AppSettings;
  /** Airframes offered under Simulation; the physics module knows the real list. */
  presets: readonly MenuPreset[];
  /** A setting changed. The app writes it to the settings store and calls `setSettings` with the result. */
  onChange(patch: Partial<AppSettings>): void;
  /** A button was pressed. `start` must request pointer lock in the same call: it runs inside the click. */
  onAction(action: MenuAction): void;
  /** Live gamepad for the calibration readout (`InputManager.gamepad`); the app keeps polling it while the menu is open. */
  gamepad?: PadView | null;
  bindings?: Bindings;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]';

/**
 * The start screen and the tabbed pause/settings dialog, built as DOM inside `#ui`. It keeps no state of its own beyond
 * what is on screen: settings arrive through `setSettings`, edits leave through `onChange`, buttons through `onAction`.
 */
export class MenuUI {
  readonly element: HTMLElement;
  private readonly start: StartPanel;
  private readonly panel: SettingsPanel;
  private settings: AppSettings;
  private current: MenuScreen = 'none';
  private origin: SettingsOrigin = 'pause';
  private frame = 0;

  constructor(private readonly opts: MenuOptions) {
    this.settings = opts.settings;
    const host: ControlHost = {
      settings: () => this.settings,
      change: (patch) => this.change(patch),
      action: (action) => opts.onAction(action),
      pad: () => opts.gamepad ?? null,
    };
    this.start = new StartPanel(host, opts.bindings ?? DEFAULT_BINDINGS, () => opts.onAction('start'), () => this.openSettings('start'));
    this.panel = new SettingsPanel(buildTabs(opts.presets), host, () => this.back());
    this.element = el('div', 'fpv-menu', this.start.root, this.panel.root);
    this.element.addEventListener('keydown', (e) => this.trapTab(e));
    this.paint();
    opts.root.append(this.element);
  }

  get screen(): MenuScreen {
    return this.current;
  }

  get visible(): boolean {
    return this.current !== 'none';
  }

  /** The store's settings changed: show them. */
  setSettings(settings: AppSettings): void {
    if (settings === this.settings) return;
    this.settings = settings;
    this.syncVisible();
  }

  showStart(): void {
    this.show('start');
  }

  /** The pause dialog with its Resume and Restart buttons, on `tab` when given. */
  showSettings(tab?: TabId): void {
    if (tab !== undefined) this.panel.selectTab(tab);
    this.openSettings('pause');
  }

  hide(): void {
    this.show('none');
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.element.remove();
  }

  private openSettings(origin: SettingsOrigin): void {
    this.origin = origin;
    this.panel.setOrigin(origin);
    this.show('settings');
  }

  /** The dialog's Back / Resume button: back to the start screen, or out of the menu. */
  private back(): void {
    if (this.origin === 'start') this.show('start');
    else this.opts.onAction('resume');
  }

  private change(patch: Partial<AppSettings>): void {
    this.settings = sanitizeSettings(patch, this.settings);
    this.syncVisible();
    this.opts.onChange(patch);
  }

  private syncVisible(): void {
    if (this.current === 'start') this.start.sync(this.settings);
    else if (this.current === 'settings') this.panel.sync(this.settings);
  }

  private show(screen: MenuScreen): void {
    if (screen === this.current) return;
    if (this.current === 'settings') this.panel.deactivate();
    this.current = screen;
    this.paint();
    this.syncVisible();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (screen === 'none') blurActive();
    else if (screen === 'start') this.start.focus();
    else {
      this.panel.focus();
      this.frame = requestAnimationFrame(this.loop);
    }
  }

  private paint(): void {
    setHidden(this.element, this.current === 'none');
    setHidden(this.start.root, this.current !== 'start');
    setHidden(this.panel.root, this.current !== 'settings');
  }

  private readonly loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    this.panel.tick();
  };

  /** Keeps Tab inside the open dialog so focus cannot wander onto the page underneath. */
  private trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const root = this.current === 'start' ? this.start.root : this.panel.root;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.tabIndex >= 0 && n.offsetParent !== null);
    if (items.length === 0) return;
    const edge = items[e.shiftKey ? 0 : items.length - 1];
    if (document.activeElement === edge) {
      e.preventDefault();
      items[e.shiftKey ? items.length - 1 : 0].focus();
    }
  }
}
