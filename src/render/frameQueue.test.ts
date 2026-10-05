import { describe, expect, it } from 'vitest';
import { FrameQueue } from './frameQueue';

describe('GPU frame readiness', () => {
  it('waits for all scripted submissions, so an older completion cannot reopen a busy GPU', async () => {
    const queue = new FrameQueue();
    let first!: () => void, second!: () => void;
    expect(queue.ready).toBe(true);
    queue.submitted(new Promise<void>(resolve => { first = resolve; }));
    queue.submitted(new Promise<void>(resolve => { second = resolve; }));
    expect(queue.ready).toBe(false);
    first(); await Promise.resolve();
    expect(queue.ready).toBe(false);
    second(); await Promise.resolve();
    expect(queue.ready).toBe(true);
  });

  it('releases readiness after failed GPU work without an unhandled rejection', async () => {
    const queue = new FrameQueue();
    queue.submitted(Promise.reject(new Error('device lost')));
    expect(queue.ready).toBe(false);
    await Promise.resolve();
    expect(queue.ready).toBe(true);
  });
});
