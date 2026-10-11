/**
 * The lab's optimiser runs here so the page stays responsive. The page sends one `run` message; this posts a `progress` message
 * after every real evaluation and a `done` message with the finished search.
 */
import { serializeProp, type PropFile } from '../files';
import { designFromVector, DEFAULT_PROP } from '../design';
import { runSearch, violation, type Weights } from '../optimize';

export interface LabRunRequest { type: 'run'; seed: number; budget: number; weights: Weights }

export interface LabRow {
  id: number;
  cost: number;
  predicted: number;
  gramsPerWattHover: number;
  thrustToWeight: number;
  hoverMinutes: number;
  tipMach: number;
  violation: number;
  design: PropFile;
}

export type LabReply =
  | { type: 'progress'; done: number; budget: number; row: LabRow }
  | { type: 'done'; rows: LabRow[]; best: number; reference: LabRow; surrogateCorr: number; seconds: number };

const post = (m: LabReply): void => (self as unknown as { postMessage(m: LabReply): void }).postMessage(m);

self.onmessage = (ev: MessageEvent<LabRunRequest>): void => {
  const req = ev.data;
  if (req.type !== 'run') return;
  const t0 = Date.now();
  const rowOf = (id: number, x: number[], m: import('../optimize').Metrics, cost: number, predicted: number): LabRow => ({
    id, cost, predicted, gramsPerWattHover: m.bench.gramsPerWattHover, thrustToWeight: m.bench.thrustToWeight,
    hoverMinutes: m.bench.hoverMinutes, tipMach: m.bench.tipMach, violation: violation(m),
    design: serializeProp(designFromVector(x, DEFAULT_PROP, `opt-${id}`)),
  });
  const res = runSearch({
    seed: req.seed, budget: req.budget, weights: req.weights,
    onEval: (e, done, budget) => post({ type: 'progress', done, budget, row: rowOf(e.id, e.x, e.metrics, e.cost, e.predicted) }),
  });
  const rows = res.evaluated.map((e) => rowOf(e.id, e.x, e.metrics, e.cost, e.predicted));
  const ref = res.evaluated[0];
  post({
    type: 'done', rows, best: res.best.id, surrogateCorr: res.surrogateCorr, seconds: (Date.now() - t0) / 1000,
    reference: rowOf(-1, ref.x, res.reference, 0, NaN),
  });
};
