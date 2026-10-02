import { el, setText } from './dom';
import type { ControlHost } from './menuHost';

const COPIED_MS = 1600;

/** The clipboard API needs a secure page; the textarea route covers plain http on a LAN. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** A button that copies the link to the world on screen and says so for a moment. The link is built when it is pressed. */
export function shareButton(host: ControlHost, label: string, className = 'fpv-btn fpv-btn--small'): HTMLButtonElement {
  const button = el('button', className, label);
  button.type = 'button';
  button.title = 'Copies a link that opens this exact terrain and track';
  let timer = 0;
  button.addEventListener('click', () => {
    void copyText(host.shareLink()).then((ok) => {
      setText(button, ok ? 'Copied' : 'Copy failed');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setText(button, label), COPIED_MS);
    });
  });
  return button;
}
