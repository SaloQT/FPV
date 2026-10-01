import type { QuadConfig } from '../sim/presets';

const INCH_M = 0.0254;

export interface AirframeDescription {
  /** "5-inch quad". */
  title: string;
  /** "6S 1300 mAh, 650 g, 1650 kV". */
  detail: string;
}

/** What an airframe is, in the words pilots use, taken from the physics config so it can not drift from what flies. */
export function describeAirframe(cfg: QuadConfig): AirframeDescription {
  const inches = Math.round(cfg.prop.diameter / INCH_M);
  const grams = Math.round(cfg.mass * 1000);
  return {
    title: `${inches}-inch quad`,
    detail: `${cfg.battery.cells}S ${cfg.battery.capacityMah} mAh, ${grams} g, ${cfg.motor.kv} kV`,
  };
}
