import { DEFAULT_BINDINGS, type Bindings } from '../input/bindings';
import { skyReadout, hourOf } from './clockModel';
import { blurActive, el, setHidden, setText } from './dom';
import { extendTabs } from './menuExtras';
import type { ControlHost, LiveSky, PadView } from './menuHost';
import type { MenuAction, MenuPreset, TabId } from './menuSchema';
import { SettingsPanel, type SettingsOrigin } from './menuSettings';
import { StartPanel } from './menuStart';
import { buildTabs } from './menuTabs';
import { PilotOptionsStore } from './pilotOptions';
import { sanitizeSettings, type AppSettings } from './settingsSchema';
import type { PreviewState } from './trackPreviewModel';
import './ui.css';
import './flow.css';

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
  /** The pilot options the clock, race-start and stick-indicator controls edit; the app listens to the same store. */
  options?: PilotOptionsStore;
  /** The address share links are built on; defaults to the page's own. */
  shareBase?: () => string;
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
  private live: (() => LiveSky | null) | null = null;
  private readonly options: PilotOptionsStore;
  private readonly clock = el('div', 'fpv-menu-clock');
  private readonly clockWhen = el('strong', 'fpv-menu-clock-time', '');
  private readonly clockSky = el('span', 'fpv-menu-clock-sky', '');

  constructor(private readonly opts: MenuOptions) {
    this.settings = opts.settings;
    this.options = opts.options ?? new PilotOptionsStore(null);
    const host: ControlHost = {
      settings: () => this.settings,
      change: (patch) => this.change(patch),
      action: (action) => opts.onAction(action),
      pad: () => opts.gamepad ?? null,
      options: () => this.options.get(),
      patchOptions: (patch) => this.options.patch(patch),
      onOptions: (fn) => this.options.subscribe(fn),
      live: () => this.live?.() ?? null,
      shareBase: opts.shareBase ?? (() => location.href),
    };
    this.start = new StartPanel(host, opts.bindings ?? DEFAULT_BINDINGS, () => opts.onAction('start'), () => this.openSettings('start'));
    this.panel = new SettingsPanel(extendTabs(buildTabs(opts.presets), opts.presets), host, () => this.back());
    this.clock.append(this.clockWhen, this.clockSky);
    this.element = el('div', 'fpv-menu', this.start.root, this.panel.root, this.clock);
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

  /** Connects the running sim: the clock readouts and the time controls read the live sim time and sky from it. */
  setLive(live: (() => LiveSky | null) | null): void {
    this.live = live;
  }

  /** The track the start screen's map shows, or how far the next one is. */
  setPreview(state: PreviewState): void {
    this.start.setPreview(state);
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
    if (screen === 'none') {
      blurActive();
      return;
    }
    if (screen === 'start') this.start.focus();
    else this.panel.focus();
    this.frame = requestAnimationFrame(this.loop);
  }

  private paint(): void {
    setHidden(this.element, this.current === 'none');
    setHidden(this.start.root, this.current !== 'start');
    setHidden(this.panel.root, this.current !== 'settings');
    if (this.current !== 'settings') setHidden(this.clock, true);
  }

  private readonly loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    if (this.current === 'start') this.start.tick();
    else this.panel.tick();
    this.paintClock();
  };

  /** The sim time and the sun or moon over the pause dialog, so the sky is never a mystery behind the glass. */
  private paintClock(): void {
    const live = this.live?.() ?? null;
    const show = this.current === 'settings' && live !== null;
    setHidden(this.clock, !show);
    if (!show || live === null) return;
    const r = skyReadout(hourOf(live.timeMs, this.settings.observer.longitudeDeg), live);
    setText(this.clockWhen, r.time);
    setText(this.clockSky, r.text.slice(r.time.length).trim());
  }

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
