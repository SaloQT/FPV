import { errorText, type FailureKind } from './ui/errorMessages';
import { showFailure } from './ui/errorScreen';

declare global {
  interface Window {
    __fpv: { ready: boolean; error?: string; stats?: unknown } & Record<string, unknown>;
  }
}
window.__fpv = { ready: false };

type Entry = (canvas: HTMLCanvasElement, osd: HTMLCanvasElement) => Promise<void> | void;

// Dev pages (dev=sky, dev=terrain, ...) exist only on the dev server; the production build ships the simulator alone.
const devs: Record<string, () => Promise<unknown>> = import.meta.env.DEV ? import.meta.glob('./dev/*.ts') : {};

/**
 * Anything that stops startup ends on the troubleshooting panel with a Reload button, including a missing WebGPU and an app module
 * that fails to load. This file only imports the panel itself, so it still runs when the app's own modules cannot.
 */
function fail(e: unknown, kind: FailureKind = 'init-failed'): void {
  console.error(e);
  const detail = e instanceof Error && e.stack ? e.stack : errorText(e);
  if (window.__fpv.error === undefined) window.__fpv.error = errorText(e);
  const root = document.getElementById('ui') ?? document.body;
  const shown = root.querySelector<HTMLElement>('#fpv-fail');
  if (shown && !shown.hidden) return;
  showFailure(root, kind, detail);
}

async function run(load: () => Promise<unknown>, canvas: HTMLCanvasElement, osd: HTMLCanvasElement): Promise<void> {
  const mod = (await load()) as { default?: Entry };
  if (typeof mod.default === 'function') await mod.default(canvas, osd);
}

async function boot(): Promise<void> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    fail(new Error(`navigator.gpu is ${typeof navigator.gpu}; isSecureContext = ${window.isSecureContext}; ${navigator.userAgent}`), 'no-webgpu');
    return;
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const osd = document.getElementById('osd') as HTMLCanvasElement;
  const dev = new URLSearchParams(location.search).get('dev');
  if (dev !== null) {
    const load = devs[`./dev/${dev}.ts`];
    if (!load) {
      const known = Object.keys(devs).map((k) => k.slice(6, -3)).join(', ');
      throw new Error(`Unknown dev entry "${dev}". ${known ? `Available: ${known}` : 'Dev pages exist only on the dev server (npm run dev).'}`);
    }
    await run(load, canvas, osd);
    return;
  }
  await run(() => import('./app'), canvas, osd);
}

boot().catch((e) => fail(e));
