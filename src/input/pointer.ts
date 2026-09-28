import type { MouseStick } from './mouseStick';

/** Ignore movement right after the lock is granted: Chrome can report a large bogus first delta. */
const LOCK_SETTLE_MS = 40;
/** A press that travelled further than this was a drag (camera orbit), not a click to grab the mouse. */
const CLICK_DRAG_PX = 4;
const LINE_PX = 33;
const PAGE_PX = 800;

export interface OrbitDelta {
  dx: number;
  dy: number;
  /** Wheel travel in pixel-equivalents, about 100 per notch; positive = away from the user. */
  wheel: number;
}

/** Pointer Lock on the canvas: feeds mouse deltas to the virtual stick, and drag/wheel to the free camera when unlocked. */
export class PointerInput {
  locked = false;
  enabled = true;
  private readonly doc: Document;
  private readonly cleanups: (() => void)[] = [];
  private lockedAtMs = 0;
  private expectUnlock = false;
  private rawMoves = false;
  private pressPx = 0;
  private orbitX = 0;
  private orbitY = 0;
  private wheel = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mouse: MouseStick,
    private readonly now: () => number,
    private readonly onLockLost: () => void,
  ) {
    this.doc = canvas.ownerDocument;
    this.listen(this.doc, 'pointerlockchange', this.onLockChange);
    // pointerrawupdate skips the per-frame batching of mousemove; whichever arrives first for a motion is used, never both.
    this.listen(this.doc, 'pointerrawupdate', this.onRawMove);
    this.listen(this.doc, 'mousemove', this.onMouseMove);
    this.listen(canvas, 'mousedown', this.onDown);
    this.listen(canvas, 'click', this.onClick);
    this.listen(canvas, 'wheel', this.onWheel);
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void {
    if (this.locked || !this.enabled) return;
    const canvas = this.canvas;
    try {
      // unadjustedMovement asks for raw device deltas (no OS acceleration); fall back where unsupported.
      Promise.resolve(canvas.requestPointerLock({ unadjustedMovement: true })).catch(() => {
        try {
          // Browsers that return a promise reject this one too when the lock is refused; that is not an error to report.
          Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
        } catch {
          /* no pointer lock available: keyboard and gamepad still work */
        }
      });
    } catch {
      /* same */
    }
  }

  /** Releases the lock without reporting it as a lost lock. */
  exitLock(): void {
    if (!this.locked) return;
    this.expectUnlock = true;
    this.doc.exitPointerLock();
  }

  takeOrbit(out: OrbitDelta): void {
    out.dx = this.orbitX;
    out.dy = this.orbitY;
    out.wheel = this.wheel;
    this.orbitX = this.orbitY = this.wheel = 0;
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  private readonly onLockChange = (): void => {
    const locked = this.doc.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    this.mouse.reset();
    if (locked) {
      this.lockedAtMs = this.now();
      return;
    }
    const requested = this.expectUnlock;
    this.expectUnlock = false;
    if (!requested) this.onLockLost();
  };

  private readonly onRawMove = (e: Event): void => {
    const m = e as MouseEvent;
    if (m.movementX === 0 && m.movementY === 0) return;
    this.rawMoves = true;
    this.move(m);
  };

  private readonly onMouseMove = (e: Event): void => {
    if (!this.rawMoves) this.move(e as MouseEvent);
  };

  private move(m: MouseEvent): void {
    if (!this.enabled) return;
    const dx = m.movementX || 0;
    const dy = m.movementY || 0;
    if (this.locked) {
      if (this.now() - this.lockedAtMs >= LOCK_SETTLE_MS) this.mouse.addPixels(dx, dy);
    } else if (m.buttons !== 0) {
      this.orbitX += dx;
      this.orbitY += dy;
      this.pressPx += Math.abs(dx) + Math.abs(dy);
    }
  }

  private readonly onDown = (): void => {
    this.pressPx = 0;
  };

  private readonly onClick = (): void => {
    if (this.pressPx <= CLICK_DRAG_PX) this.requestLock();
  };

  private readonly onWheel = (e: Event): void => {
    if (!this.enabled) return;
    const w = e as WheelEvent;
    this.wheel += w.deltaY * (w.deltaMode === 1 ? LINE_PX : w.deltaMode === 2 ? PAGE_PX : 1);
  };
}
