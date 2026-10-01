/**
 * Every way the app can fail ends on the same full-screen panel (ui/errorScreen.ts): startup errors, a stopped frame loop, a lost
 * device and anything uncaught. The error is also console.error'd and published as `window.__fpv.error` for the shot tool.
 */
import { errorText, isIgnorableError, type FailureKind } from '../ui/errorMessages';
import { showFailure, type FailureActions } from '../ui/errorScreen';
import { reportError } from './state';

const HEADLINE: Record<FailureKind, string> = {
  'no-webgpu': 'WebGPU is not available',
  'no-adapter': 'No graphics adapter found',
  'device-request': 'The GPU refused to start',
  'device-lost': 'The graphics device was lost',
  'init-failed': 'The simulator could not start',
  'loop-failed': 'The frame loop stopped',
  uncaught: 'Uncaught error',
};

/** Reports a failure through the console, `window.__fpv.error` and the full-screen panel. */
export function failApp(root: HTMLElement, kind: FailureKind, e: unknown, actions: FailureActions = {}): void {
  const detail = errorText(e);
  reportError(`${HEADLINE[kind]}: ${detail}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  showFailure(root, kind, e instanceof Error && e.stack ? e.stack : detail, actions);
}

/**
 * Unhandled errors and rejections anywhere on the page show the panel (with "Keep going", since most of them leave the sim usable).
 * A panel that is already up is never replaced by one of these. Returns the function that removes the handlers.
 */
export function installGlobalErrorHandlers(root: HTMLElement): () => void {
  const onUncaught = (e: unknown): void => {
    const panel = root.querySelector('#fpv-fail') as HTMLElement | null;
    if (panel && !panel.hidden) return;
    failApp(root, 'uncaught', e, { dismiss: () => undefined });
  };
  const onError = (ev: ErrorEvent): void => {
    if (!isIgnorableError(ev.message)) onUncaught(ev.error ?? ev.message);
  };
  const onRejection = (ev: PromiseRejectionEvent): void => onUncaught(ev.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
