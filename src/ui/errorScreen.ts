import { el } from './dom';
import { describeFailure, errorText, type Environment, type FailureKind, type FailureMessage } from './errorMessages';
import './panels.css';

export interface FailureActions {
  /** Re-creates the renderer; resolves when it worked, rejects (or throws) with the reason when it did not. */
  recover?: () => Promise<void>;
  /** Hides the panel and lets the page keep running. */
  dismiss?: () => void;
}

const DEV_ORIGIN = 'http://localhost:5173';

/** The loopback address of the port this page is served on (an empty port is the scheme's default, 80 for the http pages that need this hint). */
export function loopbackOrigin(port: string): string {
  return port === '' ? 'http://localhost' : `http://localhost:${port}`;
}

/** errorMessages.ts names the dev server's address; `npm run preview` (4173) or a deployment is on another port, so the hint points at the one in use. */
export function withLoopbackPort(m: FailureMessage, port: string): FailureMessage {
  const origin = loopbackOrigin(port);
  return origin === DEV_ORIGIN ? m : { ...m, steps: m.steps.map((s) => s.replace(DEV_ORIGIN, origin)) };
}

export function browserEnvironment(): Environment {
  return { userAgent: navigator.userAgent, secureContext: window.isSecureContext, hostname: location.hostname };
}

function button(label: string, tone: 'primary' | 'default', onClick: () => void): HTMLButtonElement {
  const b = el('button', `fpv-btn fpv-btn--${tone}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The full-screen failure panel: what went wrong in plain words, numbered troubleshooting steps, the technical detail, and buttons
 * (Reload always; Recover after a lost device; Keep going after an unexpected error). One instance per page; showing again replaces it.
 */
export class ErrorScreen {
  readonly element: HTMLElement;
  /** Kind of the message on screen, null while hidden. */
  current: FailureKind | null = null;

  constructor(private readonly root: HTMLElement, private readonly env: Environment = browserEnvironment()) {
    this.element = el('section', 'fpv-fail');
    this.element.id = 'fpv-fail';
    this.element.setAttribute('role', 'alertdialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.hidden = true;
    root.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(kind: FailureKind, detail: string, actions: FailureActions = {}): void {
    this.render(withLoopbackPort(describeFailure(kind, detail, this.env), location.port), actions);
  }

  hide(): void {
    this.current = null;
    this.element.hidden = true;
    this.element.replaceChildren();
  }

  private render(m: FailureMessage, actions: FailureActions): void {
    this.current = m.kind;
    const title = el('h2', 'fpv-fail-title', m.title);
    title.id = 'fpv-fail-title';
    this.element.setAttribute('aria-labelledby', title.id);
    const steps = el('ol', 'fpv-fail-steps', ...m.steps.map((s) => el('li', '', s)));
    const status = el('p', 'fpv-fail-status');
    status.setAttribute('role', 'status');
    const buttons = el('div', 'fpv-fail-buttons');
    const reload = button('Reload', 'primary', () => location.reload());
    if (m.recover && actions.recover) {
      const recover = button('Recover', 'primary', () => void this.runRecover(actions.recover!, recover, status));
      buttons.append(recover);
      reload.className = 'fpv-btn fpv-btn--default';
    }
    buttons.append(reload);
    if (m.dismiss && actions.dismiss) {
      buttons.append(button('Keep going', 'default', () => {
        this.hide();
        actions.dismiss!();
      }));
    }
    const card = el('div', 'fpv-fail-card', title, el('p', 'fpv-fail-summary', m.summary), el('h3', 'fpv-fail-sub', 'What to try'), steps, status, buttons);
    if (m.detail.length > 0) {
      card.append(el('details', 'fpv-fail-detail', el('summary', '', 'Technical detail'), el('pre', '', m.detail)));
    }
    this.element.replaceChildren(card);
    this.element.hidden = false;
    (buttons.firstElementChild as HTMLElement | null)?.focus();
  }

  private async runRecover(recover: () => Promise<void>, btn: HTMLButtonElement, status: HTMLElement): Promise<void> {
    btn.disabled = true;
    status.textContent = 'Rebuilding the renderer...';
    try {
      await recover();
      this.hide();
    } catch (e) {
      btn.disabled = false;
      status.textContent = `Recovery failed: ${errorText(e)}. Reload the page.`;
    }
  }
}

let shared: ErrorScreen | null = null;

/** Shows the failure panel on `root`, reusing the page's one panel. */
export function showFailure(root: HTMLElement, kind: FailureKind, detail: string, actions: FailureActions = {}): ErrorScreen {
  if (!shared || !root.contains(shared.element)) shared = new ErrorScreen(root);
  shared.show(kind, detail, actions);
  return shared;
}
