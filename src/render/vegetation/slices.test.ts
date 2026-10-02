import { describe, expect, it } from 'vitest';
import { runSliced, runSync, yieldToEvents, type Steps } from './slices';

function* counting(n: number): Steps<number> {
  let sum = 0;
  for (let i = 0; i < n; i++) { sum += i; yield; }
  return sum;
}

describe('time-sliced jobs', () => {
  it('runSync returns the generator result', () => {
    expect(runSync(counting(10))).toBe(45);
  });

  it('runSliced gives the same result and hops to the event loop once per over-budget step', async () => {
    let hops = 0;
    const result = await runSliced(counting(50), 0, async () => { hops++; });
    expect(result).toBe(1225);
    expect(hops).toBeGreaterThanOrEqual(49);
  });

  it('does not yield while inside the budget', async () => {
    let hops = 0;
    await runSliced(counting(50), 1e9, async () => { hops++; });
    expect(hops).toBe(0);
  });

  it('the default yield lets queued macrotasks run', async () => {
    const order: string[] = [];
    setTimeout(() => order.push('timer'), 0);
    await yieldToEvents();
    await yieldToEvents();
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['timer']);
  });
});
