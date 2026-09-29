/**
 * The DOM side of the app: menu, help and perf overlays, the OSD canvas renderer and a small notice line. Everything is
 * appended into `#ui`, which passes no pointer events except through the elements that ask for them.
 */
import { PRESETS } from '../sim/presets';
import { HelpOverlay } from '../ui/help';
import { createHudModel, type HudModel } from '../ui/hud';
import { MenuUI } from '../ui/menu';
import type { MenuAction, MenuPreset } from '../ui/menuSchema';
import { OsdRenderer } from '../ui/osd';
import { PerfOverlay } from '../ui/perf';
import type { PerfSource } from '../ui/perfModel';
import type { AppSettings } from '../ui/settingsSchema';
import type { PadView } from '../ui';

export interface AppUi {
  readonly menu: MenuUI;
  readonly help: HelpOverlay;
  readonly perf: PerfOverlay;
  readonly osd: OsdRenderer;
  readonly hud: HudModel;
  /** A short message (world rebuild failed, ...); replaces the previous one and fades after a few seconds. */
  notice(text: string, isError?: boolean): void;
  /** A fatal panel: the app stopped and says why. */
  fatal(title: string, detail: string): void;
}

export interface UiHandlers {
  onChange(patch: Partial<AppSettings>): void;
  onAction(action: MenuAction): void;
  perfSource: PerfSource;
}

/** Airframes the menu offers: only what `sim/presets.ts` really has. */
export function menuPresets(): MenuPreset[] {
  return Object.entries(PRESETS).map(([id, cfg]) => ({ id, label: cfg.name }));
}

const NOTICE_MS = 5000;
/** No `display` here: an inline display would override the `hidden` attribute; `fillMessage` sets it when the panel is shown. */
const FATAL_CSS = 'position:fixed;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;font:16px system-ui,sans-serif;color:#fff;background:rgba(10,12,16,.92);pointer-events:auto;z-index:60';

function fillMessage(panel: HTMLElement, title: string, detail: string): void {
  const t = document.createElement('h2');
  t.textContent = title;
  const p = document.createElement('p');
  p.textContent = detail;
  p.style.cssText = 'max-width:640px;opacity:.85;white-space:pre-wrap';
  panel.replaceChildren(t, p);
  panel.style.display = 'flex';
  panel.hidden = false;
}

/** A full-screen message for problems before the UI exists (no WebGPU, the renderer could not start). */
export function showMessage(root: HTMLElement, title: string, detail: string): void {
  const panel = (root.querySelector('#fpv-fatal') as HTMLElement | null) ?? box(root, 'fpv-fatal', FATAL_CSS);
  fillMessage(panel, title, detail);
}

function box(root: HTMLElement, id: string, css: string): HTMLDivElement {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = css;
  d.hidden = true;
  root.append(d);
  return d;
}

export function createUi(root: HTMLElement, osdCanvas: HTMLCanvasElement, settings: AppSettings, gamepad: PadView | null, h: UiHandlers): AppUi {
  const menu = new MenuUI({ root, settings, presets: menuPresets(), gamepad, onChange: h.onChange, onAction: h.onAction });
  const help = new HelpOverlay({ root });
  const perf = new PerfOverlay({ root, source: h.perfSource });
  const toast = box(root, 'fpv-notice', 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:min(90vw,720px);padding:8px 14px;border-radius:6px;font:14px system-ui,sans-serif;color:#fff;background:rgba(20,24,30,.85);pointer-events:none;z-index:40');
  const fatal = box(root, 'fpv-fatal', FATAL_CSS);
  let timer = 0;
  return {
    menu, help, perf,
    osd: OsdRenderer.forCanvas(osdCanvas),
    hud: createHudModel(),
    notice(text, isError = false) {
      toast.textContent = text;
      toast.style.background = isError ? 'rgba(150,30,30,.9)' : 'rgba(20,24,30,.85)';
      toast.hidden = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { toast.hidden = true; }, NOTICE_MS);
    },
    fatal(title, detail) {
      fillMessage(fatal, title, detail);
    },
  };
}
