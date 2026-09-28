import { clamp } from './math3d';

export interface BatteryParams {
  cells: number;
  capacityMah: number;
  /** Ohmic + polarisation resistance of one cell at 25 C, full charge, ohm. */
  cellResistance: number;
  /** Leads, connector, ESC FET path, ohm. */
  wiringResistance: number;
  /** Polarisation (RC) time constant, s. */
  polarisationTau: number;
}

const OCV_SOC = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];
const OCV_V = [3.0, 3.38, 3.5, 3.62, 3.68, 3.72, 3.76, 3.8, 3.85, 3.92, 4.02, 4.1, 4.2];

/** Open-circuit voltage of one LiPo cell at state of charge 0..1 (piecewise linear). */
export function cellOcv(soc: number): number {
  const s = clamp(soc, 0, 1);
  let k = 1;
  while (k < OCV_SOC.length - 1 && OCV_SOC[k] < s) k++;
  const t = (s - OCV_SOC[k - 1]) / (OCV_SOC[k] - OCV_SOC[k - 1]);
  return OCV_V[k - 1] + t * (OCV_V[k] - OCV_V[k - 1]);
}

const OHMIC_SHARE = 0.75;

/** LiPo pack: OCV(SoC) source behind an ohmic resistance and one RC polarisation branch. */
export class Battery {
  mah = 0;
  /** Current drawn during the last step, A (positive = discharge). */
  current = 0;
  tempC = 25;
  private vPolar = 0;

  constructor(readonly p: BatteryParams) {}

  reset(): void {
    this.mah = 0;
    this.current = 0;
    this.vPolar = 0;
  }

  soc(): number {
    return clamp(1 - this.mah / this.p.capacityMah, 0, 1);
  }

  private cellFactor(): number {
    const lowSoc = 1 + 3 * Math.max(0, 0.3 - this.soc());
    const cold = 1 + 0.03 * Math.max(0, 25 - this.tempC);
    return lowSoc * cold;
  }

  /** Source EMF seen by the load: OCV minus the polarisation drop. */
  emf(): number {
    return this.p.cells * cellOcv(this.soc()) - this.vPolar;
  }

  /** Instantaneous series resistance, ohm. */
  seriesResistance(): number {
    return this.p.wiringResistance + this.p.cells * this.p.cellResistance * this.cellFactor() * OHMIC_SHARE;
  }

  /** Terminal voltage at the last recorded current. */
  voltage(): number {
    return this.emf() - this.seriesResistance() * this.current;
  }

  step(dt: number, current: number): void {
    this.current = current;
    this.mah = Math.max(0, this.mah + (current * dt) / 3.6);
    const rPolar = this.p.cells * this.p.cellResistance * this.cellFactor() * (1 - OHMIC_SHARE);
    this.vPolar += ((current * rPolar - this.vPolar) * dt) / this.p.polarisationTau;
  }
}
