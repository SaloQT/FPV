/** A long CPU job written as a generator that yields at safe points, so one body serves both the sync build and the time-sliced one. */
export type Steps<T> = Generator<void, T, void>;

export function runSync<T>(steps: Steps<T>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Lets the event loop paint and handle input: a macrotask hop (MessageChannel avoids the 4 ms setTimeout clamp). */
export function yieldToEvents(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (): void => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

/** Runs the steps in slices of about `budgetMs`, yielding to the event loop between slices; the result is the one runSync gives. */
export async function runSliced<T>(steps: Steps<T>, budgetMs = 8, yieldFn: () => Promise<void> = yieldToEvents): Promise<T> {
  let start = performance.now();
  let r = steps.next();
  while (!r.done) {
    if (performance.now() - start >= budgetMs) {
      await yieldFn();
      start = performance.now();
    }
    r = steps.next();
  }
  return r.value;
}
