import { localSolarHours, withLocalSolarHours } from '../game/clock';
import { formatHours } from '../game/units';
import type { GamepadConfig, StickRole } from '../input/gamepadMap';
import { STICK_LAYOUTS, STICK_LAYOUT_LABELS } from '../input/gamepadMap';
import { RATES_PANEL } from './menuRates';
import type { AppSettings } from './settingsSchema';
import {
  bearing, button, choice, fixed, numberChoice, percent, slider, solarDate, toggle, withSolarDate,
  type Control, type DateControl, type MenuPreset, type MenuSection, type MenuTab, type NumberControl, type SelectControl, type SelectOption,
  type SliderControl, type TabId, type ToggleControl,
} from './menuSchema';

const degrees = fixed(0, '°');
const times = (unit: string) => fixed(2, unit);

/** The preset is not a fifth tier: it is `high` with the cheaper ray, probe, cloud and grass budgets (see render/qualityPresets.ts). */
export const PERFORMANCE_240 = 'perf240';
const QUALITY: readonly SelectOption[] = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' },
  { value: PERFORMANCE_240, label: 'Performance 240' },
];
const AUTO_FPS = { value: 0, label: 'Display refresh (measured)' };
const TARGET_FPS = [AUTO_FPS, ...[60, 120, 144, 165, 240, 360].map((value) => ({ value, label: `${value} fps` }))];
const FRAME_CAPS = [{ value: 0, label: 'Display refresh (no cap)' }, ...[240, 144, 120, 60, 30].map((value) => ({ value, label: `${value} fps` }))];

const QUALITY_CONTROL: SelectControl = {
  kind: 'select', id: 'quality', label: 'Quality', options: QUALITY,
  hint: 'Higher tiers add lighting and terrain detail and cost GPU time. Performance 240 is High with cheaper ray, probe, cloud and grass budgets for 240 Hz displays.',
  read: (s) => (s.performance240 ? PERFORMANCE_240 : s.quality),
  write: (v) => (v === PERFORMANCE_240 ? { quality: 'high', performance240: true } : { quality: v as AppSettings['quality'], performance240: false }),
};
const MODES: readonly SelectOption[] = [{ value: 'acro', label: 'Acro' }, { value: 'angle', label: 'Angle' }, { value: 'horizon', label: 'Horizon' }];
const TRACKS: readonly SelectOption[] = [
  { value: 'race', label: 'Race' }, { value: 'freestyle', label: 'Freestyle' }, { value: 'mountain', label: 'Mountain' }, { value: 'sprint', label: 'Sprint' },
];
const TIME_SCALES = [
  { value: 0, label: 'Frozen' }, { value: 1, label: 'Real time' }, { value: 10, label: '10x' }, { value: 60, label: '60x (1 min per s)' },
  { value: 600, label: '600x (10 min per s)' },
];
const PHYSICS_RATES = [1000, 2000, 4000, 8000].map((value) => ({ value, label: `${value / 1000} kHz` }));
const PROFILES: readonly SelectOption[] = [{ value: 'auto', label: 'Detect' }, { value: 'standard', label: 'Game controller' }, { value: 'radio', label: 'Radio / USB transmitter' }];
const THROTTLE_MODES: readonly SelectOption[] = [
  { value: 'auto', label: 'Automatic' }, { value: 'direct', label: 'Direct (stick = throttle)' }, { value: 'latched', label: 'Latched (stick ramps)' },
  { value: 'hover', label: 'Hover-centred' },
];
const LAYOUTS: readonly SelectOption[] = STICK_LAYOUTS.map((id) => ({ value: id, label: STICK_LAYOUT_LABELS[id] }));
const LAYOUT_HINT = 'Where roll, pitch, yaw and throttle come from when you have not rebound them by hand. A device that does not match, such as the X-56 Rhino whose axis order is set by its driver, still works: check the raw axes and click the control to rebind it.';

function gpSlider(key: 'deadzone' | 'expo' | 'hoverThrottle', label: string, min: number, max: number, step: number, format: (v: number) => string, hint?: string): SliderControl {
  return {
    kind: 'slider', id: `gamepad.${key}`, label, hint, min, max, step, format,
    read: (s) => s.gamepad[key], write: (v, s) => ({ gamepad: { ...s.gamepad, [key]: v } }),
  };
}

function gpChoice(key: 'profile' | 'throttleMode' | 'layout', label: string, options: readonly SelectOption[], hint?: string): SelectControl {
  return {
    kind: 'select', id: `gamepad.${key}`, label, hint, options,
    read: (s) => s.gamepad[key], write: (v, s) => ({ gamepad: { ...s.gamepad, [key]: v } as GamepadConfig }),
  };
}

function gpInvert(role: StickRole, label: string): ToggleControl {
  return {
    kind: 'toggle', id: `gamepad.invert.${role}`, label,
    read: (s) => s.gamepad.cal[role].invert,
    write: (v, s) => ({ gamepad: { ...s.gamepad, cal: { ...s.gamepad.cal, [role]: { ...s.gamepad.cal[role], invert: v } } } }),
  };
}

const TIME_OF_DAY: SliderControl = {
  kind: 'slider', id: 'timeOfDay', label: 'Time of day', min: 0, max: 23.75, step: 0.25, format: formatHours,
  hint: 'Local solar time at the flying site. The , and . keys nudge it in flight.',
  read: (s) => localSolarHours(s.timeMs, s.observer.longitudeDeg),
  write: (v, s) => ({ timeMs: withLocalSolarHours(s.timeMs, s.observer.longitudeDeg, v) }),
};

const DATE: DateControl = {
  kind: 'date', id: 'date', label: 'Date', hint: 'The season sets the sun path and day length.',
  read: (s) => solarDate(s.timeMs, s.observer.longitudeDeg),
  write: (v, s) => ({ timeMs: withSolarDate(s.timeMs, s.observer.longitudeDeg, v) }),
};

const SEED: NumberControl = {
  kind: 'number', id: 'seed', label: 'World seed', hint: 'The same seed always builds the same terrain and track.', min: 0, max: 4294967295, random: true,
  read: (s) => s.seed, write: (v) => ({ seed: v }),
};

/** Seed and track style, shared by the start screen and the Simulation tab. */
export const TRACK_SETUP: readonly Control[] = [SEED, choice('trackStyle', 'Track style', TRACKS)];

function section(title: string, ...controls: Control[]): MenuSection {
  return { title, controls };
}

function tab(id: TabId, label: string, ...sections: MenuSection[]): MenuTab {
  return { id, label, sections };
}

/** The settings tabs. `presets` are the airframes the physics module offers. */
export function buildTabs(presets: readonly MenuPreset[]): readonly MenuTab[] {
  const fov = (): SliderControl => slider('fov', 'Field of view', 30, 150, 1, degrees, 'Vertical angle of the FPV camera; racers use 100 to 140.');
  return [
    tab('graphics', 'Graphics',
      section('Picture',
        QUALITY_CONTROL,
        slider('renderScale', 'Render scale', 0.25, 1, 0.05, percent, 'Share of the native resolution that is rendered.'),
        toggle('dynamicResolution', 'Dynamic resolution', 'Lowers the render scale when the GPU cannot hold the target frame rate, and raises it again when there is headroom.'),
        numberChoice('targetFps', 'Target frame rate', TARGET_FPS, 'What dynamic resolution aims for. The default is the display refresh rate measured at startup.'),
        numberChoice('frameCap', 'Frame cap', FRAME_CAPS, 'Browsers cannot turn v-sync off: frames always follow the display refresh. A cap below it skips refreshes to save power and heat.')),
      section('FPV video', fov(),
        slider('lensDistortion', 'Lens distortion', 0, 1, 0.05, percent),
        slider('videoNoise', 'Video noise', 0, 1, 0.05, percent, 'Analog and digital link artefacts.'))),
    tab('camera', 'Camera',
      section('FPV camera',
        slider('cameraTiltDeg', 'Camera tilt', -10, 60, 1, degrees, 'Up-tilt of the camera; more tilt suits faster flying.'),
        fov(),
        slider('camVibration', 'Motor vibration', 0, 1, 0.05, percent, 'How much of the motor buzz shakes the picture.')),
      section('On-screen display',
        toggle('showOsd', 'Show OSD', 'Battery, speed, altitude and timer overlay.'),
        slider('osdScale', 'OSD size', 0.5, 2, 0.05, times('x')))),
    tab('controls', 'Controls',
      section('Mouse',
        slider('mouseSensitivity', 'Sensitivity', 0.1, 5, 0.05, times('x')),
        toggle('invertY', 'Invert vertical'),
        slider('mouseCentering', 'Stick centring', 0, 1, 0.05, percent, 'Spring that returns the mouse stick to centre; 0 holds it like a real gimbal.'),
        slider('mouseExpo', 'Expo', 0, 1, 0.05, percent, 'Softens the stick around the centre.'),
        slider('mouseDeadzone', 'Deadzone', 0, 0.3, 0.01, percent)),
      section('Gamepad and radio',
        { kind: 'gamepad', id: 'gamepad', label: 'Gamepad' },
        gpChoice('profile', 'Device type', PROFILES),
        gpChoice('throttleMode', 'Throttle mode', THROTTLE_MODES),
        gpChoice('layout', 'Stick layout', LAYOUTS, LAYOUT_HINT),
        gpSlider('deadzone', 'Deadzone', 0, 0.4, 0.01, percent),
        gpSlider('expo', 'Expo', 0, 1, 0.05, percent),
        gpSlider('hoverThrottle', 'Hover throttle', 0.1, 0.6, 0.01, percent, 'Throttle at stick centre in hover-centred mode.'),
        gpInvert('roll', 'Invert roll'), gpInvert('pitch', 'Invert pitch'), gpInvert('yaw', 'Invert yaw'), gpInvert('throttle', 'Invert throttle')),
      section('Stick rates', RATES_PANEL)),
    tab('simulation', 'Simulation',
      section('Flight',
        choice('mode', 'Flight mode', MODES, 'Acro is rate mode; Angle self-levels; Horizon self-levels near centre.'),
        choice('quadPreset', 'Quad', presets.map((p) => ({ value: p.id, label: p.label }))),
        toggle('autoRespawn', 'Automatic respawn', 'Respawn on its own after a crash instead of waiting for R.'),
        numberChoice('physicsHz', 'Physics rate', PHYSICS_RATES, 'Higher rates are more accurate and cost CPU time.')),
      section('Environment', TIME_OF_DAY, DATE,
        numberChoice('timeScale', 'Time scale', TIME_SCALES),
        slider('windSpeed', 'Wind speed', 0, 30, 0.5, fixed(1, ' m/s')),
        slider('windDirDeg', 'Wind from', 0, 360, 5, bearing)),
      section('Track', ...TRACK_SETUP,
        slider('gateCount', 'Gates', 4, 40, 1, fixed(0)),
        slider('laps', 'Laps', 1, 10, 1, fixed(0)),
        slider('difficulty', 'Difficulty', 0, 1, 0.05, percent, 'Tighter turns and more altitude change.'),
        button('new-track', 'New track', 'new-track', 'primary'))),
    tab('audio', 'Audio',
      section('Volume',
        slider('masterVolume', 'Master', 0, 1, 0.05, percent),
        slider('motorVolume', 'Motors', 0, 1, 0.05, percent),
        slider('windVolume', 'Wind', 0, 1, 0.05, percent))),
  ];
}
