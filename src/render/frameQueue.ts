/** Tracks submitted GPU frames; the live loop waits for readiness instead of building a queue of old input states. */
export class FrameQueue {
  private pending = 0;
  /** Parks overlap CPU simulation with one preceding GPU frame; ordinary flight retains its single-frame gate. */
  maxPending = 1;

  get ready(): boolean { return this.pending < this.maxPending; }

  submitted(completion: Promise<void>): void {
    this.pending++;
    // Device loss is reported by the renderer's device.lost handler. Always release the gate on failure as well.
    void completion.then(() => { this.pending--; }, () => { this.pending--; });
  }
}
