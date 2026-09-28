declare global {
  interface Window {
    __fpv: { ready: boolean; error?: string; stats?: unknown } & Record<string, unknown>;
  }
}
window.__fpv = { ready: false };

type Entry = (canvas: HTMLCanvasElement, osd: HTMLCanvasElement) => Promise<void> | void;

const devs = import.meta.glob('./dev/*.ts');
// A glob (not a literal import) so the build does not fail while the app entry does not exist yet.
const apps = import.meta.glob(['./app.ts', './app/index.ts']);

function fail(e: unknown): void {
  console.error(e);
  window.__fpv.error = String((e as Error | undefined)?.stack ?? e);
}

async function run(load: () => Promise<unknown>, canvas: HTMLCanvasElement, osd: HTMLCanvasElement): Promise<void> {
  const mod = (await load()) as { default?: Entry };
  if (typeof mod.default === 'function') await mod.default(canvas, osd);
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const osd = document.getElementById('osd') as HTMLCanvasElement;
  const dev = new URLSearchParams(location.search).get('dev');
  if (dev !== null) {
    const load = devs[`./dev/${dev}.ts`];
    if (!load) throw new Error(`Unknown dev entry "${dev}". Available: ${Object.keys(devs).map((k) => k.slice(6, -3)).join(', ') || 'none'}`);
    await run(load, canvas, osd);
    return;
  }
  const load = Object.values(apps)[0];
  if (!load) {
    document.getElementById('ui')!.textContent = 'app not built';
    window.__fpv.ready = true;
    return;
  }
  await run(load, canvas, osd);
}

boot().catch(fail);
