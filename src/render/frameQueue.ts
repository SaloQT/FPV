/** Tracks submitted GPU frames; the live loop waits for readiness instead of building a queue of old input states. */
export class FrameQueue {
  private pending = 0;

  get ready(): boolean { return this.pending === 0; }

  submitted(completion: Promise<void>): void {
    this.pending++;
    // Device loss is reported by the renderer's device.lost handler. Always release the gate on failure as well.
    void completion.then(() => { this.pending--; }, () => { this.pending--; });
  }
}
