# Procedural park construction interfaces

The park shares dimensions and rigid transforms between generation, collision, rendering and operation. The construction ledger records selected interfaces between primitives; it does not discover every contact automatically. A passing ledger is evidence about those declarations, not an exhaustive surface-intersection or structural analysis.

## Units and transform contract

Distances are metres, time is seconds and angles are radians. `ParkPart.half` contains half dimensions. A part's position is in its rigid body's frame, or world space when `body < 0`. A `Parts` builder accepts local positions and composes its yaw with `localRot`; `rot` explicitly replaces that rotation in the parent frame. Rod endpoints define their complete transform and capped-cylinder length.

The `gable` primitive is a triangular prism with normalized vertices `(-1,-1,±1)`, `(1,-1,±1)`, `(0,1,±1)`. Its raster mesh, collision distance, ray intersection and blueprint projection share that contract. It supplies roof infill, bearing shoes and horizontal pavement fragments.

`registerJoint` stores primitive-local anchor points and, where relevant, axes. For a primitive transform `(R,p)` and body transform `(Rb,pb)`, the world anchor is:

```text
A = pb + Rb · (p + R · a)
```

For static parts, the body transform is identity. Fixed interfaces require coincident anchors. Hinges require coincident, coaxial reference axes; sliders permit the explicitly declared axial interval. Clearance declarations measure a specified separation along the declared axis.

`anchorModel` explicitly selects `material` (the default) or `virtual-axis`, independently of joint kind. Material anchors must lie on or inside their declared primitives. `anchorError` is the maximum positive signed primitive distance of either local anchor, and exceeding the numerical bound fails the joint. A virtual hinge centre can lie in an empty bearing bore; that exemption requires the explicit field and is never inferred from a name or rationale. Material containment and matching anchors still do not prove flush contact over a finite area.

The numerical distance tolerance is `128 × Number.EPSILON × max(1, coordinate magnitudes, local-anchor magnitudes)`. It bounds floating-point transform operations. Designed clearances and strokes use explicit metre-valued `min`/`max` ranges, not a larger numerical tolerance. Finalizers that remove parts must call `remapConstructionJoints`; removing a referenced part is an error.

Between fixed simulation ticks, generalized angles, slider positions and rail distance are interpolated before forward kinematics. Interpolating each body's world position independently traces different chords and separates connected pivots. Parent-first and child-first pose requests share the same coordinate cache. Seated pelvis and partial boarding poses use the resulting seat transform as well.

`coasterChassis.ts` solves the rail distance between two bogies from the fixed Euclidean distance between their spherical kingpins. `coasterTrain.ts` then solves each following car's rail coordinate from the fixed distance between adjacent drawbar bearings. A shared per-train cache supplies chassis, bogie and drawbar frames; bounded warm-start corrections avoid repeating the full bracket search each tick. Periodic rail distances are reduced before adding small axle offsets, preventing precision loss after many laps. The seven-family, two-seed, two-car-length sweep measured a maximum linkage residual of `8.4e-12 m`. The longitudinal RK4 force model remains a nominal equally spaced rail-mass approximation: in that sweep, the solved train tail differed from those nominal rail coordinates by at most `0.40345 m`. This is a measured discrepancy for those cases, not a proof over every seed or a solved coupler-force model.

## Ground, public surfaces and architecture

`surfaces.ts` defines `PARK_GRADE = 12`, `PAVING_RISE = 0.2`, and `PAVING_TOP = 12.2`. Public paths, queue beds, ride aprons, access forecourts, terrace approaches and shop thresholds use this finished contact plane. Slab height is derived from its top and bottom planes independently of a builder's local origin. Navigation and guest soles use the same level; raised platforms and stairs retain their own derived contact heights.

Guest motion is kinematic. On level paving, the two-bone gait plants an actual shoe sole on the shared contact plane; boarding ends at a supported staging point before a reversible sitting transfer attaches the pelvis to the seat. Seat height and guest leg length determine the seated knee angle so shoes clear low cabin floors. An exiting passenger retains their seat reservation and ride interlock until reaching the fixed landing. These contact poses do not simulate independent foot forces or human balance.

Stair flights compile their support planes and tread extents once from the tagged, oriented solid boxes. Footfalls use those faces rather than interpolated waypoint heights. Each swinging foot first lifts, then crosses above every intervening riser with 45 mm clearance, then lowers onto its next tread. A conservative envelope includes the close-up shoe mesh's spline overshoot and all body-depth variants; a large shoe may overhang a lower tread slightly, while its uphill edge remains clear of the next riser. A smooth landing blend joins ordinary gait, and fixed-length two-bone IK limits pelvis height while retaining a softly flexed pose. Current and previous contact records remain associated with guest identity through culling, pauses and boarding. Transformed-shoe tests cover all three LODs, ascent/descent, short and tall guests, actual OBB penetration, ankle forward-kinematics residuals and landing/tread boundary continuity. This is bounded stair contact animation, not a contact-force or human-balance model.

The preferred pelvis datum averages the stance tread height with a smooth interpolation between the swinging foot's source and destination support heights. Swing clearance is excluded. The preferred hip height adds the anatomical hip offset and subtracts a flex allowance of 2.5% of guest height; the common two-leg reach limit can lower it further. During a stop, the datum blends toward the two settled support heights. This keeps preferred hip height tied to the physical supports.

Private boarding and exit routes use opposite stair/landing lanes at ±0.5 m, with 1.2 m following headway enforced through the existing spatial crowd index. These fixed behavioral dimensions were selected against the animated guest envelope. Tests sample every mesh LOD at guest-height and body-build extremes, including arms, knees and shoes, and require at least 80 mm spare between independently posed followers or opposing lanes. A separate regression finds the actual generated sloping handrail cylinders and verifies both complete guest lanes fit inside their inner surfaces. Headway also applies along the approach line to prevent a waiting line compressing at the corridor boundary.

A blocked swing foot settles onto the highest actual tread under its complete footprint over at most 0.25 s. When space opens, the foot rises back to its riser-clearing trajectory before horizontal movement resumes. Opposing-flow and stop/resume tests verify continued progress and this movement interlock. These controls retain the kinematic contact model; they do not add a balance or force solver.

Road strips have exact butt joints between short slabs. Exposed kerb intervals are clipped analytically against oriented rectangular paving and circular aprons after terraces exist. This replaces point sampling that missed short intersections or left a kerb across a later access path. Kerbs have an authored 0.24 m width and 0.05 m upstand above paving.

`pavingUnion.ts` partitions coplanar public slabs and ride aprons into disjoint convex polygons. An apron uses a circumscribed regular polygon whose edges touch its authored circle and whose vertices extend at most `PAVING_CHORD_ERROR = 0.01 m` beyond it. This preserves all original disk coverage, including navigation and kerb contacts. Rendering, collision and ray tracing consume the same polygonal prisms; the cylinder source is hidden and made non-solid. Ride/building finishes own shared areas before paths, with stable source order resolving ties. Differently coloured finishes never share an interior surface at the same height.

Most untouched rectangles remain boxes. Clipped rectangles remain boxes where possible; other fragments use exact isosceles gable prisms. An intact apron uses one isosceles sector per polygon edge. A right triangle uses two prisms joined at its hypotenuse midpoint; a general triangle first splits at an altitude. The pieces preserve the polygonal footprint and contact plane without depth offsets. Degenerate fragments below `1e-7 m²` are discarded to bound numerical slivers. Hidden source indices remain stable, but construction anchors must reference actual retained material; the Destination/Mega budget regression checks that none reference hidden paving sources.

Facade openings are partitioned from shared floor, sill, head and pier coordinates. Wall panels, window frames, glazing and closed door leaves meet those opening edges. Shop floors and forecourts abut instead of overlapping differently coloured coplanar faces. Towers outside the main slab have their own ground-bearing foundations. Planting roots in raised ellipsoidal soil beds use the evaluated soil surface rather than a uniform height offset.

For a pitched roof with half-width `w`, rise `r`, supporting wall half-width `s` and wall-top height `H`, its underside is:

```text
y(x) = H + (r / w) · (s − |x|)
angle = atan2(r, w)
```

Roof-panel placement includes the normal thickness term `halfThickness / cos(angle)`. Gable tops use the same plane equation; they do not approximate the slope with stepped boxes. The facade/roof tests sample the complete gable slopes across pitches and yaw angles.

Sloping awnings use a flat-bottom bearing shoe above each vertical post. The post's horizontal cap bears against the shoe base, and a sloped shoe facet matches the canopy underside. Tests check a finite area around the post cap and across that facet. Coincident centre anchors alone would not establish this flush contact. Author-selected dimensions such as roof pitch, panel thickness, pier width and support spacing are design inputs; they are not inferred structural capacities.

The hanging valance attaches to the finite panel's rotated lower front edge. For a front centre height `F`, panel half-thickness `t` and pitch `a`, its seam is at `y = F − t·cos(a)`, `z = frontZ − t·sin(a)`. Evaluating the infinite underside plane at `frontZ` instead leaves a small physical gap. The seam regression checks its full width over multiple pitches and builder headings; this fabric edge connection is distinct from the finite-area post bearings.

Roof gutters also derive their contact from the finite, rotated eave edge, including the thickness-dependent horizontal shift, and downpipes share their actual outlet axes. Their full-length seams are tested over roof pitches, headings and panel thicknesses. Space-themed cladding derives its back plane from the actual host wall face; changing the wall thickness must preserve that contact. These interfaces have both surface tests and explicit construction declarations; gutters remain closed solid proxies.

## Generator coverage

| Generator family | Shared dimensions or declared interfaces |
| --- | --- |
| Steel, launch, inverted, wooden, hyper, mine and space coasters | Rail gauge/radius, wheel radii, spine offset, rail chord limit, car wheelbase, bogie bearing centres, restraints, seat mounts, station/stair contact geometry |
| Wheel | Main spindle and hanging cabin hinge axes; A-frame legs cast in footings, their tops held in apex housings sized from where the leg ends sit; rim and support planes derived from bearing size plus running clearance |
| Ship and rotating pendulum | Main pivot and arm-to-passenger assembly interface; bulwarks stand on the deck |
| Drop/observation towers | Tower aperture, annular passenger platform and turntable reference axis; columns in footings, split X-braces ending inside the through brace |
| Carousel and flying swings | Carousel built as the Tilden Park manual describes. The top thrust bearing on the fixed centre pole carries the whole machine. The platform hangs from the sweeps (the ceiling) on two drop rods per sweep, and a cheese bearing low on the pole keeps it centred. Each jumper pole moves with its figure: its top hangs inside the ceiling where the cranks are, and its foot slides in a high hat on the platform. The 10 in stroke at 4 1/3 bobs per turn (`carouselLift`; sizes in `CAROUSEL`, `rideDimensions.ts`) is shared by the model, runtime and motion bounds. The cranks themselves are not modelled. The saddle is a seat on the horse's back, and each stirrup strap is a bent tube lying 3 to 6 mm off the barrel from under the seat down the horse's side. Lamps sit on the rounding boards. Swings: chain endpoints and suspension axes |
| Teacups | Built as the Disney patent, Technical Park and the Zamperla listing describe: the main turntable carries 3 smaller turntables, each on its own boss and hinge, and each small turntable carries 2 cups that turn on their own pins and thrust plates. Sizes and turning rates are assumed. Each cup has an open door, a centre wheel and 4 seats clear of the door. Layout (`TEACUPS` in `rideDimensions.ts`) is shared by the model, runtime, motion bounds, rider seats and the boarding point, which lands on whichever turntable the door opens onto |
| Scrambler | Built as Eli Bridge's bulletins describe: stationary centre pole, top sweeps held by tie rods from a crown on the top hub, bottom sweeps 3.5 in above the walkway, a unit pole at each of the 3 arm tips, and 4 seat sweeps per unit each bolted to a two-seat car (12 cars). Heights and sizes are assumed. Layout (`SCRAMBLER` in `flatPhysics.ts`) is shared by the model, runtime, motion bounds and rider seats |
| Enterprise | Boom pivot outside the gondola ring, boom lying in a slot through the deck, three-stage lift ram in the pit, rotor hub on the boom spindle, cabins on hangers. Pivot, boom, ram and deck dimensions (`flatPhysics.ts`) are shared by the model, runtime, motion bounds and boarding; riders board only the 17 cabins over the deck |
| Top Spin | Main arm pivots and gondola shafts; the loading floor lowers on four rams by the drop that clears the gondola sweep (`TOPSPIN_PLATFORM_DROP`). The lowering floor is assumed: NAFLIC bulletin 215 says some Top Spin-type designs have retracting floor sections, and no HUSS source says either way. Each arm runs on past its hub to a round counterweight disc, as the HUSS looping-swing patent (US5188566) and two photos show; disc size is assumed |
| All eight architectural themes | Shared facade partitions and paving datum; pitched variants use closed gable infill; awning posts use finite-area bearing shoes |
| Street and queue furniture | Bench slat/rail/upright contacts; grade-bearing lamp and entrance foundations; lamp housing/diffuser, stool pedestal, bin lid and service-door frame/pull contacts; sign standoffs and flush glyph backs |
| Landscape | Soil-profile root placement, generated branch/foliage attachment and conservative physical planting clearance |

`rideDimensions.ts` contains authored mechanical contact dimensions in metres. Dynamic mechanisms use the operating transforms and their declared hierarchy rather than independent animation offsets. The coaster is a rail-constrained model, not a suspension/contact-force simulation. Chordal rail rendering and collision use the explicit `RAIL.chordError` bound; vegetation LOD meshes and coarse ray proxies remain separately bounded approximations. Mesh LOD faceting does not change the analytic primitive or its declared joint.

The ledger is supplemented by finite-area architecture tests, primitive/ray parity tests, loaded-train clearance sweeps, public-access paving tests and flight-guide collision sweeps. None of these substitutes for the others. In particular, matching hinge axes does not prove that the bearing solids are correctly shaped, and matching fixed anchors does not exclude another part intersecting the assembly.

Collision queries can request a leading prefix of a coaster train. A later request at the same head coordinate extends that exact solution without recomputing already solved cars; a changed coordinate invalidates the prefix. Tests compare full and incrementally extended solves and require identical leader poses and station coordinates. This changes evaluation cost, not drawbar length, wheelbase or solver tolerance.

The tower top-cap half-width is derived from guide-column offset plus radius. Tests verify complete column-end containment and compare the cap's circumradius with the closest radial point of every actual roof panel. That radial proof covers the whole rotating roof sweep, including maximum travel where the fixed cap and moving roof overlap vertically.

The static furniture source audit also covers queue rail ends and gateway posts, terrace tables/kiosks/planters, shop vents/trim, decorative pipes and service-building door skins. Bench tests traverse the support graph from ground-bearing legs to every slat and sample finite bearing patches. Queue and landmark roof-post shoes use the actual underside gradient, with finite-area tests on both slope axes. Shop sign spacers terminate at an explicit host plane; tests verify the far cap against a wall as well as the board contact. Small decorative cladding uses touching or intentionally lapped faces. These checks do not make solid bin bodies, umbrella cones, globe lamps, pipe clamps, gutters or foliage proxies hollow fabricated assemblies: sockets and clamps may intentionally overlap closed primitives, and bolts, adhesives, sheet folds and structural capacities are not exhaustively modeled.

Dynamic collision candidates use geometry-derived bounds over the complete interpolated FK interval: trigonometric extrema, inherited pivot offsets and the coaster solvers' brackets enclose body motion between stored states. Each body retains its detailed primitive geometry in an immutable local BVH. Signed AABB distance supplies a conservative lower bound for nearest-shape pruning, including points inside overlapping boxes. This improves the broad phase without replacing detailed collision shapes with ride-radius proxies. The temporal sweep still advances using endpoint linear/angular secant rates, and contact response uses those same approximate rates. They are not guaranteed bounds on nonlinear instantaneous motion; complete interval candidate coverage therefore does not certify exact continuous collision detection or exact contact velocity.

## Construction audit

`constructionAudit.ts` checks the generated solids themselves, independently of the joint ledger above. Every part is a convex primitive, so contact, separation and penetration depth come from exact support functions and GJK (`interference.ts`); a median-split box tree only chooses which pairs to test. Two surfaces closer than `CONTACT_TOLERANCE` (0.5 mm) are in contact.

Where two parts may legitimately share space, the generator declares why, with both sides derived from the same dimensions:

| Declaration | Meaning | What the audit requires |
| --- | --- | --- |
| `insert` (`insertEnd`) | A member end is set into a receiving part | The whole end section, cap included, lies inside the receiver |
| `coaxial` | A shaft runs through a bore or sleeve | The shaft stays inside the bore's radius over the bore's length |
| `bear` | One part stands on another | Contact without penetration |
| Monolith | Parts of one casting, moulding or weldment | Overlap between its pieces is allowed |
| Chain monolith | Segments of one bent tube | Only neighbouring segments may overlap; every knuckle is still checked |

A contract naming a monolith's first part covers the whole piece. Where members cross at a node, the length each receiver hides is bounded per receiver.

The audit then reports, per part, with the measured error, location and a reproducible camera view:

- **Penetration**: an overlap no declaration explains, with a certified depth.
- **Contract violation**: a declared insert or sleeve whose geometry breaks it (an end out of its receiver, a shaft out of its bore).
- **Protruding end**: a rod end cap partly buried in a part with its rim showing. A shaft through its bore, a member entering through an end face, or a boss of the same non-chain monolith may pierce a face as built.
- **Floating**: a part with no path to the ground through contacts and declared joints.
- **Coplanar conflict**: coincident faces with different finishes, which would flicker.
- **Degenerate part**: zero-size or inverted primitives.

`motionAudit.ts` runs the real ride simulation and tests moving parts against static structure and other bodies. A pair's separation changes no faster than their relative point speed (body velocity, angular velocity times reach, plus a 6 g acceleration envelope over the interval). So no contact can occur between samples whose clearances sum to more than that speed times the step. Pairs that fail this bound are re-run at every 4 ms simulation tick. The 6 g envelope is a simulation bound, not a certified figure.

Pairs that still fail the bound at 4 ms are listed as uncertified: between those ticks the sampler cannot rule out a contact. `.bench/classify-uncertified.mjs <audit dir>` sorts them by what the generator declared between the two parts. In the teacups and Scrambler runs (120 s each, 1337 destination), they fall into two groups:
- bearing faces touching across a declared hinge (cup plates on their pins, table discs on their bosses, Scrambler restraint bars on their hub bearings). These are checked by the joint ledger, not by sampling.
- pairs that kept at least 5 mm clear at every 4 ms tick but turn too fast for the bound to clear them. For example, a teacup plate 20 mm above its table disc: both turn only about vertical axes, so the gap cannot close, but the sampler does not use that.

Round parts are drawn as 6-, 12- or 48-sided meshes whose vertices lie on the exact surface. The renderer picks the coarsest mesh whose facet gap, r(1 − cos(π/n)), stays within `ROUND_MESH_ERROR` (0.5 px) on screen (`src/render/park/index.ts`). The 48-sided mesh is the finest; on a 10.8 m turntable its 23 mm gap exceeds half a pixel only up close, where it is still less than the 50 mm `END_COVER` that hides member ends.

Fixtures: `constructionAudit.test.ts` audits 13 small assemblies, 7 defective and 6 sound, at three placements (axis-aligned, turned, tilted about a skew axis) and three sizes (×0.25, ×1, ×4). Each defect must be reported against the part that carries it, and each sound assembly must come out clean. `motionAudit.test.ts` places a fixed post where only the turning Top Spin gondola reaches it; the rest audit passes it and the motion audit reports it after dispatch.

Limits: the audit checks the declared convex proxies. It does not model bolts, weld beads, sheet folds or structural capacity. It runs at sampled seeds, sizes and times, and is not a proof over every generated park.

## Rules every generator shares

These hold for every family and theme because they live in the shared builders, with a park-wide test for each:

| Rule | Where it is enforced | Test |
| --- | --- | --- |
| Benches and path lamps stand only where nothing solid is already built (paving excepted) | `furnitureClearance` in `furniture.ts`, used by the path loop | `furniturePlacement.test.ts` (benches, path lamps, queue rails and canopies at three seeds) |
| A light is cast by glowing parts you can see: it sits at their centre, has their colour, and their glow gives its candela through their lit area (emitted luminance is colour × emissive × `EMISSIVE_MAX_NITS`) | `luminaire()` in `parts.ts`; path lamps, area lamps and show-building orbs use it | `luminaire.test.ts` |
| Concrete, timber, fabric, masonry, foliage, paving and glass are non-metals, so their metalness is 0 | `Parts.part` refuses anything else; recolouring after build keeps the rule | `materials.test.ts` (builder and two whole parks) |
| A round part's faceted mesh stays within 0.5 px of the exact part | `ROUND_MESH_ERROR` in `src/render/park/index.ts` | `src/render/park/index.test.ts` |
| A seated rider of any size, tallest and broadest included, stays within 3.5 cm of the ride's solid parts (foam give). No family has a cap. The carousel saddle used to be a flat blanket 0.8 m wide that stood out from the barrel like a shelf, and small children's knees went 5 cm through it; it is now a seat on the horse's back with the stirrup straps lying along the barrel. Small children's feet still rest 1 to 2.6 cm into the horse's side. Child leg proportions are left as they are because no measured source was found; end seats are spaced from walls by the widest seated rider (`GUEST_SEATED_HALF_WIDTH`), not the seat | Shared seat layouts (`shipSeat`, `topSpinSeatX`, `CAROUSEL_WITHERS`) read by the model and the runtime | `guestRide.test.ts` (every family, 1.05 to 1.95 m), `guestHorse.test.ts` |
| Riders are seated only where they can walk off | Ride boarding order (`runtime.ts`), from the same deck rule the deck builder uses | `flatPhysics.test.ts`, `enterpriseDeck.test.ts` |
| Ride stairs: risers at most 7 in, handrail grip top 34 to 38 in above the nosings, 1.5 in clear of balusters, touched only from below (ADA 2010 504.2, 505.4, 505.5, 505.6, read in the standard text) | `stairFlight` in `assembly.ts`; guarded stairs carry a separate guard rail | `stairs.test.ts` |

## Coverage inventory

What has been checked, how, and what has not. "Sampled" means seeds 1337 (destination), 7 and 4294967295 (compact and mega) at t = 0 unless stated.

| Area | Checked by | Status and gaps |
| --- | --- | --- |
| Flat rides at rest (11 families) | Construction audit, sampled | No penetrations, contract violations, coplanar or degenerate parts. Remaining: bent-tube knuckle ends on teacup rims and Enterprise hoops |
| Flat rides in motion | Motion audit from opening at 1337 destination: teacups, Scrambler and carousel 120 s each, all 11 families 240 s | Teacups, Scrambler and carousel: 0 findings over 33,601 samples each, with uncertified pairs as described above (`.bench/teacups-motion`, `.bench/scrambler-motion`, `.bench/carousel-motion`; the carousel jumper poles keep 48 mm inside their high hats and below the roof). All families: `.bench/realism-motion`. The 6 g envelope is assumed |
| Top Spin floor against the gondola | Exact support-function sweep over 3600 pitches | Covers every arm angle (lowest gondola point is at arm angle 0) |
| Coasters | Joint ledger, loaded-train sweeps, construction audit | Space coaster show building built across its own station and queue (open) |
| Street furniture and queue scenery | Bench and lamp source audits, furniture placement test | Queue scenery inside the space coaster's show building (open, same cause) |
| Buildings and architecture | Finite-area architecture tests, construction audit | Bolts, gutters and pipes are closed solids |
| Lights and materials | `luminaire.test.ts`, `materials.test.ts` | Decorative ride bulbs glow without casting light; light colour is a tint, not a measured spectrum |
| Vegetation, shadows, guests | Separate work (see `TASKS.md`) | Not covered by this audit |
| Mesh level of detail | Facet error rule and test | Vegetation LOD and coarse ray proxies are bounded separately |

## Reproduce the checks

Run focused geometry tests from the repository root:

```powershell
npx vitest run src/world/park/architecture.test.ts src/world/park/surfaces.test.ts src/world/park/theme.test.ts src/world/park/furniture.test.ts
npx vitest run src/world/park/pavingUnion.test.ts src/world/park/parkBudget.test.ts
npx vitest run src/world/park/construction.test.ts src/world/park/park.test.ts
npx vitest run src/world/park/boarding.test.ts src/world/park/guestStairs.test.ts src/render/park/guestPose.test.ts src/render/park/index.test.ts
npx vitest run src/world/park/constructionAudit.test.ts src/world/park/motionAudit.test.ts src/world/park/enterpriseDeck.test.ts
npx vitest run src/world/park/furniturePlacement.test.ts src/world/park/luminaire.test.ts src/world/park/materials.test.ts src/world/park/stairs.test.ts
node tools/park-audit.mjs --out .bench/park-audit --families wheel,ship,pendulum,topspin,drop,observation,swings,carousel,teacups,scrambler,enterprise --times 0
node tools/park-audit.mjs --out .bench/park-motion --families topspin,enterprise --times 0 --motion --motion-span 240
node tools/park-audit-explain.mjs --report .bench/park-audit --match "penetration" --examples 3
node tools/park-joints.mjs --out .bench/park-joints
node tools/park-joints.mjs --sizes destination --seed 4201 --times 0,7,18,35,60,95 --out .bench/park-joints-4201
```

The joint tool bundles the production builder and runtime. Its defaults cover Compact, Destination and Mega with seed 1337, sampling at 0, 7, 18, 35, 60 and 95 seconds at both full and half fixed-tick poses. JSON records worst errors, including `maxAnchorError`, sample times, joint kind/contact-model/family/name groups, generation time and geometry counts. SVG contact markers and an HTML gallery support review. Failed declarations produce a nonzero exit status. The artifacts state their coverage limitations and read the material/virtual-axis distinction directly from `anchorModel`.

Native `park-bench.mjs` roof, junction, station and ride closeups provide a separate visual check. Rendering and benchmark artifacts should identify their frozen source bundle; results captured while another generator or runtime change was in progress are not final validation.
