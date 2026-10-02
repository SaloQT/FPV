/**
 * Vegetation dev page: `?dev=vegetation` on a real generateTerrain map (512 x 512 samples, 4 m cells).
 *   ?view=grass|forest|air|wash|rocks|far  grass: 0.4 m above the ground looking level; forest: 1.7 m inside a wood looking along a
 *                            glade; air: 35 m up looking down 32 deg; wash: a fake quad hovering 0.8 m up, camera 3 m off;
 *                            rocks: 1.7 m beside a boulder field; far: 40 m up at the wood looking at the horizon (canopy cards)
 *   ?t=noon|dusk|night  ?quality=low|medium|high|ultra  ?seed=N  ?x=&z=  ?yaw=deg (compass, clockwise from -Z)  ?pitch=deg
 *   ?alt=m above ground  ?fov=deg  ?wind=m/s  ?winddir=deg  ?thrust=N (wash)  ?frames=N  ?osd=0
 *   ?freeze=1 holds the wind clock at ?clock=s (default 5); without it the clock runs on from ?clock.
 *   ?derive=1 feeds the wash quad through FrameInfo instead of setQuad.
 *   ?perf240=1 after the first frame switches the Performance 240 preset on live (same tier, thinner and nearer grass); window.__fpv.switched
 *   keeps the vegetation stats from before the switch, vegetation() the ones after: the grass buffers must have been rebuilt.
 * window.__fpv carries { ready, stats, errors, vegetation(): VegetationStats, spot, probe }.
 */
import { DEFAULT_SETTINGS, type CameraState, type QuadState, type Settings, type TerrainData, type TerrainSampler, type Vec3 } from '../contracts';
import { createDefaultModules } from '../render/modules';
import { createPostProcessor } from '../render/post';
import { Renderer, type FrameInput } from '../render/renderer';
import type { RenderModule, SceneData } from '../render/contracts';
import { createVegetationModule } from '../render/vegetation';
import { TIER_LIMITS, placeVegetation } from '../render/vegetation/placement';
import { forestSpot, rockSpot } from '../render/vegetation/spots';
import { createTerrainSampler, generateTerrain } from '../world/terrain';
import { isTimeOfDay, makeAstro } from './render/astro';
import { createDevAtmosphere } from './render/atmosphere';
import { drawOsd, probeImage } from './render/osd';

const RES = 512;
const CELL = 4;
const READY_FRAMES = 3;
const MAX_DT = 0.1;
const DEG = Math.PI / 180;

type View = 'grass' | 'forest' | 'air' | 'wash' | 'rocks' | 'far';
const VIEWS: readonly View[] = ['grass', 'forest', 'air', 'wash', 'rocks', 'far'];

function readParams() {
  const q = new URLSearchParams(location.search);
  const num = (key: string, fallback: number): number => { const v = Number(q.get(key)); return q.has(key) && q.get(key) !== '' && Number.isFinite(v) ? v : fallback; };
  const view = q.get('view');
  const t = q.get('t');
  const quality = q.get('quality');
  const v: View = VIEWS.find((k) => k === view) ?? 'grass';
  const level = v === 'grass' || v === 'wash';
  return {
    view: v,
    seed: num('seed', 1),
    time: isTimeOfDay(t) ? t : 'noon',
    quality: quality === 'low' || quality === 'medium' || quality === 'ultra' ? quality : 'high' as Settings['quality'],
    x: q.has('x') ? num('x', 0) : null,
    z: q.has('z') ? num('z', 0) : null,
    yaw: q.has('yaw') ? num('yaw', 0) : null,
    pitch: num('pitch', v === 'air' ? -32 : v === 'wash' ? -8 : v === 'far' ? -1 : level ? -2 : -3),
    alt: num('alt', v === 'grass' ? 0.4 : v === 'air' ? 35 : v === 'far' ? 40 : v === 'wash' ? 1.1 : v === 'rocks' ? 1.4 : 1.7),
    fov: num('fov', v === 'air' || v === 'rocks' || v === 'far' ? 75 : 90),
    wind: num('wind', 5),
    windDir: num('winddir', 40),
    thrust: num('thrust', 6.5),
    freeze: q.get('freeze') === '1',
    clock: num('clock', 5),
    derive: q.get('derive') === '1',
    perf240: q.get('perf240') === '1',
    frames: num('frames', Infinity),
    osd: q.get('osd') !== '0',
  };
}

/** Camera looking along compass heading `yaw` (clockwise from -Z) and `pitch` (up positive), body -Z forward. */
function setOrientation(quat: CameraState['quat'], yawDeg: number, pitchDeg: number): void {
  const hy = -yawDeg * DEG * 0.5, hp = pitchDeg * DEG * 0.5;
  const sy = Math.sin(hy), cy = Math.cos(hy), sp = Math.sin(hp), cp = Math.cos(hp);
  quat[0] = cy * sp;
  quat[1] = sy * cp;
  quat[2] = -sy * sp;
  quat[3] = cy * cp;
}

interface Spot { x: number; z: number; score: number }

/** Best-scoring point of a coarse scan around the origin; ties broken by scan order so the pick is deterministic. */
function scan(data: TerrainData, score: (x: number, z: number, i: number) => number): Spot {
  let best: Spot = { x: 0, z: 0, score: -Infinity };
  const half = (RES * CELL) / 2 - 200;
  for (let z = -half; z <= half; z += 24) {
    for (let x = -half; x <= half; x += 24) {
      const i = Math.round((z - data.origin[1]) / CELL) * RES + Math.round((x - data.origin[0]) / CELL);
      const s = score(x, z, i);
      if (s > best.score) best = { x, z, score: s };
    }
  }
  return best;
}

function grassScore(data: TerrainData, sampler: TerrainSampler) {
  return (x: number, z: number, i: number): number => {
    const slope = sampler.slopeAt(x, z);
    const { soil, wetness, flow } = data.maps;
    if (slope > 0.1 || soil[i] < 0.6 || flow[i] > 0.3 || sampler.heightAt(x, z) < data.waterLevel + 6) return -1;
    return wetness[i] + 0.5 * (wetness[i - 8] + wetness[i + 8] + wetness[i - 8 * RES] + wetness[i + 8 * RES]) / 4;
  };
}

function buildModules(veg: RenderModule): RenderModule[] {
  const modules = createDefaultModules().map((m) => (m.name.startsWith('vegetation') ? veg : m));
  if (modules[0].name.endsWith('-stub')) modules[0] = createDevAtmosphere();
  return modules;
}

function fakeQuad(pos: Vec3, vel: Vec3, omega: number): QuadState {
  return {
    time: 0, pos, vel, quat: [0, 0, 0, 1], angVel: [0, 0, 0], motorOmega: [omega, omega, omega, omega], motorCmd: [0.5, 0.5, 0.5, 0.5],
    batteryVoltage: 16, batteryCurrent: 20, batteryMah: 0, gForce: [0, 1, 0], armed: true, onGround: false, crashed: false, impactSpeed: 0,
  };
}

export default async function run(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const params = readParams();
  const data = generateTerrain({ seed: params.seed, quality: 'low', resolution: RES, cellSize: CELL });
  const sampler = createTerrainSampler(data);
  const scene: SceneData = { terrain: data, sampler, track: null };
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    quality: params.quality,
    dynamicResolution: false,
    observer: { latitudeDeg: 46, longitudeDeg: 8, altitudeM: 300 },
  };
  const veg = createVegetationModule();
  const renderer = await Renderer.create(canvas, settings, buildModules(veg), createPostProcessor());
  renderer.setScene(scene);
  veg.setWind([Math.sin(params.windDir * DEG), -Math.cos(params.windDir * DEG)], params.wind);

  const fallback = scan(data, grassScore(data, sampler));
  const place = params.view === 'forest' || params.view === 'air' || params.view === 'rocks' || params.view === 'far' ? placeVegetation(data, null, TIER_LIMITS[params.quality]) : null;
  const found = place ? (params.view === 'rocks' ? rockSpot(place) : forestSpot(place)) : null;
  const spot = { x: found?.x ?? fallback.x, z: found?.z ?? fallback.z, yaw: found?.yaw ?? 0 };
  const x = params.x ?? spot.x, z = params.z ?? spot.z;
  const ground = sampler.heightAt(x, z);
  const yaw = params.yaw ?? spot.yaw;
  const back = params.view === 'wash' ? 3 : params.view === 'air' ? 45 : 0;
  const pos: Vec3 = [x + Math.sin(yaw * DEG) * back, ground + params.alt, z + Math.cos(yaw * DEG) * back];
  const camera: CameraState = { pos, quat: [0, 0, 0, 1], fovY: params.fov * DEG, aspect: 16 / 9, near: 0.05, far: 1e5 };
  setOrientation(camera.quat, yaw, params.pitch);
  const quadPos: Vec3 = [x, ground + 0.8, z];
  const quadVel: Vec3 = [0, 0, 0];
  const omega = Math.sqrt(params.thrust / 4 / 1.1e-6);
  const input: FrameInput = { dt: 0, time: 0, camera, astro: makeAstro(params.time), quad: null };
  const osd = params.osd ? osdCanvas.getContext('2d') : null;

  let switched: { before: ReturnType<typeof veg.stats> } | null = null;
  let framesLeftUntilReady = READY_FRAMES;
  let frameCount = 0;
  let lastNow = performance.now();
  const startNow = lastNow;

  const publish = (): void => {
    window.__fpv = { ready: true, stats: renderer.stats, errors: renderer.errors, vegetation: () => veg.stats(), switched, spot: { x, z, ground }, probe: () => probeImage(renderer) };
  };
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight), dpr = window.devicePixelRatio || 1;
    renderer.resize(w, h, dpr);
    osdCanvas.width = w;
    osdCanvas.height = h;
    camera.aspect = w / h;
    framesLeftUntilReady = READY_FRAMES;
  };
  resize();
  window.addEventListener('resize', resize);

  const tick = (now: number): void => {
    const dt = Math.min((now - lastNow) / 1000, MAX_DT);
    lastNow = now;
    const elapsed = (now - startNow) / 1000;
    input.dt = params.freeze ? 0 : dt;
    input.time = params.freeze ? params.clock : elapsed + params.clock;
    if (params.view === 'wash') {
      const t = input.time;
      quadPos[0] = x + 0.12 * Math.sin(t * 0.9);
      quadPos[2] = z + 0.12 * Math.cos(t * 0.7);
      quadVel[0] = 0.108 * Math.cos(t * 0.9);
      quadVel[2] = -0.084 * Math.sin(t * 0.7);
      if (params.derive) input.quad = fakeQuad(quadPos, quadVel, omega);
      else veg.setQuad(quadPos, quadVel, params.thrust);
    }
    renderer.render(input);
    frameCount++;
    if (params.perf240 && !switched && frameCount === 2) {
      switched = { before: veg.stats() };
      renderer.setSettings({ ...settings, performance240: true });
      framesLeftUntilReady = READY_FRAMES;
    }
    if (osd && frameCount % 10 === 0) drawOsd(osd, osdCanvas, renderer.stats, params.time);
    if (framesLeftUntilReady > 0 && --framesLeftUntilReady === 0) publish();
    if (frameCount < params.frames && !renderer.lost) requestAnimationFrame(tick);
    else if (framesLeftUntilReady > 0) publish();
  };
  requestAnimationFrame(tick);
}
