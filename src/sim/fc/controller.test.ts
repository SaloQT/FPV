import { describe, expect, it } from 'vitest';
import type { StickInput } from '../../contracts';
import { FlightController } from './controller';
import { rateProfileOf, SALOQT_RATES, SIM_RATES } from './ratePresets';

const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];
const STEP = 1 / 4000;

/** An armed acro stick with only the axes the test deflects. */
function stick(axes: Partial<StickInput>): StickInput {
  return { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: true, mode: 'acro', turtle: false, ...axes };
}

/** Runs one step with the quad level and still, so the setpoint is the only thing the rates move. */
function step(fc: FlightController, input: StickInput): void {
  fc.update(STEP, input, [0, 0, 0], [0, 0, 9.81], [0, 0, 0, 0]);
}

describe('FlightController rates', () => {
  it('starts on the rate curve the config carries', () => {
    expect(new FlightController().rates.type).toBe('actual');
  });

  it('turns a stick deflection into the setpoint the profile asks for', () => {
    const fc = new FlightController();
    fc.reset(IDENTITY);
    fc.setRates(rateProfileOf(SALOQT_RATES));
    for (const [deflection, expected] of [[0.25, 81], [0.5, 207], [1, 1000]] as [number, number][]) {
      step(fc, stick({ roll: deflection }));
      expect(fc.setpoint[0]).toBeCloseTo(expected, 0);
    }
  });

  it('swaps the curve live, while armed', () => {
    const fc = new FlightController();
    fc.reset(IDENTITY);
    fc.setRates(rateProfileOf(SALOQT_RATES));
    step(fc, stick({ roll: 0.5 }));
    const beta = fc.setpoint[0];
    fc.setRates(rateProfileOf(SIM_RATES));
    step(fc, stick({ roll: 0.5 }));
    // The sim's own curve is 70 deg/s at centre, easing out to 670 at full stick, so half stick lands on 185.
    expect(beta).toBeCloseTo(207, 0);
    expect(fc.setpoint[0]).toBeCloseTo(185, 0);
  });

  it('leaves pitch on the roll numbers when separate pitch is off', () => {
    const fc = new FlightController();
    fc.reset(IDENTITY);
    fc.setRates(rateProfileOf({ ...SALOQT_RATES, separatePitch: false }));
    step(fc, stick({ roll: 0.5, pitch: 0.5 }));
    expect(fc.setpoint[1]).toBe(fc.setpoint[0]);
  });
});
