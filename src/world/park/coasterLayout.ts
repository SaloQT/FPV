import type { Vec3 } from '../../contracts';
import type { Rng } from '../track/rng';
import { TAU } from './math';
import type { CoasterFamily } from './types';

export interface CoasterLayout { points: Vec3[]; station: number; lift: number; brake: number }

/** Family-specific engineered corridors, sharing the straight station and powered lift approach. */
export function coasterLayout(family: CoasterFamily, rng: Rng): CoasterLayout {
  const loop = family === 'steel' || family === 'launch' || family === 'inverted';
  const h = loop ? rng.range(62, 66) : family === 'hyper' ? rng.range(46, 54) : family === 'wooden' ? rng.range(28, 34) : family === 'space' ? rng.range(25, 31) : rng.range(19, 24);
  const lift = h + 3;
  // Two additional collinear controls keep the full finite train within the quintic spline's flat region.
  // A station marker alone cannot prevent the lift controls from influencing the loading track.
  const points: Vec3[] = [[-120, 3, 70], [-95, 3, 70], [-82.5, 3, 70], [-70, 3, 70], [-57.5, 3, 70], [-45, 3, 70], [-20, 3, 70], [5, 7, 70], [35, Math.min(20, h * 0.55), 70], [65, lift - 8, 70], [95, lift, 70], [130, lift - 4, 60]];
  if (family === 'space') {
    // Three folded corridors put the late low return beneath the elevated outbound curve.
    points.push([169, 15, 37], [195, 9, 6], [188, 8, -24], [157, 11, -42], [110, 16, -42], [60, 19, -38], [10, 19, -43], [-33, 17, -62], [-45, 14, -91], [-10, 11, -100], [36, 9, -98], [78, 7, -85], [99, 6, -56], [83, 5, -25], [43, 5, -9], [-10, 6, -8], [-62, 6, -7], [-113, 5, 0], [-145, 4, 25], [-141, 3, 55]);
  } else if (family === 'mine') {
    // A broad ravine descent folds into a separate low mine-yard turnaround.
    points.push([169, 11, 35], [190, 8, 1], [174, 7, -40], [139, 9, -69], [94, 13, -72], [48, 15, -48], [6, 13, -10], [-35, 10, 0], [-75, 8, -22], [-77, 6, -60], [-107, 5, -85], [-140, 4, -65], [-151, 4, -25], [-142, 3, 19], [-140, 3, 55]);
  } else if (family === 'wooden') {
    // Narrow out-and-back terrain coaster with alternating camelbacks and an offset return.
    points.push([171, 15, 49], [193, 7, 22], [185, 5, -8], [157, 8, -24], [114, 18, -27], [69, 5, -23], [22, 14, -37], [-26, 4, -41], [-75, 11, -30], [-120, 4, -7], [-150, 3, 25], [-141, 3, 57]);
  } else if (family === 'hyper') {
    // Sweeping hammerhead followed by a diagonal string of increasingly small airtime hills.
    points.push([170, 26, 39], [195, 9, 0], [190, 5, -43], [160, 18, -82], [112, 30, -97], [66, 8, -85], [21, 26, -62], [-24, 6, -37], [-69, 18, -19], [-112, 4, -4], [-147, 3, 27], [-140, 3, 57]);
  } else {
    points.push([169, 26, 43], [195, 8, 12], [194, 4, -24], [170, 5, -61], [132, 4, family === 'inverted' ? -70 : -84], [98, 3, family === 'inverted' ? -60 : -88]);
    // Large entry radius and a smaller apex preserve positive wheel loads through the loop.
    for (let i = 1; i <= 24; i++) { const t = i / 24; points.push([98 - 20 * t - 32 * Math.sin(TAU * t), 3 + 24 * (1 - Math.cos(TAU * t)), family === 'inverted' ? -60 + 18 * Math.sin(TAU * t) - 20 * t : -88 - 11 * t]); }
    if (family === 'launch') points.push([40, 10, -96], [-10, 16, -74], [-54, 20, -28], [-98, 12, -16], [-141, 5, 8], [-153, 3, 35], [-140, 3, 57]);
    else if (family === 'inverted') points.push([40, 12, -68], [-10, 7, -50], [-54, 14, -42], [-115, 5, -12], [-151, 3, 27], [-140, 3, 57]);
    else points.push([40, 10, -96], [-10, 5, -92], [-56, 12, -78], [-105, 4, -54], [-143, 4, -15], [-151, 3, 27], [-140, 3, 57]);
  }
  const scale = family === 'space' || family === 'mine' ? 0.85 : 1;
  // Correlated seeded variation changes corridor spacing without introducing tight local bends.
  // The approach and closing brake controls remain exact, keeping boarding and packing stable.
  const narrowing = rng.range(0, 0.018);
  return { points: points.map((v, i) => {
    const blend = Math.max(0, Math.min(1, (i - 11) / 4, (points.length - 3 - i) / 3));
    return [(v[0] - 22) * scale, v[1] + (family === 'inverted' ? 3 : 0), (v[2] + (70 - v[2]) * narrowing * blend) * scale];
  }), station: 4, lift: 11, brake: points.length - 2 };
}
