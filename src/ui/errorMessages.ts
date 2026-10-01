/** Wording of the full-screen failure panel. Pure: the DOM side is in errorScreen.ts, the environment is passed in. */

export type FailureKind = 'no-webgpu' | 'no-adapter' | 'device-request' | 'device-lost' | 'init-failed' | 'loop-failed' | 'uncaught';

export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

export interface Environment {
  userAgent: string;
  /** `window.isSecureContext`: WebGPU exists only on https:// pages and on localhost. */
  secureContext: boolean;
  hostname: string;
}

export interface FailureMessage {
  kind: FailureKind;
  title: string;
  summary: string;
  /** Troubleshooting steps, most likely first. */
  steps: string[];
  /** The technical message of the underlying error, for bug reports. */
  detail: string;
  /** Buttons the panel offers: reload is always there; recover re-creates the renderer; dismiss keeps the page running. */
  recover: boolean;
  dismiss: boolean;
}

export function browserFamily(userAgent: string): { family: BrowserFamily; major: number } {
  const ua = userAgent;
  const version = (re: RegExp): number => {
    const m = re.exec(ua);
    return m ? Number(m[1]) : 0;
  };
  if (/Edg\//.test(ua)) return { family: 'edge', major: version(/Edg\/(\d+)/) };
  if (/Firefox\//.test(ua)) return { family: 'firefox', major: version(/Firefox\/(\d+)/) };
  if (/Chrome\/|Chromium\/|CriOS\//.test(ua)) return { family: 'chrome', major: version(/(?:Chrome|Chromium|CriOS)\/(\d+)/) };
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return { family: 'safari', major: version(/Version\/(\d+)/) };
  return { family: 'other', major: 0 };
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

function insecureHint(env: Environment): string[] {
  if (env.secureContext) return [];
  const where = LOOPBACK.test(env.hostname) ? 'this page' : `this page (${env.hostname})`;
  return [`WebGPU only exists on secure pages, and ${where} is not one. Open the simulator at http://localhost:5173 (not a network address such as http://192.168.x.x) or serve it over HTTPS.`];
}

function browserSteps(b: { family: BrowserFamily; major: number }): string[] {
  switch (b.family) {
    case 'chrome':
    case 'edge': {
      const name = b.family === 'chrome' ? 'Chrome' : 'Edge';
      const scheme = b.family === 'chrome' ? 'chrome' : 'edge';
      const steps: string[] = [];
      if (b.major > 0 && b.major < 113) steps.push(`This is ${name} ${b.major}. WebGPU needs ${name} 113 or newer: update the browser.`);
      steps.push(
        `Turn on hardware acceleration: ${scheme}://settings/system, "Use graphics acceleration when available", then restart the browser.`,
        `Open ${scheme}://gpu and look at the "WebGPU" line: it should say "Hardware accelerated". If it says "Disabled", the GPU or driver is on the browser's blocklist.`,
        `Still disabled: open ${scheme}://flags, set "Unsafe WebGPU Support" (#enable-unsafe-webgpu) to Enabled, relaunch, and check ${scheme}://gpu again. On Linux also enable Vulkan (#enable-vulkan).`,
      );
      return steps;
    }
    case 'firefox':
      return ['Firefox only ships WebGPU in recent versions on some platforms. Use a current Chrome or Edge (113 or newer), or in Firefox set dom.webgpu.enabled to true in about:config and restart.'];
    case 'safari':
      return ['Use Safari 26 or newer. Older Safari versions have WebGPU behind Develop > Feature Flags > WebGPU. Chrome or Edge 113 or newer also work.'];
    default:
      return ['Use a current Chrome or Edge (version 113 or newer).'];
  }
}

const COMMON_GPU_STEPS = [
  'Update the graphics driver, then restart the browser.',
  'WebGPU usually does not work inside remote desktop sessions or virtual machines without GPU pass-through.',
];

export function describeFailure(kind: FailureKind, detail: string, env: Environment): FailureMessage {
  const browser = browserFamily(env.userAgent);
  const base = { kind, detail, recover: false, dismiss: false };
  switch (kind) {
    case 'no-webgpu':
      return {
        ...base,
        title: 'WebGPU is not available',
        summary: 'This simulator draws with WebGPU, and this browser does not offer it on this page.',
        steps: [...insecureHint(env), ...browserSteps(browser), ...COMMON_GPU_STEPS],
      };
    case 'no-adapter':
      return {
        ...base,
        title: 'No graphics adapter found',
        summary: 'The browser supports WebGPU but could not find a graphics adapter it is willing to use.',
        steps: [...browserSteps(browser), ...COMMON_GPU_STEPS],
      };
    case 'device-request':
      return {
        ...base,
        title: 'The GPU refused to start',
        summary: 'The graphics adapter was found, but creating the WebGPU device failed.',
        steps: [
          'Close other tabs and programs that use the GPU heavily (games, video editors, other WebGPU pages), then reload.',
          'Update the graphics driver and restart the browser.',
          'If the machine has two GPUs, make sure the browser is set to use the faster one in the system graphics settings.',
        ],
      };
    case 'device-lost':
      return {
        ...base,
        title: 'The graphics device was lost',
        summary: 'The GPU stopped responding: a driver reset, a GPU hang, an unplugged GPU, or another program took it. The scene is still in memory.',
        steps: [
          'Press "Recover" to build the renderer again without reloading the page. Your world, settings and current run are kept.',
          'If recovery fails or it happens again, reload the page, lower the quality, and update the graphics driver.',
        ],
        recover: true,
      };
    case 'loop-failed':
      return {
        ...base,
        title: 'The simulator stopped',
        summary: 'An error interrupted the frame loop.',
        steps: ['Reload the page. Your settings are saved.', 'If it keeps happening, lower the quality in the settings or open the browser console (F12) and copy the error shown below into a bug report.'],
      };
    case 'uncaught':
      return {
        ...base,
        title: 'Something went wrong',
        summary: 'An unexpected error happened. The simulator may still be running.',
        steps: ['Press "Keep going" to continue, or reload the page to start clean.', 'The error shown below is also in the browser console (F12).'],
        dismiss: true,
      };
    case 'init-failed':
      return {
        ...base,
        title: 'The simulator could not start',
        summary: 'Something failed while setting up the renderer or building the world.',
        steps: ['Reload the page.', 'If it fails again, try a lower quality tier or a different browser, and check the browser console (F12) for the error shown below.', ...COMMON_GPU_STEPS.slice(0, 1)],
      };
  }
}

/** Picks the failure kind for an error thrown while starting up (GpuInitError carries its own). */
export function classifyStartupError(e: unknown): FailureKind {
  const kind = (e as { kind?: unknown } | null)?.kind;
  return kind === 'no-webgpu' || kind === 'no-adapter' || kind === 'device-request' ? kind : 'init-failed';
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/** Window `error` events that are noise: they are not failures and must not cover the screen. */
export function isIgnorableError(message: string): boolean {
  return /^ResizeObserver loop/.test(message) || message === 'Script error.' || message === '';
}
