/**
 * The DOM side of the app: menu, help and perf overlays, the OSD canvas renderer and a small notice line. Everything is
 * appended into `#ui`, which passes no pointer events except through the elements that ask for them.
 */
import { PRESETS } from '../sim/presets';
import { describeAirframe } from '../ui/airframe';
import { FinishPanel, type FinishChoice } from '../ui/finish';
import { HelpOverlay } from '../ui/help';
import { createHudModel, type HudModel } from '../ui/hud';
import { MenuUI } from '../ui/menu';
import type { MenuAction, MenuPreset } from '../ui/menuSchema';
import { OsdRenderer } from '../ui/osd';
import { LockHint, PauseBadge } from '../ui/overlays';
import { PerfOverlay } from '../ui/perf';
import type { PerfSource } from '../ui/perfModel';
import { PilotOptionsStore } from '../ui/pilotOptions';
import type { AppSettings } from '../ui/settingsSchema';
import type { PadView } from '../ui';

export interface AppUi {
  readonly menu: MenuUI;
  readonly help: HelpOverlay;
  readonly perf: PerfOverlay;
  readonly osd: OsdRenderer;
  readonly hud: HudModel;
  /** Pilot options (clock mode, race start, stick indicator), saved apart from the render settings. */
  readonly options: PilotOptionsStore;
  readonly finish: FinishPanel;
  readonly badge: PauseBadge;
  readonly lockHint: LockHint;
  /** What the result card's buttons do; the app sets it once it can. */
  onFinish: ((choice: FinishChoice) => void) | null;
  /** A short message (world rebuild failed, ...); replaces the previous one and fades after a few seconds. */
  notice(text: string, isError?: boolean): void;
}

export interface UiHandlers {
  onChange(patch: Partial<AppSettings>): void;
  onAction(action: MenuAction): void;
  perfSource: PerfSource;
}

/** Airframes the menu offers: only what `sim/presets.ts` really has, described from its own numbers. */
export function menuPresets(): MenuPreset[] {
  return Object.entries(PRESETS).map(([id, cfg]) => {
    const d = describeAirframe(cfg);
    return { id, label: `${d.title} (${d.detail})` };
  });
}

const NOTICE_MS = 5000;

function box(root: HTMLElement, id: string, css: string): HTMLDivElement {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = css;
  d.hidden = true;
  root.append(d);
  return d;
}

export function createUi(root: HTMLElement, osdCanvas: HTMLCanvasElement, settings: AppSettings, gamepad: PadView | null, h: UiHandlers): AppUi {
  const options = new PilotOptionsStore();
  // Built before the help sheet so the sheet paints over it.
  const lockHint = new LockHint(root);
  const menu = new MenuUI({ root, settings, presets: menuPresets(), gamepad, onChange: h.onChange, onAction: h.onAction, options });
  const help = new HelpOverlay({ root });
  const perf = new PerfOverlay({ root, source: h.perfSource });
  const toast = box(root, 'fpv-notice', 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:min(90vw,720px);padding:8px 14px;border-radius:6px;font:14px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7);background:rgba(20,24,30,.85);pointer-events:none;z-index:40');
  let timer = 0;
  const hud = createHudModel();
  hud.sticksEnabled = options.get().showSticks;
  const ui: AppUi = {
    menu, help, perf,
    osd: OsdRenderer.forCanvas(osdCanvas),
    hud, options,
    finish: new FinishPanel({ root, onChoice: (choice) => ui.onFinish?.(choice) }),
    badge: new PauseBadge(root),
    lockHint,
    onFinish: null,
    notice(text, isError = false) {
      toast.textContent = text;
      toast.style.background = isError ? 'rgba(150,30,30,.9)' : 'rgba(20,24,30,.85)';
      toast.hidden = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { toast.hidden = true; }, NOTICE_MS);
    },
  };
  return ui;
}
