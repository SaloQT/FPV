import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const tPath='src/render/shaders/terrain/terrain.wgsl',dPath='src/render/shaders/terrain/detail_sample.wgsl',gPath='src/render/shaders/terrain/ground_color.wgsl';
const [t,d,g]=await Promise.all([tPath,dPath,gPath].map(read));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-gi-visibility-winner.json'));
const start=t.indexOf('  var lid = array<i32, 3>'),end=t.indexOf('\n\n  var ctx',start);
if(start<0||end<0)throw new Error('Terrain layer selection missing');
const selection=`  var lid = vec3i(0);
  var lwt = vec3f(0.0);
  // Stable insertion keeps the same first-index tie rule and zero-weight defaults.
  for (var i = 0; i < GL_COUNT; i++) {
    let value = wt[i];
    if (value > lwt.x) {
      lwt = vec3f(value, lwt.x, lwt.y); lid = vec3i(i, lid.x, lid.y);
    } else if (value > lwt.y) {
      lwt = vec3f(lwt.x, value, lwt.y); lid = vec3i(lid.x, i, lid.y);
    } else if (value > lwt.z) {
      lwt.z = value; lid.z = i;
    }
  }`;
const guarded=g.replace(`  let ridged = 1.0 - abs(2.0 * tnFbm(q * 0.24 + vec2f(5.0, 77.0), 2) - 1.0);
  let rill = smoothstep(0.955, 0.99, ridged) * smoothstep(0.04, 0.10, slope) * (1.0 - steep);`,
`  let rillSlope = smoothstep(0.04, 0.10, slope);
  var rill = 0.0;
  if (rillSlope > 0.0 && steep < 1.0) {
    let ridged = 1.0 - abs(2.0 * tnFbm(q * 0.24 + vec2f(5.0, 77.0), 2) - 1.0);
    rill = smoothstep(0.955, 0.99, ridged) * rillSlope * (1.0 - steep);
  }`).replace('  let scree = smoothstep(0.10, 0.20, slope) * (1.0 - steep) * smoothstep(0.40, 0.70, tnFbm(q * 0.35 + vec2f(2.0, 19.0), 2));',
`  let screeSlope = smoothstep(0.10, 0.20, slope) * (1.0 - steep);
  var scree = 0.0;
  if (screeSlope > 0.0) { scree = screeSlope * smoothstep(0.40, 0.70, tnFbm(q * 0.35 + vec2f(2.0, 19.0), 2)); }`);
const variants=[
  {id:'E84',label:'Single-pass terrain top three',hypothesis:'Select the same three strongest terrain layers in one stable insertion scan rather than three full scans and mutable weight clearing; preserve ties, zero defaults and blend order',files:{[tPath]:t.slice(0,start)+selection+t.slice(end)}},
  {id:'E85',label:'Skip zero-weight terrain noise',hypothesis:'Skip rill and scree FBM fields only when their existing slope gates are exactly zero; preserve original multiplication order for every active field',files:{[gPath]:guarded}},
  {id:'E86',label:'Terrain projection sixth power',hypothesis:'Compute the sixth power of absolute normal components with multiplications rather than pow during triplanar weight construction; check numerical differences against ORIGINAL',files:{[dPath]:d.replace('  var w = pow(abs(c.n), vec3f(6.0));','  let n2 = c.n * c.n;\n  var w = n2 * n2 * n2;')}},
];
await explore('overnight-terrain-material',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
