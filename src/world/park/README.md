# Procedural theme parks

Select **Environment → Theme park** on the start screen. Choose a seed, size, layout, theme, guest count and flight route,
then **Click to fly**. The preview shows the park being built. The same settings also appear in **Settings → Simulation**;
use **New track** or **N** to apply them after starting a flight. Existing flight controls apply throughout the park.

**P** pauses physics, rides and guests together. **R** respawns the drone without resetting attraction cycles or queues.
**N** advances the seed and builds another park. The world card's **Copy link** preserves the complete versioned recipe.
Time-of-day changes affect lighting, while the sky's time multiplier does not accelerate rides or pedestrians.

| Size | Coasters | Total attractions | Default guests |
| --- | ---: | ---: | ---: |
| Compact | 3 | 10 | 1,000 |
| Destination | 7 | 18 | 3,000 |
| Mega | 10 | 32 | 10,000 |

Guest count can be set independently from 0 to 10,000. Destination contains every attraction family; Mega repeats families.
Layouts are hub, loop, valley and boardwalk, with a seeded random choice. Themes are space, fantasy, jungle, western,
seaside, steampunk, alpine and carnival, either throughout the park or mixed between districts.

Coasters are steel looping, launched, inverted, wooden, hyper, mine and enclosed space. Flat rides are Ferris wheel,
carousel, flying swings, pirate ship, rotating pendulum, drop tower, teacups, scrambler, observation tower, Enterprise and Top Spin.
All buildings, signs, track, ride vehicles, vegetation, guests and attraction audio are generated in code.

Districts include hollow shop shells, framed windows and doors, supported awnings, service façades, shaded queues,
terrace concessions and landscaped groves. Timber, concrete, masonry, canvas and foliage use filtered procedural surface
detail. Glass uses opaque dielectric shading. Building fronts face their access paths, and new facilities connect to the
pedestrian graph; landscaping respects roads, queues, ride envelopes and flight routes.

Generation lays out complete districts before detailing individual attractions. Each land has an attraction court,
retail fronts, connected queue/exit approaches and a screened service yard. Main Street leads to the central village;
major coaster plots sit around its perimeter. Hub layouts use six radial connections, boardwalk four, and loop/valley
two, so these choices produce different pedestrian networks. Destination's district anchors are 440 m from the centre;
Mega uses 580 m, with ride dimensions retained. Generation checks continuous walking clearance; regression tests also
verify physical pavement along coaster station approaches.

## Reproducible recipes

```text
/?world=theme-park&seed=1337&size=destination&layout=hub&theme=mixed&guests=3000&route=free
/?world=theme-park&seed=42&size=destination&theme=space&route=coaster&coaster=6
/?world=theme-park&seed=7&size=compact&route=race&race=ace,ultimate1,a
```

`route` is `free`, `tour`, `coaster` or `race`; `coaster` is a zero-based coaster index. The tour has timing hoops, while coaster
guides follow the track with clearance from its structure. Free exploration has no gate sequence.

The race course (`raceCourse.ts`) is a closed two-lap loop past a ring of rides: low along the walkways, round the flat rides'
measured swept envelopes, under coaster rails where the gap allows and never under roofs, with square, arch and hoop gates whose
legs stand off the walkways and a start pad 10 m behind the start gate, as on every generated track.

The AI pilots fly and race every park route with a line: the tour, each coaster and the race course (AI pilots tab, or
`&brain=ace` / `&race=ace,a` in the URL). While a brain flies a tour or coaster route, the session flies it as
`pilotGates.ts` lays it out: a coaster's guide line gets invisible hoops every 30 m, and the start moves to a pad 10 m
behind the lowest gate with room for one; the player's own flight keeps the route as it is. The brains sense the park through
box stand-ins round the line (`raceColliders.ts`, the moving rides' swept space included, except the trains of a coaster being
followed), while every quad still collides with the park's exact shapes. Free exploration has no line, so no AI pilot flies
it. The trainer flies park race courses with `train.mjs --parks 1337,7:compact`.

Share links use `park=<base64url JSON>`. Recipe version 1 contains `seed`, `size`, `layout`, `theme`, `guests`, `route` and
`coaster`. Unsupported versions and damaged links are rejected. Graphics quality is outside the recipe: every tier uses
the same physical terrain, rides, crowd and navigation. Park terrain is a canonical 1024² grid at 2 m spacing, with the
park graded to 12 m and blended into the surrounding terrain. The seven existing flight-track generators are unchanged.

Programmatic generation and operation:

```ts
import { buildPark } from './build';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';

const built = buildPark({ ...defaultParkRecipe(42), theme: 'space' });
const park = new ParkRuntime(built.park);
// Called before each accepted drone physics step, using that step's actual dt:
park.advance(1 / 4000);
// The drone's contact solver consumes park.collision.
// Rendering interpolates authoritative poses without advancing the simulation:
park.present(1, 1 / 4000);
```

The application uses a module worker for generation and transfers terrain, curve and preflight arrays. Node tools can use
the same synchronous builder. A recipe and seed reproduce geometry and the initial operating snapshot; subsequent crowd
behaviour also depends on elapsed simulation time and the drone's position.

## Simulation and physical geometry

See [construction interfaces](../../../docs/park-construction.md) for the shared surface/transform contracts,
declared joint coverage, finite-area bearing tests and reproducible contact-audit commands.

Each coaster family has a distinct planform with bounded seeded height and corridor variation. Wooden coasters use an
offset out-and-back route, hyper coasters a hammerhead and diagonal hill return, and mine and space coasters folded
multi-turn corridors. Steel, launched and inverted coasters have different loop orientations or return paths. They share
a stable station and lift approach. Centerlines are periodic quintic B-splines with analytic derivatives, arc-length
sampling, transported frames, banking and closure correction. The frame roll datum is anchored to a level loading
straight; automatic banking and loop closure correction blend outside that straight. Finite trains contribute gravity
from nominal equally spaced rail masses along the train.
RK4 integrates the rail coordinate at 250 Hz with passenger mass, rolling resistance, quadratic air drag, force/power-limited drives, antirollback
and bounded, slew-limited brakes. Generation runs the same solver with empty and full nominal loads and rejects stalls,
non-finite states, loads above 5.5 g or jerk above 180 m/s³. The validation suite also checks energy conservation and step
convergence.

Support placement varies bent positions and footing spread to clear vehicle and flight corridors. Inverted track uses
level overhead portals with spine hangers, keeping banked suspended cabins clear of the columns. Manufactured wheelsets
have load, side-guide and up-stop rollers; lift and brake runs have continuous evacuation catwalks. Two independently
rail-following bogies support each rigid chassis through spherical kingpins. Their arc spacing is solved from the fixed
physical wheelbase. Adjacent cars use fixed-length articulated drawbars, with trailing rail coordinates solved from their
actual bearing centres. The longitudinal force model still uses nominal equally spaced rail masses; it is not a complete
multibody suspension or coupler-force solver. A complete-circuit
regression samples rider heads and feet, chassis edges and up-stop undersides against static structures every 0.75 m.
It also checks continuous stair treads and level station decks: upright cushions are 0.45 m above the platform and inverted
cushions 1.10 m above their foot-clearance deck. Flight-guide regressions sweep the drone's clearance volume through the routes.

Flat rides integrate motor torque, rotating inertia, gravity-driven pendulums, swing coning and vertical hoist/drop motion.
The drop tower has a bounded braking zone and a mechanical bottom catch. Ferris-wheel gondolas dock in indexed groups
instead of boarding in mid-air. Stations have platforms, stairs and boarding routes; passengers walk to seats, restraints
close before dispatch, trains respect stopping-distance blocks, and riders leave through physical exit routes.

Enterprise has 20 hinged tandem gondolas on a tilting 15 m wheel. Its 90 kW drive budget covers rotation and the hydraulic
tilt; payload changes inertia and gravity loading, and each gondola responds to gravity and acceleration at its hinge.
Top Spin has twin driven arms and a freely rotating, separately braked 40-seat gondola, with a 220 kW drive budget and a
retracting boarding deck interlocked with the restraints. Dimensions, capacities and power ratings follow the manufacturer
references for [Enterprise 2G](https://www.hussrides.com/en/family-thrill-rides/enterprise-2g-2gh/) and
[Top Spin Classic](https://www.hussrides.com/en/thrill-rides/top-spin-classic/); component masses, inertia, damping and control
laws are explicit simulation assumptions. Scramblers have counter-rotating satellite arms, carousel horses reciprocate
along fixed poles, and teacups have hollow walls with visible seating.

Guests use typed arrays and an uncapped spatial index. Decisions run at 1 Hz, reciprocal velocity avoidance at 25 Hz, and
movement/ride attachment at 250 Hz. Pedestrians follow a width-aware navigation graph routed around physical structures,
join FIFO serpentine queues, board, ride, exit and visit facilities. Low-flying drones influence pedestrian avoidance.
Every guest retains one identity across queue and seat transitions. Rider transforms follow the actual car/gondola/cup,
including inversions, and their mass contributes to the attraction's load.

Between fixed ticks, the runtime interpolates generalized angles, slider travel and train distance, then evaluates the
shared assembly transforms and train constraints. Independent interpolation of connected world-space poses would open
joints on curved motion. Seated pelvis positions and partial boarding transfers use these same evaluated seat frames.

Guest locomotion and seat transfers are kinematic; they do not simulate individual foot forces or balance. Flat-ground
gait plants a shoe on the paving plane, and seating poses respect the actual cabin floor. Boarding stairs compile their
support faces from the generated tread solids. Each foot plants on a tread, lifts before crossing its risers and lowers
onto the next support, with fixed-length leg IK and a smoothly flexed pelvis. Level landing blends preserve contact and
previous-frame animation. This extra contact path runs only near stairs; ordinary crowd gait is unchanged.

Navigation proves continuous edge clearance, including thin obstacles. Crowds spawn in proportion to walkable path area,
use both travel directions, and steer from a shared velocity snapshot with bounded acceleration and turning rate. Reusable
neighbour constraints, cached routes and a dedicated ground-level walking BVH reduce crowd cost. Elevated pedestrians
retain the complete structural collision query.

`ParkPart` is the common description for drawing, collision and ray proxies: oriented boxes, capped cylinders, cones and
ellipsoids and triangular prisms, with static or rigid-body attachment. Collision uses signed distances, spatial BVHs and conservative
sweeps through thin or moving geometry. Moving contacts use the surface velocity `linear + angular × offset`, so the
existing drone solver responds to moving trains and platforms. Guest capsules remain solid while walking or riding.
Physical geometry stays active when decorative rendering LODs are culled.

This is a constrained rigid-body simulation. Wheels follow rails without a separate suspension/contact solver; payload
is distributed across the train's cars. Structures do not flex or break, and guests have collision capsules and procedural
animation rather than ragdoll skeletons. Preflight limits are simulation design envelopes, not engineering certification.

## Rendering and sound

Instanced meshes have projected-size shape LODs, three guest LODs, frustum culling, distance-based small-detail culling and motion vectors.
Static instance records remain on the GPU; each frame uploads visible indices, moving parts and visible guests. Spatial
clusters reject off-screen structures before per-part checks. Guests use joined, skinned limbs with separate clothing,
hair and shoes, with a 12,060-vertex anatomical mesh within 15 m and 2,568 / 780 vertices for the ordinary near / far meshes.
Motion history tracks the last rendered animation, including pause, boarding and visibility transitions.
Primary structures, all moving ride proxies and every guest participate in the software ray tracer. Dynamic BVH buffers
grow beyond the former 64-primitive limit; large populations refit between periodic topology rebuilds. Small rail ties,
bolts and decorative details retain physical collision but are omitted from the ray proxy set.

Park vegetation uses the engine's procedural bark, branch and leaf-card meshes with explicit seeded planting transforms.
Mature trees are allocated before small shrubs. Up to 24 trunk and primary-limb segments from the same skeleton provide
physical collision; wood remains rigid while foliage responds to wind. Ray tracing uses at most eight opaque trunk and
major-branch capsules per tree plus a partially transmitting canopy proxy for every planting. This coarser shadow skeleton
reduces ray cost without reducing physical branch geometry or raster mesh detail. The same placements persist across
graphics quality tiers, with a generation cap of 4,096 plantings. Physical woody proxies are hidden from the raster and
ray passes while the vegetation renderer supplies their meshes and shadow proxies. Public paving uses metre-scaled joints,
chamfers and aggregate with distance filtering, continuous across adjoining path pieces.

Point lights use candela and inverse-square irradiance, world-space light bins and physical shadow visibility. GI samples
one local light per hit with probability compensation, accumulating its contribution over time. Enclosed space-coaster
volumes suppress outdoor sky/sun/aerial lighting. Nearly black matte materials conceal the track machinery; dim local
lights, emissive stars and clearance-checked suspended planetary props provide the show scenery. Outdoor probe bounce is
suppressed inside these rooms to avoid sky leakage; indoor indirect illumination is currently limited to traced local
light contributions. Attraction and crowd sounds are synthesized with spatial attenuation, stereo direction, room
transmission and Doppler shift, using the existing audio gesture, volume and pause lifecycle.

Park rendering permits at most two GPU frames in flight so CPU simulation can overlap the preceding GPU frame. Existing
flight-track scenes retain their single-frame gate. This bounds queued input latency while avoiding a CPU/GPU idle gap.

## Verification and performance

The top-down blueprint is generated directly from the physical park, not drawn as an independent mockup:

```powershell
npx vitest run src/world/park/blueprint.test.ts
node tools/park-blueprint.mjs --png 1 --out .bench/park-blueprints
node tools/park-blueprint.mjs --sizes destination --layouts hub,loop,valley,boardwalk --seed 42 --png 1 --out .bench/park-blueprints-42
```

The test writes a seeded Compact SVG and JSON under `.bench/park-blueprints`. The command writes a gallery, SVGs, optional
PNGs and machine-readable measurements across park sizes/layouts. It projects oriented structures, mature tree crowns,
actual-width public paths and queues, and ride aprons; overlapping footprints count once. The study parcel is the public
realm/attraction convex hull plus 20 m. Its diagnostics include land-use coverage, the largest empty circle, connected
stations, network loops, entrance walking distance and path-edge frontage. Frontage is a perpendicular 15 m sightline
from each actual path edge, sampled every 5 m; it is a spatial diagnostic, not proof of visual realism.

Save each iteration in a separate directory. A frozen `bundle/blueprint.mjs` can be remeasured with the current metrics
using `--generation-bundle <path>`, so fixes to measurement semantics apply to both the before and after layouts.
Inspect both the blueprint and native aerial/ground-level renders: canopy coverage alone can conceal sparse architecture,
while a tidy plan can still contain raised intersections, gaps in boarding approaches or weak ride silhouettes.

Real park layout references include the [official Epic Universe map](https://www.universalorlando.com/contentdata/uor/en/us/files/Documents/universal-epic-universe-park-map-english.pdf)
and [Europa-Park's official 2020 plan](https://www.europapark.de/sites/default/files/media_document/2021-02/ubersichtsplan_confertainment_parkbereich_2020.pdf).
They inform connected village streets, central gardens, attraction courts, screened service areas and peripheral major
coasters. The Europa-Park map is a historical spatial reference. Guest maps are illustrative, so numerical comparisons use
OpenStreetMap metre-projected footprints for [Disneyland](https://www.openstreetmap.org/relation/5586855) and
[Epic Universe](https://www.openstreetmap.org/way/1372221500), plus the more coaster-heavy
[Cedar Point](https://www.openstreetmap.org/relation/11491811). Its [official 2026 guest map](https://www.sixflags.com/cedarpoint/directions)
also shows how dense midway courts coexist with large coaster/water infields. Different attraction mixes require different
land-use proportions; the goal is coherent, usable districts rather than copying a single whole-park percentage.

```powershell
# Input files are saved OSM XML map exports, not image traces.
python tools/park-reference.py --input '.bench/park-reference/disneyland-*.osm' --park Disneyland --out .bench/park-reference/disneyland
node tools/park-reference-metrics.mjs .bench/park-reference/disneyland.json
node tools/park-compare.mjs --before .bench/before/destination-random-1337.json --after .bench/after/destination-random-1337.json --references .bench/park-reference/disneyland.json,.bench/park-reference/epic-plan.json,.bench/park-reference/cedar-point.json
```

The comparison is a portable HTML report with expandable plans. References retain ODbL attribution, concave boundaries
and courtyard holes; semantic themed-land polygons are excluded from constructed coverage. Untagged path widths are
explicit estimates. OSM omissions are unmapped, not confirmed empty land. Boundary definitions differ: Epic Universe's
mapped parcel includes northern expansion/backstage land, so its whole-parcel coverage cannot be treated as a target for
every guest district. Water contributes to land-use coverage but not street enclosure.

For seed 1337, the saved Destination layout baseline occupied 159.7 ha with 11.9% developed coverage and a 302 m largest
empty diameter. The revised layout occupies 88.0 ha with 34.7% coverage and a 90 m diameter; all 18 stations remain
connected. These use the same footprint/canopy measurement method on both generation snapshots. The real reference
plans have different attraction mixes and boundary definitions, and the generated layout still has more regular
coaster parcels and repeated building blocks. Neither these measurements nor passing clearance tests establish
photorealism; native close-up inspection remains necessary.
The subsequent Mega packing pass reduced its parcel from 202.5 to 144.3 ha, raised coverage from 19.9% to 26.6%, and
reduced its largest empty diameter from 157 to 99 m. All 32 stations are connected, with a longest entrance walk of
2.06 km. A tighter candidate was rejected because its entrance detour increased that walk to 2.94 km.

```powershell
npm run typecheck
npm test
npm run build
node tools/park-bench.mjs --width 3840 --perf240 1 --out .bench/park-bench
```

The park tests cover 100 seeds across all sizes/layouts/themes, graph connectivity, flight-guide clearance, train force
envelopes, integration convergence, a 600-second operating run, guest/seat/queue conservation, thin/moving collisions,
inverted riders, drop braking, versioned sharing and graphics-independent world construction.
Additional checks cover loaded Enterprise and Top Spin cycles, bounded motor power/torque, dissipative braking, moving
boarding decks, low pedestrian obstacles, resident GPU instance uploads and frozen animation history.

Verification of the preceding layout pass on 2026-10-08: all 251 Vitest files / 2,791 tests and 45 dashboard tests passed (`npm test`, 472 s),
along with the three Python reference tests and the production build. Browser checks covered recipe sharing, coaster
selection, start, pause/resume, respawn, device-loss recovery and unsigned seed wraparound. The combined visual review
is `.bench/park-review-final/index.html`; the full test log is `.bench/park-full-test.log`.

For 4K output, start with **Performance 240**, **dynamic resolution on** and a **60 fps target**. This preset's name is shared
with the existing engine; it reduces ray/probe/cloud work, while park physics and guest counts stay unchanged. Native 4K
Ultra is substantially heavier. Mega's 10,000 guests are a stress configuration, not the default performance workload.

`tools/park-bench.mjs` runs the production renderer, park simulation, crowd and 4 kHz drone contact solver on the physical
GPU. It captures aerial, midway, coaster, indoor and night views, reports CPU/GPU intervals and output/internal resolution,
and checks GPU validation plus CPU/GPU ray parity. Drone positions are scripted; browser presentation, pilot input,
HUD and audio are outside this native benchmark. End-to-end browser FPS can differ.

The construction-interface review is [`.bench/park-connections-review/index.html`](../../../.bench/park-connections-review/index.html).
Final verification: `npm test` passed all 268 Vitest files / 2,893 tests and 45 dashboard tests in 528 seconds,
including the 100-seed construction/flight-clearance sweep and 600-second passenger-conservation run. `npm run build`
passed TypeScript and the production bundle. The logs are `.bench/park-connections-verified-test.log` and
`.bench/park-connections-verified-build.log`.
The review includes three current blueprints, declared-contact maps, 13 native closeups, the rejected/corrected stair images,
hardware primitive checks and frozen bundle identifiers. Seed 1337 has 136,085 declared interfaces across Compact,
Destination and Mega; all pass at 0, 7, 18, 35, 60 and 95 seconds, at fixed and half-tick poses. Destination seed 4201
adds 44,787 passing declarations. These are checks of declared interfaces, supplemented by finite-area and clearance
tests; they do not certify every material surface or structural capacity. Current seed-1337 Destination coverage is
35.0%, its largest empty diameter is 83 m, and all 18 stations remain reachable. The geometry remains visibly procedural.

After the connection fixes and collision/culling optimizations, the same RX 9070 XT measured the following isolated
Destination results on 2026-10-08: 3,000 guests, 3840×2160 output, High + Performance 240, adaptive resolution,
two frames in flight, 240 warm-up / 300 measured frames per view.

| View | Throughput | Median CPU | Median GPU | Final internal resolution |
| --- | ---: | ---: | ---: | --- |
| Aerial | 60.8 fps | 15.20 ms | 13.70 ms | 1920×1080 |
| Midway | 63.4 fps | 15.17 ms | 12.39 ms | 1614×908 |
| Coaster | 64.8 fps | 14.68 ms | 7.80 ms | 2688×1512 |
| Indoor | 58.1 fps | 16.13 ms | 15.01 ms | 3072×1728 |
| Night | 57.8 fps | 16.53 ms | 13.11 ms | 2304×1296 |

The preceding unoptimized construction build measured 41.2–55.3 fps. Adaptive resolution differs between runs,
so these throughput results are not a fixed-resolution GPU speedup. Controlled CPU comparisons on identical inputs
reduced moving-bound synchronization from 770 to 218 µs per tick and detailed contact near a moving train from
73.4 to 32.2 µs per query; the severe sweep workload changed from 76.8 to 72.5 µs. Removing a hardcoded ride-distance
cutoff increased empty-location query cost, because the complete moving geometry is now considered. Renderer culling
preserved byte-identical output across 103 cameras/resolutions while reducing the isolated midway module update from
6.67 to 4.47 ms. Full-motion collision candidate bounds do not make the existing secant-based sweep/response exact.

The current 10,000-guest Mega stress run at 1280×720 measured 25.9 / 26.6 fps for aerial/midway, with median CPU
37.66 / 36.53 ms and 60 warm-up / 60 measured frames. It remains CPU-limited. Both native runs passed GPU validation
and 2,000 CPU/GPU ray comparisons each. An additional 175 targeted rays over 67 primitive fixtures had a maximum
distance discrepancy of 34.2 µm. Reports are in `.bench/park-connections-verified-performance`,
`.bench/park-connections-verified-mega` and `.bench/park-connections-verified-primitives`.

Measured before the construction-interface pass on 2026-10-08 with an RX 9070 XT (D3D12 driver 32.0.32015.2008), Destination seed 1337 and 3,000 guests:
3840×2160 output, High + Performance 240, adaptive resolution, two frames in flight, 240 warm-up / 300 measured frames
per view. These are native throughput measurements with the drone contact solver running near the scripted camera.

| View | Throughput | Median CPU | Median GPU | Final internal resolution |
| --- | ---: | ---: | ---: | --- |
| Aerial | 71.5 fps | 11.38 ms | 12.12 ms | 1614×908 |
| Midway | 77.1 fps | 11.50 ms | 11.27 ms | 1614×908 |
| Coaster | 96.4 fps | 9.47 ms | 8.52 ms | 2304×1296 |
| Indoor | 77.2 fps | 12.09 ms | 10.03 ms | 1920×1080 |
| Night | 103.5 fps | 8.65 ms | 7.47 ms | 1614×908 |

GPU validation reported no errors; 1,000 BVH rays and 1,000 terrain rays matched the CPU reference (maximum terrain
distance error 0.00037 m). The CPU and GPU intervals overlap, and throughput also includes submission/wait overhead;
adding their median times does not yield the measured frame interval. Internal resolution varies throughout each run.

A separate Mega smoke run with 10,000 guests at 1280×720, High + Performance 240, passed GPU validation and the same ray
checks. Its aerial and midway views measured 41.6 / 34.0 fps (median CPU 21.53 / 26.29 ms), with 60 warm-up / 60 measured frames per view.
This population is CPU-limited on the test machine; the 60 fps target applies to the default Destination workload above.

These are measurements of the preceding denser layout, not isolated speedups against the earlier layout or measurements
of the subsequent construction-interface changes.
Two controlled CPU comparisons used identical geometry and inputs: moving collision-bound synchronization fell from
0.896 to 0.388 ms per operating update (8,516 moving parts / 484 bodies), and packing 11,054 dynamic ray primitives fell
from 0.618 to 0.302 ms. Collision synchronization skips unchanged bodies, caches endpoint bounds and refits only affected
BVH ancestors; material packing avoids temporary array copies and needless zero-emission conversion. Detailed collision
geometry remains active. Final native reports are saved in `.bench/park-final-performance` and
`.bench/park-mega-final-performance`; the controlled CPU reports are in `.bench/collision-perf` and `.bench/rt-pack-perf`.

Useful options: `--park compact|destination|mega`, `--guests 10000`, `--seed 42`, `--quality high`, `--perf240 1`,
`--dynamic 0`, `--scale 0.75`, `--warmup 240`, `--frames 300`, `--scenes coaster,indoor`, `--profile 1`, `--capture 0`.
Inspection views also include `shop`, `district`, `crowd`, `station`, `train`, `inverted`, `coupler`, `wheel`, `swings`,
`tower`, `enterprise`, `topspin`, `roof`, `junction`, `tree` and `stairs`; `--sim-seconds 35` advances the operating simulation
before capture, and reports include the phase, angular state and passenger count of every attraction.
The stair camera follows an actual passenger using the generated treads; Destination seed 1337 with
`--scenes stairs --sim-seconds 49 --warmup 60 --frames 60` reproduces the corrected stair inspection.
The default allows two submissions in flight, matching park rendering. `--in-flight 1` measures serialized CPU/GPU cost;
`--flight-physics 0` leaves drone physics on the launch pad for a rendering-focused comparison. Detailed profiling adds
pass segmentation overhead. JSON reports and PNGs are written under the requested output directory.
`--cpu-profile 1` records a per-view Chrome/Node CPU profile during measured frames only; profiling adds overhead and
should be disabled for the final throughput comparison.
