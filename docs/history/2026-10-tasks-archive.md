<!-- The full TASKS.md as it stood on 2026-10-11 before it was rewritten as an open-items backlog. Kept verbatim for its detail; current open work is in TASKS.md. -->

# PPO drone brains

Goal: train a neural pilot with PPO on this game's own flight model, headless on the GPU (AMD RX 9070 XT via Dawn), then load a
trained brain into the player's drone or watch several brains race in a spectator mode.

Rules: the flight model in `src/sim` is not changed. The GPU trainer runs a WGSL transcription of it, proven against the
TypeScript model by a parity test. The brain always flies the real TypeScript model in the game.

## Shared brain core (`src/ai`)
- [x] Brain spec: observation layout, action mapping (acro sticks through the real FC), fixed policy rate, physics rate
- [x] Observation builder in TS (runtime) with the same maths as the WGSL one
- [x] MLP policy forward in TS, brain file format (JSON + base64 float32), load/validate
- [x] BrainPilot: drives a quad's sticks at the fixed policy rate on physics-step boundaries
- [x] BrainRacer: a brain-flown QuadPhysics with the session's arming and respawn rules (rivals, eval)

## GPU trainer (headless, `tools/brain`)
- [x] Training worlds: terrain, PadGround, track, track + vegetation colliders, packed for the GPU (heights, boxes, grid)
- [x] WGSL flight model: rigid body, motors, props, battery, IMU, wind, FC (Mahony, RPM filter, PT1s, rates, PID, mixer), contacts
- [x] Parity test: GPU model vs `QuadPhysics` on scripted stick sequences (`node tools/brain/parity.mjs`)
- [x] Env kernel: K substeps per action, gates, reward, termination, resets, observations, all resident on the GPU
- [x] Policy kernels: tiled matmul forward, sampling, value
- [x] GAE kernel, advantage normalisation
- [x] PPO update kernels: loss, backward (tanh MLP), split-K weight gradients, grad-norm clip, Adam
- [x] Gradient check against a CPU reference (`node tools/brain/gradcheck.mjs`)
- [x] GPU observation vs TS `observe` check (`node tools/brain/obscheck.mjs`)
- [x] Trainer host: iteration loop, metrics readback only, checkpoints into `public/brains`
- [x] Evaluation in the real TS sim on unseen tracks (`node tools/brain/eval.mjs`)
- [x] Throughput: 1.5M decisions/s = 120M physics steps/s at 16384 drones

## Game integration
- [x] Session pilot hook (brain flies the player's quad, arms after GO, always respawns)
- [x] Load a brain into the player's drone (AI pilots tab, file load, `?brain=`) and watch it fly
- [x] Spectator mode: race several brains on the same track (`?race=a,b`), N drones rendered, follow camera, leaderboard
- [x] Train the race roster into `public/brains`: ace, steady, dash, rookie (all finish 8/8 unseen tracks in the TS sim; mean finish 35.9 / 40.9 / 51.2 / 55.0 s)
- [x] Tests, typecheck
- [x] Build
- [x] Stall rescue: a brain with no gate for 15 s goes back to its last gate (racers and the player quad)
- [x] README section, npm scripts brain:train/eval/publish/check
- [ ] Screenshots: blocked, CloakBrowser's Chromium has no dxil.dll so WebGPU cannot start in it

## Found
- Dawn (npm `webgpu` 0.6.2): the GPU instance returned by `create()` must stay referenced, or the next GPU call segfaults.
- Dawn cannot load Vulkan on this machine (`vulkan-1.dll` LoadLibrary error 87); the trainer runs on D3D12.
- Vite's bundler loaded in the same process as Dawn crashed it too; the trainer bundles in a child process.
- CloakBrowser's Chromium 146 build ships without dxil.dll/dxcompiler.dll; Dawn D3D12 fails at requestDevice (error 87). Launching it with `--disable-dawn-features=use_dxc` should make Dawn fall back to FXC.
- run1 (20 min, 1.7B decisions, 6 worlds) finishes all 4 unseen eval tracks in the TS sim (22 crashes). 15 more minutes on the same 6 worlds (first ace) got better training numbers but 68 crashes on unseen tracks: overfitting. On 48 fresh worlds run1 crashes in 62-67% of episodes vs 30% on its own. The trainer now defaults to 48 worlds; the roster retrains on 48.

# Crazy tracks, live training dashboard, track builder

Goal: more gate types (split-S and friends), crazy tracks and new objects, all flyable by the GPU trainer; a live training
dashboard (scrubbing, interactive charts, top-down view) at no real cost to throughput; a separate track builder mode with
variables whose tracks drones can fly and race on, with leaderboards.

- [x] Map the subsystems (track generator, render/colliders, trainer, app/UI): .bench/maps/*.json
- [x] Shared contracts: gate kinds, obstacle kinds, track recipe, styles (src/contracts.ts, .bench/plan/CONTRACTS.md)
- [x] Implementation workflow running: units A track gen, B meshes/colliders, C trainer, D dashboard, E builder (each reviewed + fixed)
- [x] New gate kinds + meshes + colliders + GPU shape support
- [x] Manoeuvre features (split-S, power loop, corkscrew, ladder, dive, slalom, hairpin) and crazy styles in the generator
- [x] New obstacle objects (meshes + box colliders)
- [x] Live training dashboard (server in train.mjs, trajectory ring buffer on the GPU, charts, scrubbing, top-down)
- [x] Track builder mode (recipe variables, previews, save/export, fly, race brains, leaderboards)
- [x] Trainer: custom track files, new styles in the world mix
- [ ] Retrain the roster on the new tracks; eval on split-S tracks
- [x] Integration: typecheck, 2630 vitest + 32 dashboard tests, build, brain:check, 1-minute train run with the dashboard
- [ ] Cross-unit review pass
- [ ] Not checked in a browser: builder 3D view, Fly it, the new meshes (CloakBrowser WebGPU fails with dxil.dll error 87)
- [ ] Throughput note: 1.5M decisions/s is the long-run figure on the classic 4 styles; a fresh 1-min run gives 1.27-1.30M, the new default mix about 1.02-1.07M (heavier worlds). Dashboard + path reward cost under 1 %.

# Training dashboard redesign and templates

Goal: a modern `npm run train` dashboard that follows UX conventions, and templates that train smoother and faster laps.

- [x] 12 templates in four goals (getting started, faster laps, smoother flight, fewer crashes) in `tools/brain/dashboard/js/templates.js`
- [x] Templates in the run manager (`template` in the start request) and the CLI (`train.mjs --template <id>`); recorded with the run
- [x] Home page: template gallery with goal filters, brain and duration, review of what the template changes, grouped settings with help text and changed markers, sticky start bar, custom validation
- [x] Run page: KPI tiles with trends and the time budget, Training/Settings/Compare tabs, layers and help popovers, confirm dialog for Stop
- [x] One colour theme for the canvases (`theme.js`); world cell headers fit their tallies; hover tooltip on overview cells
- [x] Alerts: GPU errors from the trainer's stderr, and no episode ending for 20 iterations
- [x] Fixed: the CLI dashboard hid every view once its run finished
- [x] Tests: templates validate against the trainer limits; template start requests and GPU error counts in the run manager
- [x] README training dashboard section
- [x] Verify: build, 2653 vitest + 42 dashboard tests, `node --check`, jsdom QA (`.bench/ui-shots/qa.mjs`)
- [x] Headless Edge screenshots (`.bench/ui-shots/edge*.mjs`): home, settings, replay, run settings, the no-GPU demo live, Stop dialog
- [x] Fixed from the screenshots: gate legend covered the bottom row of worlds (now a strip under the map); run settings table spilled into the next column; crash tile read "–%"; changed values too faint (now a dot)
- [ ] Train with the templates on a real brain and compare lap times and smoothness against Balanced (left for Nick)

# Watch brains in the game from the dashboard; races with many drones per brain

Goal: one click in the training dashboard opens the game on a track with a brain flying it; a race can hold N drones of each
brain (15 ultimate + 10 g + 5 x), all on screen at once.

Facts found: one brain-flown quad steps at about 150x real time on one core (30 racers cost about 20 % of the main thread);
copies of one brain with only different physics seeds clear the first gates within 1 ms of each other (they would fly as one);
training worlds rebuild exactly only at `quality=low` (other tiers move the gates hundreds of metres).

- [x] Game: `race=ultimate*15,g*10,x*5` and up to 32 racers; copies named "ultimate #3", coloured per brain
- [x] Game: race pilots sample their sticks from the brain's own action spread (as in training, seeded per racer) so copies fly their own lines; Fly stays on the mean action
- [x] Game: leaderboard stays compact with many racers (top rows, the followed racer, a line per brain); one leaderboard record per brain per race
- [x] Game: AI pilots tab has a drone count per brain
- [x] Trainer: every training world carries its game link (the game's own share-link parameters)
- [x] Dashboard: the server starts the game (Vite) on demand; "Watch in game" dialog picks brains with counts and a track (training world or generated)
- [x] Dashboard: Watch in game from the run page, the run list and the runs header
- [x] Game: the leaderboard sits under the OSD race panel (it covered gate, lap, time and split)
- [x] Dashboard: drones go to the game in the order picked, so the camera rides the first brain picked
- [x] Game: the AI pilots tab shows a race started from the URL or the dashboard, keeps its order (the first brain flies your quad), and its Racers label sits at the top of the list
- [x] Tests, README, verify (build, vitest, dashboard tests, a browser check of the game and the dialog)

# Beeping "crashed" quad after a watched brain finishes

Found: the beeps were the low-battery alarm (a 3-lap race at brain pace sags the 6S pack under 3.5 V a cell in lap 3). At the
finish the session levelled the quad out at race speed, so it flew straight into the trees past the line, then sank to the
ground on a fixed hover throttle and sat there with its motors and the alarm going. The brain file and the world loaded fine.

- [x] Session: a brain flies on for 4 s after its finish, then its quad is parked on the pad, disarmed; rival racers do the same
- [x] Session: a quad without a brain lands after the finish (holds height while fast, sinks at 1 m/s) and disarms quietly
- [x] Audio: a finished race never sets off the lost-model beacon, knocks after the line included
- [x] Tests, README, verify, and a browser check that records every buzzer tone (`.bench/race/watchprobe.mjs`)

# Brains that miss a gate and fly off: training and the game made to match

Found (`.bench/race/missprobe-run.mjs`, the a4y6 run on 24 training worlds x 2): the progress reward paid 37 a second for flying
on along the track past a missed gate, as much as racing (reward hacking). The game also flew brains where their training never
did: it let them fly on after a crash (training ends the episode there), allowed 15 s without a gate (training 8 s) and no world
bounds, and respawned them 1.5 m before the last cleared gate while training started 1.5 m before the gate due next (`ace` hit
the cleared gate's frame 0.4 s after each respawn, 200 times in one race).

- [x] Training: progress pays only up to 3 m past the gate due next (arc left to it per drone, reset at a pass and a spawn); TS copy and tests
- [x] Training: gate spawns at the game's checkpoint (before a cleared gate, the next one due)
- [x] Brain file records the stall time, ceiling and spawn; older files fall back to 8 s, 120 m and spawns before the gate due next
- [x] Game: a brain lets go at a crash and respawns 1.2 s later (racers and the player's quad); bounces do not delay it
- [x] Game: respawn at the brain's stall time or out of its training world; every respawn restarts the stall clock
- [x] Game: respawn where the brain's training started episodes
- [x] GPU check: the arc left to the gate due next against the TS copy, with a brain flying a quarter of the drones through gates
- [x] Probe after: 0 stall respawns (was 10, 5 of them fly-aways over 100 m), the same 1084 gates in 28.9 min (was 32.8)
- [x] Unseen tracks (8 x 2): a4y6, ace, ultimate, steady all finish as often or more, 0.8-4.4 s faster on average
- [ ] Retrain with the new reward and spawns (left for Nick)
- [x] Research: observations against the 2025-26 state of the art. Checked in the papers: Song 2021 (arXiv 2103.08624) Table IV,
  Battery-Aware RL (2609.37316), Green 2026 (2606.27348), MonoRace (2601.15222), Sun 2026 (2602.24030). Dream to Fly, SkyDreamer,
  Ferede, Environment as Policy and Liu come from the research agent's extraction only; Swift's paper could not be read
- [x] Obstacles are missing from the observation (Sun 2026: state-only 20-30 % success vs 100 % with depth on obstacle tracks):
  Nick chose to add obstacle sensing and retrain

# Obstacle sensing in the observation (OBS_SIZE 40 -> 99)

- [x] 35 range rays over the FPV camera's view (7 x 5, 20 deg apart, 30 deg uptilt, 30 m) against the ground and every collider
- [x] Nearest collider surface per side (right, left, up, down, back, front) within 8 m; ties within 1 cm go to the lower
  collider index (on a gate centreline the posts tie, and the game respawns quads there)
- [x] TypeScript (`src/ai/sense.ts`) and WGSL (`src/ai/gpu/sense.wgsl`, rays walk the 8 m box grid) copies; obscheck compares them
  value by value: race/sprint 0 of 403k ray values and 0 of 69k side entries over 1e-3; technical/industrial/mountain/acro 0 rays
  and 8 of 69k side entries (two colliders within 1 mm of each other straddling a 1 cm step)
- [x] Brain files: 40-input brains still load and fly on their 40 slots; training from one widens it with zero weights
- [x] Game: BrainPilot, BrainRacer and the AI pilots hub hand the pilots the physics' colliders (and new ones on a world change)
- [x] Cost: env step 3.3 -> ~5.0 ms at 16384 drones (about +10 % per training iteration); 33 us per decision in the game on
  the densest world (2408 colliders)
- [x] Tests, README, verify
- [ ] Retrain (left for Nick)


# Park construction realism audit (reviewer images: protrusions, crossing frames, exposed rod ends, paving wedges)

Goal: find the shared generator/assembly errors behind the pictured defects, fix them at the source, and build validation that
detects the whole class (exact primitive interference, end-cap reception, support paths, motion, coplanar finishes, mesh LODs).

- [x] Native inspection renderer with fixed seeds/times/cameras (`tools/park-inspect.mjs`)
- [x] Convex interference core: support functions, GJK, certified intrusion depth, Lipschitz end-cap containment (`interference.ts`)
- [x] Interface contracts: insert / coaxial / bear, monoliths (`construction.ts`); rule engine (`constructionAudit.ts`); motion audit
- [x] Baseline audit report (Destination 1337): `.bench/realism-before/audit`
- [x] Before/after renders: 12 matched views (`.bench/gallery/index.html`); "before" runs the baseline generator bundle through the current renderer (`tools/park-inspect.mjs --park-bundle`)
- [x] `docs/park-construction.md`: audit section (declarations, finding kinds, motion bound, mesh error rule, fixtures, limits) and updated ride coverage
- [ ] Reference research: flat rides; coasters, structures, materials
- [x] Shared assembly rules (`assembly.ts`): legs cast in footings, apex housings sized from where the leg ends sit, leg tops spread so A-frame legs never cross, member-between, guard fences, stair flights
- [x] Audit rule: node-hidden lengths, monolith receivers, coaxial shafts may pierce their bore's end face
- [x] Flat rides rebuilt: wheel, ship/pendulum, tower, rotary family, Top Spin (hub sized from arm, end walls clear of bearings)
- [x] Enterprise: boom pivot moved outside the gondola ring and below it, boom in a deck notch, ram in the pit, rim raised, cabins on hangers; pivot, boom and ram geometry shared by runtime, motion bounds and model (`flatPhysics.ts`); deck coverage test
- [x] Scrambler rebuilt the way the ride is built: hub on the mast top, drive arms overhead, satellites hung on kingpins, cars hung from the cross-arms; layout shared with the runtime and motion bounds (`SCRAMBLER` in `flatPhysics.ts`)
- [x] Teacup thrust plate under the shell; carousel drum welded to the turntable and lamps on the rounding boards; ship bulwarks on the deck; Scrambler dash between the walls; Enterprise hub column stops inside the spindle; landing slivers dropped
- [x] Audit rule: a boss of the same moulding or weldment may pierce a part's end face (bent members still checked at every knuckle)
- [x] Flat audit re-run (`.bench/realism-flats3`): 2056 to 1796 findings; contract violations, coplanar faces and degenerate parts in my families now 0
- [ ] weldedTube bends stand proud: teacup rims and handles 312 at 1.4 mm, Enterprise rim and hoops 200 at 10.8 mm (coaster agent)
- [ ] rideSeat wider than the Top Spin row pitch: 722 overlaps at 94.9 mm (vehicles agent); carousel horses float (vehicles agent)
- [ ] Paving pads against paving gables, 89 per round ride at 100 mm (paving agent)
- [ ] Motion audit past dispatch
- [x] Tests fixed for the rebuilds: wheel and tower clearance, boarding (stair rails, floor sizes), Top Spin lowering floor (new exact clearance test), Enterprise tilt joint anchor
- [ ] Mega park over the ray-tracing primitive budget: 136,591 against 131,072 (asked coaster, vehicles, paving for their counts)
- [x] Enterprise stalled unloading for good: riders seated in the 3 cabins over the boom slot had no deck to step onto. Seeding and boarding now fill only cabins over the deck (34 of 40 seats); the deck gap rule is shared by the deck builder and the runtime; tests: route-on-deck and opening snapshot (fails with the fix off)
- [ ] Inverted coaster stalls after one cycle: 3 exiting riders freeze on the station platform (coaster agent, evidence sent)
- [ ] validation.test: coaster segment check fails (coaster agent); "every attraction repeatedly" takes 243 s wall for its 600 s of park time against a 120 s limit (no baseline to compare: the park module is not in any commit)
- [ ] Agent reports: coaster, vehicles, buildings, paving; verify their evidence
- [ ] Per-family review with contracts declared at the call sites
- [x] Audit fixtures (`constructionAudit.test.ts`): 13 assemblies, 7 defective and 6 sound (rod end out of its cap, end out of a block's side, crossing braces, rod through a thin panel, post 5 mm off its footing, shaft off its sleeve axis, bent-tube knuckle; and their correct versions plus a welded boss) at 3 placements x 3 sizes = 108 cases; switching off the end and pair checks fails 45 of them
- [x] Motion-only fixture (`motionAudit.test.ts`): a post the Top Spin gondola reaches only after dispatch passes the rest audit and is reported by the motion audit
- [x] Round mesh level chosen by on-screen facet error (at most 0.5 px between the faceted mesh and the exact part below 48 sides; was up to about 3 px at 6 sides beyond 110 m)
- [x] Multi-seed and multi-size park audit runs (`.bench/realism-seeds`, `.bench/realism-seeds2`): compact and mega for seeds 7 and 4294967295. Every penetration (12, 0, 26, 7) was a path bench or lamp cutting queue rails or a queue canopy; after the furniture clearance rule mega has 0, and only the bent-tube knuckle ends remain
- [x] Path benches and lamps keep clear of everything already built (`furnitureClearance` in the path loop; `furniturePlacement.test.ts` at 1337 destination, 7 compact, 4294967295 compact)
- [ ] Space coaster show building is built across its own station and queue: guests and queue rails and canopy pass through its 0.7 m wall (1337 destination: 27/72 queue points inside; 7 mega: 48/72). `furniturePlacement.test.ts` fails at 1337 destination on this alone (coaster agent, evidence sent)
- [x] Lights come from glowing fittings that match them: `luminaire()` puts each light at the centre of its glowing parts, gives them its colour and the glow that yields its candela (space orbs were 2.5x too dim, lamp diffusers hand-set and cream against a warm light); `luminaire.test.ts`, fails with the old orb glow
- [x] Non-metal surfaces (concrete, timber, fabric, masonry, foliage, paving, glass) have metalness 0: refused by the part builder, fixed in shop glass (0.2), Top Spin rotor glass (0.4), fabric and timber roof leaves (0.08) and the show-building blackout (0.02 on concrete); `materials.test.ts`
- [x] Vegetation and shadow realism (nature agent, checked: tsc clean, plantShadows and farFoliage tests pass): trees through built solids dropped by a shared rule (planting.ts, plantingContact.test.ts, 5 of 7 fail without it); shadow capsules follow trunks and limbs and 1 to 3 canopy spheres fit the drawn leaves (plantShadows.ts, spruce canopy overlap 0.26 to 0.58); far trunk runs into the crown. Open: far-canopy cone cards and spruce fronds, forest limb shadows
- [x] Guest realism (people agent, checked: 5 guest test files pass, 10 of 12 new tests fail on the old code): seated bodies sink 0 to 1.6 cm (were 4 to 7.5 cm), palms on the lap bar at every height, child head proportions, stride rate falls with height, adult heights on a bell curve with mass from body mass index
- [ ] Walk-to-sit foot jump of 0.44 m and carousel straddle pose (people agent, approved)
- [x] Wheels sat 1 to 5 mm into the rail (polyline rail, 5 mm chord error): cars now ride on the built rail lengths, physics unchanged, 0 primitives added (vehicles; railSag.test.ts, 253 findings on the old code, verified passing). Cutting the chord error was rejected: +33,736 primitives at 1 mm against 14,600 headroom
- [x] Source research on real ride construction, observed versus assumed (research agent; `docs/park-construction-sources.md`). AWS D1.1 could not be read, so the audit comment no longer cites it
- [x] Ride stairs follow the ADA 2010 limits read in the standard: risers at most 7 in (was 0.2 m), handrail grip top 0.9 m above the nosings (was 1.05 m to the axis), and on guarded stairs the handrail hangs on brackets 1.5 in clear of the balusters, below a separate guard rail; `stairs.test.ts` (16 cases, includes a construction audit)
- [ ] Coaster station stairs: 0.2 m risers, 70 mm grip, 1.1 m rail (coaster agent, asked to use the shared stair rule)
- [x] Carousel horses ride 10 in at 4 1/3 bobs per platform turn (Tilden manual), was 0.56 m at 3; shared by runtime, motion bounds and the slider joint; test in `flatPhysics.test.ts`
- [x] Riders sit on the seats that were built: Enterprise riders were 98-135 mm off and half faced backwards, Top Spin end riders 50 mm off. Cabin floor, seat and pitch values are now shared by the model and the runtime; `riderSeats.test.ts` checks every rideSeat on every ride, position and facing
- [x] Coaster drawbars end inside both cars' socket balls (were 0.055 m balls inside a 0.06 m bar, undeclared)
- [ ] Two-train coasters start stacked in one spot when no guests are seated (`newTrain` gives every train the same s; coaster agent, evidence sent)
- [x] Scrambler rebuilt from Eli Bridge's bulletins: top sweeps on tie rods, bottom sweeps 3.5 in above the walkway, unit poles, 4 two-seat cars per unit (12 cars, was 6); construction audit 0 findings, joint ledger 0 failures, boarding and rider-seat tests pass
- [x] Teacups rebuilt from the Disney patent, Technical Park and Zamperla: 3 small turntables on the main one, 2 cups each on their own pins (was 6 cups straight on the main deck). Seats, boarding point (on whichever turntable the door opens onto), motion bounds and joints share `TEACUPS`. The cup handle is centred on a wall segment (its ends stood 1.4 mm out at a segment seam). Construction audit: only bent-tube knuckles left; joint ledger 40,188, 0 failed; motion 120 s, 0 findings; boarding and rider-seat tests pass
- [x] Motion audit uncertified pairs sorted (`.bench/classify-uncertified.mjs`): declared bearing contacts, or pairs at least 5 mm clear at every 4 ms tick; recorded as a sampling limit in the docs
- [x] Carousel hung the way the Tilden Park manual describes it: the top thrust bearing on the centre pole carries the machine, the platform hangs from the sweeps on 2 drop rods each (were diagonal braces from the drum, with the platform on a bearing at the mast foot), a cheese bearing centres it, and the jumper poles move with the figures, sliding in high hats. Construction audit 0 findings; joint ledger 0 failed; carousel, boarding and horse tests pass
- [x] Top Spin counterweights are round discs at the end of an arm extension past the hub (HUSS patent US5188566, Gardaland and Serengeti-Park photos); was a block on a stub. Construction audit 0 at rest and running; Top Spin tests pass
- [x] Carousel jumper pole moved from the rider's middle to the horse's withers, 0.22 m ahead of the saddle (CAROUSEL_WITHERS); guestHorse.test counts the pole as solid
- [x] Ship rows 1.3 m apart (was 1.5) so the front row's feet clear the bow (were 34 to 42 cm into it); shipSeat shared by model and runtime; guestRide.test holds the ship to the 3.5 cm limit
- [x] Top Spin end seats spaced by the widest seated rider (GUEST_SEATED_HALF_WIDTH 0.46 m at GUEST_MAX_HEIGHT 1.98 m, checked against the skinned mesh), not the seat: forearms reached 4 to 8 cm into the end frames
- [x] Ship landing set a 50 mm running gap outside the bulwarks (SHIP_BULWARK): the swinging bulwark passed 10 mm into the landing edge at t = 45
- [x] Boarding headway and blocked-foot tests: they walked unregistered routes, which the coaster agent's new same-direction check reads; tests now register the routes (people; boarding 10/10)
- [x] Hair popped between the near and hero meshes: both now share the hair dome and tied-back lock (people; guestRealism and mesh 14/14, render checked)
- [x] Swing riders now within 3.5 cm
- [x] Carousel saddle stood out from the barrel like a shelf, and small children's knees went 5 cm through it: now a seat on the back with straps along the barrel; carousel cap removed from guestRide and the cloth allowance from guestHorse (audit 0 at t 0 and 20, motion 0 over 120 s; render .bench/carousel-saddle)
- [ ] Child leg proportions: left open, no measured source found (people)
- [ ] Planted foot stays flat, with no heel-to-toe roll: left open, the leg shader change needs a visual check (people)
- [ ] Unconfirmed figures, taken from search summaries only: Strathprints stride rates, head-to-height fractions from an education site, CDC average height for women (people)
- [x] Inverted coaster exit stall: two walkers facing each other at a stair foot each waited for the other; only same-direction walkers hold a guest back now (coaster; stationFlow.test.ts)
- [x] Two-train coasters no longer start stacked: later trains wait on the brake run a train length plus 30 m back (coaster; steel and launch compact audit 1,710 findings to 17, the 17 being the rail sag since fixed)
- [ ] rideConnections: 18 to 27 rail-tie welds per seed lost their rail after the knuckle change (coaster)
- [ ] Hyper coupler: drawbar end 1 mm outside its socket ball at an angle (coaster)
- [x] Research mismatches left as assumed and documented: Top Spin lowering floor (NAFLIC says some designs retract floor sections; no HUSS source either way); Enterprise wheel 15 m against 18 m (only source is a fan page quoting the Alton Towers fact file, and resizing moves the deck, pit, boom and park layout); drop tower lattice (the HUSS tower patent describes a grid frame; the photographed Intamin tower is a tube, so both exist); wheel boarding height (not found for any wheel but the London Eye)
- [ ] After renders, gallery, coverage inventory, docs; system-wide realism requirement recorded
- [x] Bent-tube knuckles sized to cover both cut rims (radius from tube radius and setback); Ferris wheel rim has no knuckle inside the bearing bosses; sharp bends ray traced; teacup rim bead rests on the wall tops (coaster; code read, its audits 0, rideConnections 3/3)
- [x] Validation passes 3/3: 100 seeds across every size, layout and theme; halved time step; repeated operation with 400 guests (coaster, log .bench/realism-coaster/validation.log; run before the tree-check speed fix and the bogie bound fix, which keep results the same and only enlarge collision boxes)
- [ ] Final checks: tsc, park and render park tests, realismBuildings and theme, build, 240 s motion audit of the 11 flat families, several seeds and sizes, joint ledger, gallery
- [x] Park generation went from 6 s to 67 s: the check for trees growing through built parts tested every leaf point exactly against every solid near the tree (38 s of 47 s profiled). Each point now only meets the solids whose box holds it. Same trees flagged as the old check with 3,000 extra trees scattered through the park (over 500 flagged); generation now 11 to 13 s
- [x] Swept collision bounds for coaster bogies, cars and couplers missed the bogie shift onto the built rail lengths (bogie 7e-11 m outside its box in collisionHierarchy): bounds now include RAIL.chordError, which the rail builder guarantees
- [x] 4K60 x265 ride tour (tools/park-tour.mjs): aerial, an orbit of each ride family, a chase and a front-seat ride on each coaster but the space coaster; .bench/park-tour/park-tour-4k60.mp4
- [x] Seed orbit video (tools/park-seed-orbit.mjs): one steady aerial orbit while 30 seeds phase into each other over 60 s along a soft glowing edge, Inter titles; 640 px test passed
- [x] Seed orbit 4K60 render: .bench/park-orbit/park-seeds-30-4k60.mp4 (HEVC Main 10, 3600 frames, 60 s, 265 MB, 20.6 min)

## Drone racing in the theme park (asked 2026-10-09)
- [x] Measured swept envelopes of every ride family over 300 s (.bench/park-race/envelopes.mjs): flat rides as reach and top, coaster trains as reach above, below and beside the rail
- [x] Race course generator (src/world/park/raceCourse.ts): closed loop round a ring of rides, low along the walkways, round flat rides, never under roofs; lowest heights found by a loop search that dives under rails where the gap allows; dead-end detours dropped; square, arch and hoop gates with legs off the walkways; start pad on the lawn behind the start gate. 8 of 8 test parks get a course (1.1 to 3.1 km, 11 to 44 gates, about 1 s on top of generation)
- [x] Route "race" in the park recipe, settings, share links and the World menu (built only for race parks: its corridor clears the trees along the line)
- [x] Tests (raceCourse.test.ts, 11 pass): line clear of solids and envelopes and of a 2 m sweep through the park collision, gates face the line and are passed, frames and legs clear and off walkways, no moving part within 1 m of the line over 240 s
- [x] Fix: park tour put its last gate on top of gate 0 (24 gates now)
- [x] Brains in the park: box stand-ins (raceColliders.ts) for the static solids and the rides' swept space within 30 m of the line, built when a brain first flies; rivals hit the park's exact shapes; brains refused only on parks without a race course
- [x] Trainer: park worlds (train.mjs --parks, obscheck --parks, dashboard field and Theme park racing template); 2 min smoke run trains at 9.6e5 decisions/s (1.19e6 without the park)
- [x] Published brains already race the park in the CPU sim (ace, ultimate1, a finish both courses) and in the game (headless Chromium on the GPU: 4 pilots finish 2 laps of compact park 7, no console errors)
- [x] Brains fly every park route with a line (asked 2026-10-09): tour and coaster routes get a pilot track (pilotGates.ts: hoops every 30 m on a coaster guide, start pad 10 m behind the lowest gate with room); the stand-ins leave out a followed coaster's trains; free exploration says it has no course
- [x] Start pads 10 m behind gate 0, as every generated training track has them (the race course's pads were 15 to 60 m back and two brains flew under gate 0)
- [x] Battery: a crash respawn keeps the pack's charge (game and rival drones); a flat pack (5 %) is swapped on the pad with the race clock running; a reset or new race gets a fresh pack. Training was not affected: a crash ends the episode outright
- [x] Trainer flies park tours and coasters (asked 2026-10-09): --parks seed[:size][:race|tour|coasterN] builds the same pilot track the game uses; 1 min smoke run on Velocity (compact 7) and the destination 1337 tour trains at 8.8e5 decisions/s
- [x] Dashboard Worlds step (asked 2026-10-09): track style tiles and a theme park picker (seed with dice, size, route, coaster by name, park cards); the style and park fields left All settings; tests check the sizes, coaster counts and names against the game
- [x] Watch in game opens theme parks (asked 2026-10-09): a Theme park tab with seed, size, route and coaster; park training worlds of new runs get a game link too; the dialog is two columns and fits 1366x768 to 2560x1080 with no scrollbars; opened from the real dialog, ace flew a mega coaster (Sky Talon II), a compact tour and a destination race course
- [ ] Verify: full vitest, brain checks, build, every-route sweep
- [ ] Train a park brain for real (Theme park racing template, 30+ min) when the GPU is free

## Drones crash into bridges (asked 2026-10-09)
- [x] The sensors include every bridge box (piers, deck, parapets), on the CPU and the GPU
- [x] Flown 6 brains round 4 industrial eval tracks: 25 bridge hits. 17 were climbing into the deck's underside at 32 to 44 m/s; the rest hit the deck or parapet front at about 24 m/s, plus one pier hit. The rays first saw the part 0.1 to 0.47 s before impact, which is 3 to 19 m at those speeds
- [x] Ray gaps: rows are 20 degrees apart, so a level deck face 15 to 25 m out often falls between two rows; the deck is reliably seen from about 8 m and the side slots from 4 m
- [x] ace, ultimate and the newest run never trained on industrial tracks (no bridges); a and b did and still clip the underside
- [ ] Decide: more headroom under bridges (track change, keeps brains) and/or a level ray row (new sensing layout, every brain retrained)

## Hard tracks, flown reliably and fast (asked 2026-10-10)
- [x] Hard recipe (difficulty 1, twist 1, tunnels, ladders, corkscrews, hairpins, split-S, industrial props) on ultra terrain; track files in .bench/hard-track/
- [x] hard16-e flies seed 16 clean (23/32); hard10-a after 10 min on the 10 hardest distinct seeds flies seed 3 (11/16) and seed 16 (13/16)
- [x] Training must reach a drained pack: episodes end below batteryEmptyV (3.0 V by default) and start on a fresh pack, so late-race flying needs batteryEmptyV=2.5 and more pad starts
- [x] 30 min more on the 10 tracks (hard10-b): 59/160 clean on the 10 (every track now has clean flights; seed 3 13/16 at 53.5 s), 7/112 on the 7 new, 1/80 held out
- [x] 12 new distinct hard tracks (terrains 3, 7, 9): 7 join training (.bench/hard-track/train-set.txt, 17 tracks), 5 held out (holdout-set.txt)
- [ ] Repeat 30 min chunks until every training track is reliable (12/16 clean or better); automated by .bench/hard-track/loop.mjs, results in loop.log
  - hard17-a: 146/272 clean, 5/17 reliable, every training track has clean flights; held out 8/80
  - hard17-b: 162/272 clean, 7/17 reliable; held out 15/80, 1/5 reliable
  - hard17-c: 217/272 clean, 13/17 reliable; held out 8/80, 0/5 (fitting the training set more than generalising)
  - hard17-d: 207/272 clean, 11/17 reliable; held out 15/80, 1/5 (best held-out so far); loop stopped here (log in loop-17.log)
- [ ] Broaden (agreed 2026-10-10): stop the loop after hard17-d, generate about 20 more hard tracks on terrains 1, 2, 4, 5, 6, 8, 10 and 12, train on the bigger set; pick the final brain by its held-out score
  - 14 new tracks kept of 120 candidates; training set now 31 tracks (train-set.txt; the old 17 in train-set-17.txt); loop hard31-a.. from hard17-d
  - Trainer build frozen (.bench/brain/bundle/FROZEN, tools/brain/bundle.mjs honours it) while the leaves, trees and terrain agents edit the vegetation code; delete FROZEN when the campaign ends
  - hard17-d on the 31: 228/496, 11/31; held out 15/80
  - hard31-a: 263/496, 10/31; held out 19/80 (best held-out so far)
  - hard31-b: 190/496, 3/31; held out 5/80 (training swung back). Checked: the trainer's colliders match a pre-agent build exactly, so not the art agents
  - Loop now resumes each chunk from the best brain so far (training clean + 2x held-out clean) at lr 1e-4: hard31s-a.. from hard31-a
  - hard31s-a: 351/496, 20/31 reliable; held out 31/80, 1/5 (best by far; the lower learning rate works)
  - hard31s-b: 356/496, 16/31; held out 27/80 (score 410, dropped)
  - hard31s-c (from hard31s-a): 383/496, 23/31 reliable; held out 36/80, 2/5 (new best, score 455)
- [ ] Retrain on the new tree layout. Trees agent (11:19 UTC) changed gameplay: species/forms placed directly (beech stands, 0.6-2.6% snags, birch clumps, stand-density forms, 22 variants), spacing per variant (some trees move), up to 4 trunk boxes per stem and 6 per clump, closest trunk box 4.61 m from the racing line (was 5.9 m). Layout confirmed final 11:2x UTC. Done: loop stopped after hard31s-d, trainer rebuilt and re-frozen at 22:24 local with the new layout (colliders +17 to 41 percent per track, e.g. hard-3 2137 -> 3009; no GPU collider cap), old build kept as .bench/hard-track/trainer-old-layout.mjs, old loop log as loop-31-oldtrees.log. On the new trees hard31s-c scores 364/496 (20/31 reliable), held 27/80 (score 418); hard31s-d 335/496, held 16/80. Loop restarted from hard31s-c: hard31n-a.. at lr 1e-4. hard31n-a 341/496 held 7/80, hard31n-b 346/496 held 8/80: both worse than hard31s-c, held-out drops hard. Loop paused 2026-10-11 ~13:05 UTC because the trees agent is landing mature tree sizes (another layout change). Next: when that layout is final, refreeze the trainer, re-score hard31s-c, restart at lr 5e-5, and look into why held-out falls. (user, 2026-10-10: the trees agent may change tree placement, species and colliders; training is redone after). When the art agents finish: delete .bench/brain/bundle/FROZEN, regenerate the hard track files (gate positions may stay, trees move), re-score the best brain, continue the loop on the new worlds
- [ ] Speed polish without losing reliability; final scores on the training and held-out tracks

## Gate LEDs white out the screen at night (reported 2026-10-10)
- [x] Cause: emissive surfaces (the gate LED strips) were added at full physical brightness in the lighting pass; at night exposure the active gate was thousands of times past white and its bloom filled the screen for a frame or two at every gate
- [x] Fix: deferred.wgsl emissiveShown() caps emissive light like the glow ribbons (display level near 4x strength, at most 2.2; daytime unchanged); glow ribbons also fade out over the last 5 m (glowNearFade). Tests in src/render/objects/ledGlow.test.ts
- [x] Checked on the night render of track 210-t2: frames over 2.5x the median luma 73 -> 0, brightest 484 -> 150 (median 115)

## Art agents (leaves, trees, terrain, extreme), from 2026-10-10
- [x] EXTREME graphics tier (extreme agent): menu, ?quality=extreme, saved settings, tools; gameplay identical to ultra
- [x] Leaves: varied leaf shapes and colours, backlit glow, pine brushes, spruce drooping branchlets, 1024 atlas at extreme
- [x] Night tree edges glowing: per-sample sky darkening in TAA and motion blur (leaves agent)
- [x] Trees: per-species bark, root flare, 22 variants (beech, snags, birch clumps), multi-box trunk colliders, extreme far LOD out to 4 km, crown self-shading
- [x] Terrain: new ground materials, rock, grass colour and wind, wet-gravel sparkle fix, extreme grass to 600 m, horizon band fixed at the source, exposure sunfleck rule
- [ ] Night clouds flat black and smooth (trees agent)
- [ ] Forest floor too bright: canopy barely shades the sun (terrain agent with trees)
- [ ] Photo-referenced broadleaf and spruce crowns (leaves agent)

## Realism audit (extreme agent, .bench/audit/) - assigned
- [ ] 1 Clouds cartoon cutouts - terrain (lighting landed; banding is preview compression only)
  - [x] Overhead base from below: dark, textured, ragged rims
  - [ ] Ultra near-cloud softness (half-res march / history) - left as is; stills match extreme; motion unchecked
  - [x] Horizon step slices
  - [x] 18:48 flat peach slab
- [x] Blob shadows under lone trees from the air - terrain (a-trous shadow blur capped to the penumbra)
- [x] Track corridor worn path (hard-210-t2) - terrain (distance to racing line in cover alpha; trackWear in terrain.wgsl). Gravel there is a stream bed, meadow elsewhere is expected
- [ ] 2 Aerial forest identical broccoli - trees
- [ ] 3 Foliage stamped cards, no crown depth - leaves
- [x] 4 Terrain macro sculpted, cliff bands, path tiling - terrain (jointed bedrock, scree aprons, stream-bed patchwork; follow-up: rock domes still putty at 5-20 m, backlit cliff mottle)
- [x] 5 Lifted blacks at low sun - extreme: diagnosed, not AP or toe; crown-interior GI and leaf ambient, handed to leaves/trees
- [x] 6 Golden hour undersaturated - extreme: AWB now balances golden hour (sat 0.28-0.35 -> 0.39-0.42)
- [x] 7 Forest floor tiled orange litter - terrain (canopy tint, herbs, humus, trunk-foot AO)
- [ ] 7b 3D understorey in the ground-cover instancing (ferns, bracken, bramble, seedlings, sticks, moss), no colliders - terrain
- [ ] 8 Trunks uniform, no dead wood - trees
- [x] 9 Meadow too busy at distance - terrain
- [x] 9b Far grass yellow-lime - terrain (hue already matched photos; sat trimmed; remaining brightness is metering on tree-line frames)
- [ ] Backlit cliff mottle - terrain (graze easing in terrain.wgsl; landed, unconfirmed in motion)
- [ ] 10 Gates/props untextured, track no wear - extreme (now owns objects): gates/props weathered and concrete redone; track ground waits on terrain
- [ ] Dark crowns: baked crown AO double counted with RT GI - trees
- [ ] Backlit leaf transmission - leaves (after trees AO fix)
- [ ] Extreme atlas cache 224 MB -> <=60 MB - leaves
- [x] Exposure key decision - extreme: 0.3 kept (renders +7 codes over photos p50), cloud sky-light gain wired into RT
- [x] Extreme start: warm 14.6-18 s (target 15); canopyShadowFit plain-LOD cache still open - trees
- Rule: A/B comparisons with clouds off; GPU render proves every shader change

## Realism audit 4 (.bench/audit/audit-sheet4.png, metrics4.json) - assigned
- [ ] 1 Shadows lifted, crown interiors ~2 stops bright - leaves (leaf spec/ambient-back) + trees (crown GI)
- [ ] 2 Forest local contrast ~half of photos - leaves (self-shadow) + trees (crown structure)
- [ ] 3 Forest floor too bright/green/patchy - terrain
- [ ] 4 Aerial forest broccoli / bare beige far hills - trees (far LOD) + terrain (far ground)
- [ ] 5 Trunks too pale/uniform - trees
- [ ] 6 Clouds flat, worm shapes, flat orange at 18:48 - terrain
- [ ] 7 Corridor blue-white speckle at 18:48 - terrain
- [ ] 8 Leaf cards visible at 10-20 m - leaves
- [ ] 9 Golden hour saturation - extreme (after 1)
- [ ] 10 Dark-dominated frames over-exposed (shade trim) - extreme (after 1)
- [ ] Ultra perf vs HEAD in browser - extreme
- [ ] Moonlit forest near-black at extreme - extreme
- [ ] Camera-following RT proxies at EXTREME - trees
- [x] Real-browser check: no shader errors in 8 cases; night park whiteout fixed
- [x] GI history reset on time-of-day jumps
- [x] tsgo (Rust TS7) benchmark: not worth switching (10-35% faster on a 0.5 s check)

## Iteration speed-ups (speedup agent; plan in .bench/buildresearch/report.md)
- [ ] 1 Narrow tree cache key (import graph, per species) - with leaves
- [ ] 2 Long-lived render server + client (tools/render-server.mjs, shot-client.mjs)
- [ ] 3 Persistent out-of-process bundler
- [ ] 4 WGSL hot-swap of affected pipelines
- [ ] 5 Async pipeline creation (keep if faster)
- [ ] 6 Dawn use_dxc (keep if faster and identical)
- [ ] 7 Persistent pipeline cache feasibility (report only)
- [ ] Theme park CPU-bound (ultra 37-49 fps, high 19.6 fps, ready 34-42 s) - deferred by user 2026-10-11
