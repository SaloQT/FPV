type Child = Node | string | null;

/** Creates an element with a class list and children; strings become text nodes. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className.length > 0) node.className = className;
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

let counter = 0;

/** A document-unique id for wiring labels to inputs. */
export function uid(prefix: string): string {
  return `${prefix}-${++counter}`;
}

/** Writes text only when it changed, so per-frame readouts do not churn the DOM. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/** Drops focus from a control that would otherwise keep swallowing keys meant for flying. */
export function blurActive(): void {
  const a = document.activeElement;
  if (a instanceof HTMLElement && a !== document.body) a.blur();
}

/** Key caps for a binding, or "Unbound" when it has none. */
export function keyCapsEl(keys: readonly string[]): HTMLElement {
  if (keys.length === 0) return el('span', 'fpv-unbound', 'Unbound');
  return el('span', 'fpv-keycaps', ...keys.map((k) => el('kbd', 'fpv-key', k)));
}
