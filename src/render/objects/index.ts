/** Objects module: race gates, flags, cones, start pad and obstacles (track) plus the quad model. */
import type { FrameInfo, RenderContext, RenderModule, SceneData } from '../contracts';
import { createQuadRender, type QuadRender } from './quadRender';
import { createTrackObjects, type TrackObjects } from './trackObjects';

export type ObjectsModule = RenderModule & {
  /** Gate `i` becomes the one to fly through: its LEDs turn cyan and pulse. Later gates return to idle. */
  setActiveGate(i: number): void;
  /** Gate `i` was flown through: 0.5 s green flash, then dim green. */
  setGatePassed(i: number): void;
  /** Hides the quad model (first person camera inside it). */
  setHideQuad(hide: boolean): void;
  /** Direction the air travels toward (world x, z) and speed in m/s; drives the flag cloth. */
  setWind(dirXZ: [number, number], speed: number): void;
};

export function createObjectsModule(): ObjectsModule {
  let track: TrackObjects | null = null;
  let quad: QuadRender | null = null;
  let ctx: RenderContext | null = null;
  let hideQuad = false;
  let active = -1;
  const passed: number[] = [];
  let wind: { dir: [number, number]; speed: number } | null = null;

  return {
    name: 'objects',
    init(rc) {
      ctx = rc;
      track = createTrackObjects(rc);
      quad = createQuadRender(rc);
      if (active >= 0) track.setActiveGate(active);
      for (const g of passed) track.setGatePassed(g);
      if (wind) track.setWind(wind.dir, wind.speed);
    },
    setScene(rc: RenderContext, scene: SceneData) {
      track?.setScene(rc, scene);
    },
    update(rc: RenderContext, f: FrameInfo) {
      track?.update(rc, f);
      quad?.update(rc, f, hideQuad);
    },
    encodeGBuffer(pass) {
      track?.encodeGBuffer(pass);
      quad?.encodeGBuffer(pass);
    },
    encodeForward(pass) {
      track?.encodeForward(pass);
      quad?.encodeForward(pass);
    },
    setActiveGate(i) {
      active = i;
      for (let k = passed.length - 1; k >= 0; k--) if (passed[k] >= i) passed.splice(k, 1);
      track?.setActiveGate(i);
    },
    setGatePassed(i) {
      if (!passed.includes(i)) passed.push(i);
      if (active === i) active = -1;
      track?.setGatePassed(i);
    },
    setHideQuad(hide) {
      hideQuad = hide;
    },
    setWind(dirXZ, speed) {
      wind = { dir: dirXZ, speed };
      track?.setWind(dirXZ, speed);
    },
    destroy() {
      if (ctx) {
        track?.destroy(ctx);
        quad?.destroy(ctx);
      }
      track = null;
      quad = null;
      ctx = null;
    },
  };
}
