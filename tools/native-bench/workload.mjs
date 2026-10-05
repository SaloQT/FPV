// Harness-owned workload protocol. Changes to this file invalidate comparison/cache identity.
export function createWorkload(api, options, modules) {
  const settings = { ...api.DEFAULT_SETTINGS, observer: { ...api.DEFAULT_SETTINGS.observer },
    quality: options.quality, seed: options.seed, renderScale: options.scale, dynamicResolution: false,
    performance240: false, frameCap: 0, targetFps: 0, timeScale: 0, timeMs: Date.UTC(2026, 5, 21, 12) };
  const terrain = api.generateTerrain({ seed: options.seed, quality: 'low', resolution: 512, cellSize: 4, relief: 220 });
  const sampler = api.createTerrainSampler(terrain);
  const track = api.generateTrack({ seed: options.seed, style: 'race', gateCount: 10, laps: 1, difficulty: .35 }, sampler);
  const scene = { terrain, sampler, track };
  const objects = modules.find(m => m.name === 'objects'), vegetation = modules.find(m => m.name === 'vegetation');
  objects?.setWind([0, -1], 0); vegetation?.setWind([0, -1], 0);
  objects?.setHideQuad(options.workload === 'fpv-flight'); objects?.setActiveGate(0);
  const camera = { pos: [0, sampler.heightAt(0, 0) + 20, 0], quat: [0, 0, 0, 1],
    fovY: settings.fov * Math.PI / 180, aspect: options.width / options.height, near: .05, far: 20000 };
  const astro = api.computeAstro(settings.timeMs, settings.observer);
  const frame = { dt: options.dt, time: 0, camera, astro, quad: null };
  let physics = null, pilot = null, rig = null, gate = 0, index = -1;
  const previous = [0, 0, 0];
  if (options.workload === 'fpv-flight') {
    physics = new api.QuadPhysics(api.QUAD_5IN_6S, sampler, options.seed);
    physics.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
    physics.reset(track.start.pos, track.start.yaw);
    const inner = { armed: false, pointerLocked: false, setArmed(value) { this.armed = value; },
      setThrottle() {}, setEnabled() {}, takeActions: () => [],
      poll: () => ({ throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, mode: 'angle', turtle: false }) };
    pilot = new api.ScenarioPilot(inner, 'fly', { quad: () => physics.state, state: () => inner.armed ? 'flying' : 'ready',
      track: () => track, nextGate: () => gate, groundHeightAt: (x, z) => sampler.heightAt(x, z) });
    pilot.setEnabled(true);
    rig = new api.CameraRig((x, z) => sampler.heightAt(x, z));
  }
  return {
    settings, scene,
    describe: { terrain: { resolution: 512, cellSize: 4, relief: 220 }, track: { gates: track.gates.length, style: track.style },
      scope: options.workload === 'fpv-flight' ? 'Production physics, autopilot, camera and render modules; excludes session UI/audio/input devices.' : 'Scripted camera and production renderer; excludes physics/UI/audio.' },
    afterScene() {
      if (physics) physics.setColliders([...api.trackColliders(track, sampler), ...(vegetation?.vegetationColliders() ?? [])]);
    },
    step() {
      index++; frame.time = (index + 1) * options.dt;
      if (physics) {
        previous[0] = physics.state.pos[0]; previous[1] = physics.state.pos[1]; previous[2] = physics.state.pos[2];
        physics.step(options.dt, pilot.poll(options.dt));
        if (gate < track.gates.length && api.gatePassed(track.gates[gate], previous, physics.state.pos)) {
          objects?.setGatePassed(gate); objects?.setActiveGate(++gate);
        }
        frame.quad = physics.state;
        frame.camera = rig.update(options.dt, physics.state, { fov: settings.fov, cameraTiltDeg: settings.cameraTiltDeg, camVibration: 0 }, camera.aspect);
        const q = physics.state;
        vegetation?.setQuad(q.pos, q.vel, q.armed ? 1.1e-6 * q.motorOmega.reduce((sum, w) => sum + w * w, 0) : 0);
      } else {
        const t = frame.time;
        if (options.workload === 'terrain-flight') {
          const angle = t * .18, radius = 100;
          camera.pos[0] = radius * Math.sin(angle); camera.pos[2] = radius * Math.cos(angle);
          camera.pos[1] = sampler.heightAt(camera.pos[0], camera.pos[2]) + 18;
          api.quatLookAlong(Math.cos(angle), -.16, -Math.sin(angle), camera.quat);
        } else api.quatLookAlong(0, -.25, -1, camera.quat);
      }
      return frame;
    },
    state() { return { index, gate, camera: frame.camera, quad: physics?.state ?? null }; },
  };
}
