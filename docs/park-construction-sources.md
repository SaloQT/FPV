# How real flat rides, coasters and their stairs are built: sources

Written 2026-10-09 for the procedural park generator in `C:\Users\SaloQT\Downloads\FPV\src\world\park`.
Every claim says where it came from and what that source actually shows. Nothing here was taken from memory.

## How to read this file

Source kinds, from strongest to weakest:

- **Standard text**: the official text of a code, read in full on the publisher's page.
- **Manufacturer spec**: a maker's own data sheet or product page.
- **Operator manual / patent**: a maintenance manual or a granted patent, read as text.
- **Photo (viewed)**: I downloaded the photo from Wikimedia Commons and looked at it. I say only what is visible. Where I could not tell what a part is, I say so.
- **Article / encyclopedia / forum**: secondary. Wikipedia is used often because manufacturers publish little; where Wikipedia gave no citation for a claim I say so.
- **Search summary only**: I saw the fact in a web-search result summary but could not open the page. Treated as unconfirmed.

Each ride has two lists. "Observed in sources" holds what a source showed. "Assumed or not confirmed" holds what I could not find, with where I looked.

Things I could not open (so they are not evidence): ICC code pages (HTTP 403), the Wisconsin ride rules (connection refused), ASTM F2291 and EN 13814 (paid standards), the Chance Rides spec sheets for the Century Wheel and Pharaoh's Fury (404 on the second fetch), Zamperla's own product pages for the Endeavour and Tea Cup (error / timeout), and the Zierer Wave Swinger data (only a search summary).

Photos I viewed (all from Wikimedia Commons, `https://commons.wikimedia.org/wiki/File:<name>`):
`Enterprise_(Alton_Towers).jpg`, `Enterprise_im_Serengetipark.jpg`, `Enterprise,_Tykkimäki.JPG`, `Huss_Top_Spin_im_Serengetipark.jpg`, `Top_Spin_Huss_di_gardaland.JPG`, `Top_Spin_-_Parque_de_Atracciones_de_Madrid.jpg`, `Eli_Bridge_Scrambler®_-_panoramio.jpg`, `Wave_Swinger,_Gröna_Lund.jpg`, `Mad_Teacup_Ride_in_action_-_panoramio.jpg`, `Giant_Drop_(Six_Flags_Great_America)_1.jpg`, `Pendulus.jpg`, `LOOFF_CAROUSEL,_SANTA_CRUZ,_CALIFORNIA.jpg`, `SFMM-_Buccaner.jpg`, `Münster,_Send_--_2018_--_1756.jpg`, and the 1893 axle photo `1893_Columbian_Exposition_Ferris_Wheel_Axle_Before_Installation._-_DPLA_-_566e2506e358f9cfd58badde6c4ae590.jpg`.

---

## 1. Enterprise (HUSS, Schwarzkopf)

### Observed in sources

How it moves
- A hydraulic arm under the ride raises and tilts the wheel from flat to nearly upright, 87 degrees from horizontal. The ride turns clockwise. Source: Wikipedia, https://en.wikipedia.org/wiki/Enterprise_(ride) (encyclopedia; the page cites David Burton's Amusement Ride Extravaganza for most of this).
- 87 degrees maximum lift, 20 cars, 2 guests per car, 2 minute ride, about 1,200 riders an hour, "Lifting Power: Hydraulic", sliding doors with locks. Source: spec table on a park-history page, https://greatadventurehistory.com/Enterprise1.htm (fan archive; it links a HUSS spec sheet I could not open).
- The same 87 degrees and "hydraulic arm, not electro-mechanical" for the HUSS version. Source: https://www.ride-extravaganza.com/?p=14 (enthusiast article). A reader comment there says the Schwarzkopf version also uses a hydraulic ram; the article itself does not confirm that.
- The HUSS-built Zodiac (Thorpe Park) reaches "a maximum angle of 70 degrees" and is 18 m (59 ft) high. Source: https://en.wikipedia.org/wiki/Zodiac_(ride) (encyclopedia).
- On the Passat, an Enterprise precursor, an arc-shaped pillar raises and lowers the arm instead of a hydraulic arm. Source: Wikipedia Enterprise page above.
- A patent for a closely related HUSS ride (cars on inclined pivot axes): the base frame is a carriage with a chassis; "a rocker arm 4 is pivotally connected to the base frame 1 about an axis 3"; a hydraulic cylinder ("erection mechanism") raises the arm and the plate; at rest the carriers are lowered to "a position where passengers can get on and off". Source: EP0283872A2, Huss Maschinenfabrik, published 1988, https://patents.google.com/patent/EP0283872A2/en (patent text).
- A different patent (Chance, US5688178, filed 1996) describes the same family of motion: the boom is "a pair of parallel box beams joined by cross-braces", pivoted at one end on a stanchion on the base, moved by "a hydraulic lift cylinder"; the top has a central hub and sweep arms; seats swing on axes tangent to the circle; tilt range 45 to 80 degrees; seats face outward for loading with a circular platform and ramps. Source: https://patents.google.com/patent/US5688178 (patent text). This is Chance's own ride, not an Enterprise, so it shows the idea rather than the Enterprise.

Size
- Wheel diameter 18 m, 20 cars, 2 passengers per car, HUSS Rides. Source: Alton Towers fact file on https://www.towerstimes.co.uk/history/past-rides/enterprise/ (unofficial fan article quoting the park's fact file).
- Zamperla's Endeavour (a modern ride the maker bills as Enterprise-based): height 20.5 m, footprint 21 m across, 13 rpm, 145 kW, 24 riders. Source: https://www.zamperla.com/news/endeavour-at-kings-island (manufacturer news page; spec lines only).
- A used 1982 HUSS Enterprise (transportable model) listed for sale: footprint 22 by 19 m, height 18.4 m, 40 passengers at a time, 1,200 riders an hour (the listing's text elsewhere says 40 m high, which conflicts). https://amusement-rides.com/product/enterprise-huss (used-ride broker listing).
- The portable HUSS version loads onto two trailers. The first carries the wheel, arm and drive and is the ride's base while it operates; the second carries the gondolas, platforms and other equipment. About 2.5 trailers and 40 tonnes. Sources: Wikipedia Enterprise page; https://www.ride-extravaganza.com/?p=14.

Photos I viewed
- `Enterprise,_Tykkimäki.JPG` (a portable unit): one wide blue box-section boom rises from a blue base housing at the left edge of the ride and bends (swan-neck) to the hub. The wheel is a hub with two cones of lattice spokes; the rim is a ring of straight lattice sections. Cabins are open red tubs hung from the rim with grab hoops. The ride stands inside a low panel fence on flat ground; I cannot see a pit.
- `Enterprise_im_Serengetipark.jpg`: the boom here is a single tall flat plate under the hub; the wheel is dished (spokes lean toward the hub); cabins hang on short hangers at the rim.
- `Enterprise_(Alton_Towers).jpg`: wheel tilted about 70 degrees, a straight diagonal member from the hub toward the lower left, and a large curved steel arch behind the wheel. I could not tell from the photo what the arch is for.

### Assumed or not confirmed
- Tilt angle of every real model: sources give 87 degrees (HUSS), 70 degrees (Zodiac), 90 degrees (a Schwarzkopf spec I saw only in a search summary).
- The boom foot. I found no source on how the boom pivots at its base (pins in cheek blocks, or a spherical bearing). A HUSS service letter for the Top Spin (see section 3) shows spherical bearings on the swing arm hinge, which suggests but does not prove the same for the Enterprise.
- Lift ram count and stages. Sources say "hydraulic arm" / "hydraulic ram"; none gives a stage count, bore or stroke.
- Cabin hinge hardware. Photos show cabins hanging from the rim at their ends; no source describes pins or bearings.
- Boarding platform shape around the boom. Looked in Wikipedia, Burton's article, towerstimes, the HUSS patent, and the Commons category. Only the Wikipedia line "platforms" on the second trailer and the Tykkimäki photo speak to it.
- Whether permanent park installations sink the boom into a pit. Not found.
- Wheel diameter varies by maker: Schwarzkopf 16 or 21 gondolas "changes the wheel diameter" but no figure (Wikipedia).

---

## 2. Scrambler (Eli Bridge)

### Observed in sources
- Patent US 2,259,691 "Merry-go-round", Richard H. Harris, filed 1940, granted 1941 (the original Scrambler), https://patents.google.com/patent/US2259691 (patent text):
  - A tubular centre pole, enlarged at the foot into a bearing, sits on a lower base plate and is clamped to an upper base plate; steel I-beams run out along the ground "and prevent tipping over of the pole".
  - A top housing turns on ball thrust bearings. A tube sleeves the pole and hangs from the top on rods; it turns as the axis of rotation.
  - Three seat units are spaced evenly around the pole. Each has an upright shaft tilted inward; its top is held in a bearing housing hung from the cap plate and its bottom in a bearing plate on a skeleton arm fixed to the tube's base. "The seat unit is suspended in its entirety from the top of the pole."
  - Four seats per unit, 90 degrees apart, seats canted toward the shaft; drive by an engine, transmissions and bevel gears; loading by an annular platform for each unit, a central platform and ramps.
- The original Eli Bridge ride (1953 to 1954): 12 cars over 3 arms, 24 adults or 36 children, 9 to 12 rpm clockwise. Source: Wikipedia, https://en.wikipedia.org/wiki/Scrambler_(ride) (the figures come from a 1954 trade-magazine photo caption cited there).
- Wikipedia describes variants: some are "driven by a lower arm assembly", others "fully suspended ... driven from the top". Most of that passage is uncited on Wikipedia.
- A Kings Dominion unit: centre mast turns clockwise at 11.4 rpm, buckets turn counterclockwise on a "unit pole"; motor drives the centre through a long shaft in a plate-covered trough; two brake drums under the centre panel. Source: https://www.dalebrumfield.net/single-post/2018/09/11/part-25-kings-dominion-s-scrambler-this-carpet-bagging-carny-import-has-some-hidden-sec (first-person blog by a former ride worker; it disputes itself on arm count: four versus three).
- Set-up of a portable unit: the centre is lowered from a truck and levelled on solid timber under its legs; radial arms are mounted to the centre; a drive shaft goes in; car supports are set up and the cars lifted down. Source: https://huvipuisto.net/ukscramb.html (enthusiast page, no dimensions).
- Photo `Eli_Bridge_Scrambler®_-_panoramio.jpg` (a ride at rest at a fair): three arms lie low, near deck height, as red trusses; a red triangular base frame at each arm tip carries an upright post; blue tie rods run from the peak of a tall bundled centre mast down to the arm tips; a white horizontal beam crosses above the tubs; the tubs sit just above the deck. I could not tell from the photo how each tub fastens to the beam.

### Assumed or not confirmed
- Overall diameter, arm length, arm height, tub size, footprint. Looked at: Wikipedia, Coasterpedia, Holiday World, parkz, huvipuisto.net, Eli Bridge searches. No manufacturer data sheet found.
- How a car hangs: the patent shows a suspended seat unit; the photo shows low arms. I did not find a source that states which arrangement a given Eli model uses.
- Cars per arm today: 4 (about 12 cars) is the common figure in Wikipedia and Coasterpedia, but some units list 24 per cycle.

---

## 3. Top Spin (HUSS)

### Observed in sources
- A 40-person platform "suspended between two counterweighted arms"; arms turned by multi-directional DC motors; "hinges freely on air-braked hubs"; "27 tonnes of water ballast to stabilise each of its support towers" on portable units; Top Spin II 28 persons, no ballast; Suspended Topspin 38 passengers floorless; Giant Top Spin 68 ft tall, 77 persons. Source: https://www.ride-extravaganza.com/thrill/top-spin/ (enthusiast article).
- Wikipedia: original has two rows of 20 seats with self-lowering lap bars; Top Spin 2 has "telescoping drum supports to hold the main control arms"; rider height 54 to 80 in. https://en.wikipedia.org/wiki/Top_Spin_(ride) (one YouTube reference only, so weak).
- HUSS service letter to Top Spin owners (2009): check "wear at the swing arm hinge as well the gondola suspension"; both bearing sets (gondola and swing arm) to be inspected by the bearing maker after about 7,500 operating hours; the drawings show "boom arm hinge front & back" with a spherical inner bearing ring, and the gondola suspension shaft may have no more than 0.3 mm gap to the steel structure. Source: https://ridesdatabase.org/wp-content/uploads/2019/11/huss-rides_top-spin_mfg-doc_1259.pdf (manufacturer document, text read with pdftotext).
- Related HUSS patent US5188566 (Looping swing with parallel rows of seats): on a chassis (platform) "two vertical supports"; two parallel outriggers journaled at the top, driven by electric motors; counterweights at the opposite ends "corresponds to the total weight of the passenger gondola with half occupancy"; the gondola hangs from the outrigger tips on pendulum arms with a cardan-style joint and a rubber ring that limits and damps movement; two terraced rows of seats; boarding with the gondola hanging. Source: https://patents.google.com/patent/US5188566 (patent text; it describes the looping swing the Top Spin is built on, not the product itself).
- Toxicator (Alton Towers, Suspended model) is 24 m (78 ft) tall and "raised on a 16 ft (4.9 m) platform elevated above a pathway". Source: Wikipedia https://en.wikipedia.org/wiki/Toxicator (encyclopedia).
- Photos:
  - `Top_Spin_Huss_di_gardaland.JPG`: each tower is a tall central column with splayed braces to the ground and a service platform and ladder; each arm is a flat plate with a large round counterweight disc at the outer end; a long tube joins the two arms; the gondola is a flat deck with rows of seats on top, hung from the arm ends by large hubs; a fence stands in front.
  - `Huss_Top_Spin_im_Serengetipark.jpg`: two tall legs splay from each tower top to the ground; counterweight discs at the arm tops; the gondola is shown mid-swing, well above the ground, with railed stairs and walkways at the tower bases.
  - `Top_Spin_-_Parque_de_Atracciones_de_Madrid.jpg` (a themed unit): guests appear to stand on a raised walkway at the gondola deck's level, with steps at the right; a gate and fence stand in front. I cannot tell whether that walkway ever moves.

### Assumed or not confirmed
- Whether the loading platform lowers, retracts, or both. I found no source for either. Looked at: Wikipedia, ride-extravaganza, Burton's article, the HUSS service letter, Coasterforce, blooloop, a web search for "platform lowers". The Wikipedia page mentions "unlocking the gondola hydraulics" only for the end-of-ride swing.
- Tower footings, tower height, arm length, gondola width, platform size. HUSS site footprint figures (22 m by 9 m and 22 m by 11.5 m) appear only in a forum post quoting HUSS, which I could not verify.
- Whether permanent units stand on foundations instead of ballast. Not found.

---

## 4. Ferris wheel

### Observed in sources
- "Wheels may use single-sided (cantilevered) support or twin-sided support. The most common design is twin-sided with gravity-oriented capsules." Larger transportable wheels are dismantled each move; some use water ballast instead of permanent foundations. Source: https://en.wikipedia.org/wiki/Ferris_wheel (encyclopedia).
- The 1893 wheel: 80.4 m high; a 71-ton, 45.5 ft (13.9 m) hollow forged axle (89,320 lb); two cast-iron "spiders" 16 ft (4.9 m) across; 36 cars, each 24 by 13 by 10 ft; foundations of timber piles driven 32 ft, topped by a steel grillage filled with concrete; a 1,000 hp steam engine; no original plans survive. Source: https://en.wikipedia.org/wiki/Ferris_Wheel_(1893).
- Photo of the 1893 axle on rail trucks: a large hollow shaft with a big bolted disc flange and radial ribs at each end, men for scale. Source: the Commons DPLA photo named above.
- London Eye: supported "solely by an A-frame on one side"; spindle and hub cast in the Czech Republic; bearings from FAG/Schaeffler; rim 120 m across held by tensioned steel cables like a bicycle wheel; 32 capsules, each 10 tonnes, 25 riders, mounted on the outside of the rim and turned by electric motors; moves 26 cm/s and "usually does not stop, because the speed lets passengers walk on and off at ground level"; assembled flat on piled platforms in the river and lifted upright with strand jacks. Source: https://en.wikipedia.org/wiki/London_Eye (encyclopedia; read the first 100,000 characters).
- Most wheels keep cars upright by gravity; some large modern wheels mount cars outside the rim and use electric motors to turn them. Source: Wikipedia Ferris wheel page.
- Chance Rides spec sheets say only that dimensions are "approximate" and defer to "foundation drawings" (R80 II XL permanent wheel: 250 ft tall, 230 ft across). I saw these only in search summaries, not by opening the sheets.

### Assumed or not confirmed
- Cabin hanger hardware (pins, bearings, brackets) and whether the wheel hub turns on a fixed axle or the axle turns with the wheel. Looked at: Wikipedia, firgelli and mfgrobots explainers, patent search results; none showed hardware. The 1893 axle photo does not say.
- A-frame leg spacing and footing sizes for modern transportable wheels. Chance defers to foundation drawings I could not get.
- Drive: a search summary says old carnival wheels use rubber drive wheels on aluminium rims and the London Eye uses hydraulic pinch wheels on the rim; neither was confirmed from a primary source.

---

## 5. Carousel

### Observed in sources
Primary: the Tilden Park (Berkeley, California) merry-go-round maintenance manual, an operator's manual for a Herschell-Spillman Menagerie machine, c. 1911, 4 rows, 16 sections, all wood composition. https://www.ebparks.org/sites/default/files/Tilden-Park-Merry-Go-Round-Maintenance-Manual.pdf (text read with pdftotext; some inch marks and fractions were lost in extraction, so I quote only the clear parts).
- Centre pole base: "wooden mudsills with braces". Top bearing: "flat roller thrust bearing designed to carry 300,000 + pounds. This bearing supports the entire rotating mass of the carousel." A "cheese bearing" lower down.
- "Each sweep is supported by (2) guy rods that connect to the Top Bearing Assembly", making an umbrella; turnbuckles level the cranks.
- The platform is sanded wood flooring "supported from the sweeps by (2) drop rods". The platform hangs from the sweeps; it is not carried from below.
- Jumper system: one large bevel gear fixed to the centre pole and thirteen small gears that rotate with the carousel, "ratio, which is 4.33:1", so the figures bob 4 and 1/3 times per platform turn; "the crank is approximately 22' long with two or three 5" bends ... that raise the figures 10" up and down per revolution"; the jumper pole is schedule 40 black pipe hung from a casting on the crankshaft and passing through a cone ("High Hat"); crankshaft sits on Nylatron bearings in the cross sweeps; drive is a three-phase motor, belt, pinions, vertical drive shaft with a bull gear driving a ring gear; slip rings carry power. Direction on the checklist: counterclockwise.
- Dentzel glossary (manufacturer-history site), https://dentzel.com/reference/glossary.shtml: rounding boards "lock into the perimeter ends of the sweeps, forming a large wheel as seen from above" (also called crestings); sweeps are long spoke-like overhead arms, wood on older machines and steel on newer; the platform is a donut-shaped floor "hanging from the sweeps"; the centre pole is wood or steel, "10 to 16 or more feet tall", sitting on a large base with diagonal supports; shields sit on brackets at sweep ends.
- Dentzel's replica kit list: "12x8.5 diameter centerpole" (inch marks lost), 4 diagonal braces, 10 sweeps, 10 rounding boards, optional "fancier rounding boards with mirrors and lights", optional "set of low voltage lights". https://dentzel.com/mechanism/list.htm (manufacturer product list).
- MadeHow: a 15 in (38 cm) centre pole "will support about 50 horses and riders"; typical platform with riders weighs about 10 tons and is driven by a 10 hp motor; horses move up and down about 30 times a minute. https://www.madehow.com/Volume-4/Carousel.html (encyclopedia-style article).
- Wikipedia: Savage installed gears and offset cranks around 1880 to give the galloping motion. https://en.wikipedia.org/wiki/Carousel.
- Photo `LOOFF_CAROUSEL,_SANTA_CRUZ,_CALIFORNIA.jpg`: rows of bulbs run along the overhead radial beams and in rings near the outer and inner edges of the ceiling; mirrored and carved panels ring the centre drum; horses stand on brass poles; a low red rail edges the platform. I cannot see where individual rounding-board bulbs sit.

### Assumed or not confirmed
- Bulb counts and spacing on rounding boards. Looked at: Dentzel glossary and kit, madehow, Tilden manual (no light details), the Looff photo. Only "mirrors and lights" on fancier rounding boards is stated.
- Rounding board height and width: no dimensions in any source.
- Platform diameter and number of figures for a typical machine: only the Tilden machine's 16 sections.

---

## 6. Chair swing (wave swinger)

### Observed in sources
- Wikipedia: the seats are "suspended from the rotating top of the carousel as it spins"; on Wave Swingers the top also tilts; Zierer designed the first Chair-O-Plane in 1972 and Franz Schwarzkopf built it; about 200 Zierer units; tower swingers (Funtime Star Flyer, Mondial WindSeeker) followed in the late 2000s. Sizes cited there: Prater Turm 117 m, Eclipse (Gröna Lund) 121.9 m. https://en.wikipedia.org/wiki/Chair-O-Planes. The page gives no chain, canopy or tower construction.
- A ride reviewer on a Wave Swinger: the frame "is attatched to the support and can rise up to the top of the support", the support "is slanted a bit at the top" and rotates opposite the frame; the frame "rises up about 6 to 8 feet" and climbs a small tilted section; seats are baskets held by a chain and a steel bar. https://thedod3.com/?p=194 (personal blog).
- Patent US6022276 (Knijpstra, 1998), prior-art paragraph: chairoplanes have "several passenger seats ... freely suspended by chains on a beam rotatable around a central mast", and tilting the axis gives a wave. https://patents.google.com/patent/US6022276 (patent text; the invention itself is a rod carousel).
- Photo `Wave_Swinger,_Gröna_Lund.jpg`: a tall ornate cone-roof canopy with a ring of bulbs along its rim, a crown finial, a narrower decorated drum under it, and many chains hanging; the whole ride stands on a pier.
- Photo `Münster,_Send_--_2018_--_1756.jpg` (a tower swing): a tall white lattice tower that tapers toward the top, with rails and ladders on its faces; at the top a round red crown carries rods radiating like spokes, with cables to pairs of seats; the seats fly outward.
- Zierer figures I saw only in a search summary: Wave Swinger 40 about 18.2 m across and 9.2 m high, operating height about 11.9 m (a rise near 2.7 m); Wave Swinger 56 about 19.7 m across. Not confirmed by opening the page.

### Assumed or not confirmed
- Chain length, chain size, clevis details, seat height off the ground. Looked at: Wikipedia, Zierer / IAAPA / amusement-rides listings (login page and image-only PDF), patent search. Nothing found.
- Canopy diameter versus chain circle: only the Zierer summary above.
- How the top lifts on a Wave Swinger (hydraulic ram or screw) is not stated by any source I opened.

---

## 7. Swinging ship and rotating pendulum (Frisbee type)

### Observed in sources
- HUSS Pirate Ship, dealer listing: "a steel support structure made up of 4 uprights leaning in from the 4 corners of the rectangular base to meet at the top in a hub. This hub bears the hanging boat using 2 linked spokes." (Numbers in that PDF were garbled by its fonts, so I use none.) https://www.amusement-rides.com/product/pdf/pirate-huss (used-ride broker listing).
- Chance Pharaoh's Fury (ship): 10 seats, 4 adults or 6 children per seat, 65 degrees maximum swing from centre, 39 ft/s, semi-automatic lap bars, arc over 43 ft high (older page said 54 ft), "Dimensions are approximate" and deferred to foundation drawings. Seen only as search-summary quotes from https://chancerides.com/wp-content/uploads/2025/01/Pharaohs-Fury-Spec-Sheet_2024.pdf (manufacturer spec; I could not open it).
- Wikipedia: Huss Pirate Boat holds up to 54 in 9 rows; riders about 60 ft (18 m) up at the top; one Chance model "could be permanent or transported on one 53-foot trailer". https://en.wikipedia.org/wiki/Pirate_ship_(ride). No frame detail.
- Frisbee types: a circular gondola on a pendulum arm between two support frames; swing 120 degrees (Chance Revolution), 180 (HUSS Frisbee), 240 (HUSS Giant Frisbee), 360 (KMG Inversion); heights 15 m to 62 m. https://en.wikipedia.org/wiki/Giant_Frisbee (many citation-needed tags).
- Photo `SFMM-_Buccaner.jpg`: the yellow frame legs are tube and box sections braced with diagonals; a wooden boarding platform with a roof and rail stands beside the boat at deck height; the boat has benches with balustrade backs.
- Photo `Pendulus.jpg` (titled "Pendulus"; it shows a pendulum-type ride, maker not stated): four legs splay to the ground from a top hub; a long arm carries a disc with seats around its rim; a railed stair and platform at the left; low fence round the ride.

### Assumed or not confirmed
- Leg footing sizes, bearing sizes, arm length, hull dimensions. Looked at: amusement-rides listing, Chance spec (summary only), Wikipedia, Commons. Not found.
- Whether Frisbee arms are single or paired: the Commons photo shows one arm; the HUSS Pirate listing says two linked spokes.
- Boarding platform height for Frisbee rides: not found.

---

## 8. Drop tower and observation tower

### Observed in sources
- Intamin Giant Drop 8 data sheet: height 85 m, travelling height 77 m, top speed 100 km/h, one vehicle with 8 seats, 250 riders an hour, lift speed up to 5 m/s, magnetic braking; drop tracks can be wall-mounted inside or outside a building. https://www.intamin.com/wp-content/uploads/2019/09/Giant-Drop-8-Intamin.pdf (manufacturer spec, text read with pdftotext).
- The Giant Drop (Dreamworld): two vertical tracks attached to the flank of an existing tower; each carries one floorless gondola for 8; catch cars lift it; permanent rare-earth magnets stop it; 119 m high. https://en.wikipedia.org/wiki/The_Giant_Drop.
- Scream (Heide Park): built by re-using an observation tower; 103 m high, 71 m drop, foundation "8 m deep and 10 m in diameter". https://en.wikipedia.org/wiki/Scream_(Heide_Park) (single German-park source).
- HUSS patent US5893802 (a small tower ride): the tower is a vertical frame on a base frame with outriggers, in two detachable halves and a grid construction for weight; for stationary use the base can be anchored in a foundation; the carrier is "a box open top and bottom" that "bears against the outside of the tower by means of rollers ... guided in vertical rails provided on the outside of the tower", with an inner guide cage against the inside; a pneumatic piston and a cable lift it. https://patents.google.com/patent/US5893802 (patent text).
- Older observation-tower patents (search summaries only): a car that rises and turns on guides (US548122, 1895), circular tracks around the tower carrying wheels (US525031), and rollers held against guide posts so carriages cannot jump the track (US750717).
- Photo `Giant_Drop_(Six_Flags_Great_America)_1.jpg`: a single round, tapered steel tower with vertical running tracks on its sides and a cap at the top. It is not a lattice.
- Photo `Münster,_Send_--_2018_--_1756.jpg`: a lattice tower (a tower swing, not a drop ride), which shows that lattice towers exist.

### Assumed or not confirmed
- Tube or lattice column sizes, brace patterns, guide-shoe arrangement for Intamin towers. Looked at: Intamin sheet, Wikipedia, patents, Commons. Not found.
- Rotating observation cabin drive and ring bearing details. Looked at: Coasterpedia (no construction text), Wikipedia, patent search. Only old patents.
- Boarding height and gate arrangements. Not found.

---

## 9. Teacups

### Observed in sources
- US 8,864,592 (Disney Enterprises, 2014), background: spinning tea-cup rides use "small turntables ... mounted onto a large turntable"; "Typically, each set of six teacups has a center bearing mounted underneath"; passengers spin cups by hand while the main turntable rotates. https://patents.google.com/patent/US8864592 (patent text; the extraction of the exact sentence was lossy, so treat the wording as approximate).
- Technical Park: "On this primary rotating platform, there are several secondary platforms that host the individual teacups"; each cup has a bearing beneath it and "the central wheel inside the teacup ... is directly connected to this bearing". https://www.technicalpark.com/news/tea-cup-rides-in-amusement-parks/ (manufacturer's news article).
- Mack Rides: cups sit on "a large rotating platform"; rider spins each cup; open design for easy loading. https://www.mack-rides.com/products/tea-cup-ride (manufacturer marketing page; no dimensions).
- A used 2018 Zamperla Tea Cup 12 listing: a 14.5 m turntable "housing four smaller turntables"; footprint 16 by 16 by 5 m. https://www.usedamusement-rides.com/?p=1900 (dealer listing; the cup count per small turntable is unclear).
- Zamperla Tea Cup Midi 6 (search summary only): 3.6 m high, 10 m across, 5.5 rpm, steering wheel per cup.
- Photo `Mad_Teacup_Ride_in_action_-_panoramio.jpg`: each large cup stands on its own saucer disc, with the saucers laid on a painted floor that is flat across the ride; handles on the cups.

### Assumed or not confirmed
- Cup diameter and wall height of real cups. Looked at: Mack, Technical Park, Zamperla summary, Commons. Not found.
- Platform height off the ground. Not found.
- Whether the small turntables turn the opposite way to the large one: the Disney patent says they are mechanically linked; the direction was not stated in the part I read.

---

## 10. Roller coaster supports

### Observed in sources
Steel
- A construction report on a new coaster at Warner Bros. Movie World: footings "mostly round, with varying numbers of bolts protruding", "the more bolts, the larger the support column", a heavily reinforced slab called a "pile cap" tied to piles reaching "many metres" underground; "eight-bolt support columns"; the rebar must be placed very accurately because the supports attach to it. https://www1.parkz.com.au/update/2016/10/04/424-Roller_coaster_construction_continues_at_Movie_World.html (news article with photos).
- Coaster101: "Tension force is transmitted to the foundation through the anchor bolts"; "Compressive force is transmitted ... through perfect contact between the column base plate and the grout"; shear goes through the shear pin and anchor bolts into the grout. https://www.coaster101.com/?p=4917 (educational blog). A forum post describes the same sequence (anchor rods cast in with a pocket for a shear key, nuts levelled, column set on it, gap and pocket grouted at the end); forum link https://forums.coasterforce.com/goto/post?id=1142220 returned 403 to me, so I have that only through a search summary.
- Coaster101 on track: prefabricated track segments are "bolted to the support structure and to other track segments"; tubular track is bent from pipe. https://www.coaster101.com/2011/11/06/coasters-101-track-fabrication/. A reader comment there says prefabricated track is "fixed to each bent ... creating a rigid connection"; that is a comment, not the article.
- A truss-track patent describes a column saddle that is bolted to the column or integral to it (search summary only).

Wooden
- A first-person account of building Grizzly at Kings Dominion: each footer location dug, "concrete was poured after rebar cages dropped in"; "Huge 6x8 posts were paired together (called "bents")", then "raised by a crane and bolted to the footer strap"; "4x12 timbers called ledgers" lowered "onto aluminum clips bolted near the tops of the posts"; walkboards and laminated track "sat directly on top of the ledgers" and "there is nothing holding it down, not one nail"; "4x4 boards called intermediates are bolted underneath ... every 2 feet or so"; batter braces on curves. https://www.dalebrumfield.net/single-post/2015/05/20/part-16-kings-dominions-grizzly-this-wildcat-gets-a-2nd-of-9-lives (blog by a former ride worker; "not one nail" contradicts Wikipedia, below).
- Wikipedia: traditional wooden track is cut and bent on site and "mounted layer-by-layer to the support structure with steel running plates"; Topper Track replaces the steel strip and top two wood layers with a steel box; factory track comes in 25 ft (7.6 m) sections; structures sway "a few inches to a few feet" on purpose. https://en.wikipedia.org/wiki/Wooden_roller_coaster. The page says nothing about footings, posts or bents.
- Search summary of a trade article on Goliath (Six Flags Great America): over 144 precast concrete footings buried to within 6 in of the top, metal brackets cast in, bents built flat and craned up, Topper Track "a rectangular steel box ... bolted to the six-layer laminated wood stack". Source link https://www.woodworkingnetwork.com/... returned 403 to me, so this is unconfirmed.

### Assumed or not confirmed
- Footing size, depth, rebar and bolt sizes: Movie World gives only that they vary with column size; Chance and others defer to site drawings. Looked at: Coaster101, Parkz, Wikipedia, DOT bridge documents (not coaster-specific).
- Cross bracing between steel columns: not shown by any source I opened.
- Wooden post and ledger section sizes beyond the 6x8 posts and 4x12 ledgers in the one blog.
- Whether the laminated track is nailed to ledgers or floats: sources disagree (Wikipedia "mounted layer-by-layer to the support structure" versus the Grizzly blog's "not one nail").
- Manufacturer-specific saddle and splice details (Intamin, B&M): not found.

---

## 11. Handrail grip, handrail height, stairs

### Observed in the standard text
Source: 2010 ADA Standards for Accessible Design, read in full from https://www.access-board.gov/ada/ (publisher's page). These are accessibility rules for buildings and facilities; they are not ride rules, but they are the only free primary text I could read.
- 504.2 Treads and Risers: "Risers shall be 4 inches (100 mm) high minimum and 7 inches (180 mm) high maximum. Treads shall be 11 inches (280 mm) deep minimum." Uniform risers and treads in a flight.
- 504.3 Open Risers: "Open risers are not permitted."
- 505.4 Height: "Top of gripping surfaces of handrails shall be 34 inches (865 mm) minimum and 38 inches (965 mm) maximum vertically above walking surfaces, stair nosings, and ramp surfaces."
- 505.7.1 Circular Cross Section: "outside diameter of 1 1/4 inches (32 mm) minimum and 2 inches (51 mm) maximum."
- 505.7.2 non-circular: perimeter 4 to 6 1/4 inches (100 to 160 mm), cross-section 2 1/4 inches (57 mm) maximum.
- 505.5 Clearance: 1 1/2 inches (38 mm) minimum between gripping surface and adjacent surfaces.
- 505.2 handrails on both sides of stairs and ramps.

### Observed in rules for rides
- New Jersey ride regulation N.J.A.C. 5:14A-9.16: handrails for stairs or ramps with a change in elevation of 30 inches or more; guardrails on open-sided walking surfaces more than 30 inches above grade; new or replacement guardrails "at least 42 inches above the ramp surface, nose of steps or landing". https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-5-14A-9-16 (regulation text). It sets no riser or tread sizes.

### Assumed or not confirmed
- IBC: a City of Puyallup permit document and other secondary pages quote IBC 2021 1011.5.2 as risers 4 to 7 in and rectangular treads 11 in minimum, and 1014.3.1 as grip diameter 1 1/4 to 2 in. I could not open ICC's own pages (403), so I do not give those clauses as verified. They agree with the ADA numbers above.
- ASTM F2291: the paid standard; a catalogue summary says section 13 covers fencing, guardrails, handrails, gates and walkways. I did not see any clause text and give none.
- EN 13814: paid; the current Part 1 is EN 13814-1:2019+A1:2024 (from a BSI/genorma listing). I saw no clause text and give none.
- Wisconsin ride rules (SPS 334) riser 6 to 8 in and 42 in guardrail came from a search summary; the page itself refused connection.

---

## Follow-up check A: does the Top Spin loading floor move?

Asked: does the floor under the gondola seats lower, drop, retract or fold away before the cycle, or is it a fixed walkway the gondola swings clear of?

### Observed in sources
- **A safety body says some Top Spin-type rides do have retracting floor sections.** The UK ride-certification body NAFLIC, Technical Bulletin 215 "Top Spin Accidents & Incidents", March 2002: "Some designs have retracting floor sections which move in and out for loading. There have been instances in which the safety interlock circuits only disconnect the 'enable' signal for the drive, without any additional latching element. Momentary operation of safety limit switches may then unexpectedly start the ride moving." It does not name a maker, a model, or whether the floor moves in, down or sideways. Its two named accident examples are Far Fabbri Top Spins, not HUSS. https://adips.co.uk/technical-bulletins-library-dir/215-Top-Spin-Accidents-Incidents.pdf (a one-page safety bulletin; I read it with pdftotext).
- **HUSS's own page for the suspended (floorless) model** gives footprint 22 m by 9 m, height 13.2 m, 38 riders, 250 kW, and "38 riders sit back-to-back on our floorless suspended gondola with nothing at their feet but the open air." It says nothing about loading or a floor that moves. https://www.hussrides.com/en/thrill-rides/top-spin-suspended/ (manufacturer page).
- **HUSS's marketing post for Talocan** (a suspended Top Spin at Phantasialand), as a search summary only: the entire cabin is lowered through an iris into the ground after boarding and comes back up into the station afterward. I could not open the LinkedIn page, so this is unconfirmed. If true it describes the whole gondola, not a floor, and only that one installation.
- **Forum posts about the planned Toxicator** (a suspended model) say the floor drops "a good couple of metres prior to the ride beginning" (one poster, comparing with Talocan), that a lowering floor "needs a big trough the width of the gondola which is at least two metres deep", and one poster overlaid "Huss's technical drawing" and found the ride "very close to fitting exactly but not quite in a couple of places around the lowering floor". The posters say these are plan readings and speculation; none rode the Toxicator. https://towersstreet.com/talk/threads/2025-toxicator-new-forbidden-valley-suspended-top-spin.7083/page-8 (forum, page 8 of 109 only).
- **The classic (floored) model**: Wikipedia, ride-extravaganza, and the HUSS service letter describe the gondola on arms with air-braked hubs; none describes loading. A search summary of a forum says the arms lock the gondola so the operator can load it; I could not open it.
- **Photo** `Top_Spin_-_Parque_de_Atracciones_de_Madrid.jpg`: guests appear to stand on a raised walkway at the gondola deck's level, with steps at the right. A photo of a ride at rest cannot show whether a floor moves.
- **Accident reports**: I searched for investigations that mention a platform or floor. The only relevant text found is the NAFLIC bulletin above. The other Top Spin accidents I found (Mianchi in China, Jinnah Park in Pakistan, Surajkund in India) concern restraints or structure, are not HUSS rides, and mention no platform.

### Assumed or not confirmed
- **Whether a classic HUSS Top Spin's loading floor moves at all.** No HUSS or operator text found. The NAFLIC bulletin shows some Top Spin-type designs have moving floor sections, but does not say which makers or whether the movement is lowering, sliding or folding.
- **Whether the generator's "floor lowers on four rams" matches any real unit.** Not confirmed. The lowering-floor claims are about the suspended model and come from forum posts or one marketing summary.
- **Main-arm pivot height compared with gondola length.** No source gives it. Looked at: HUSS suspended page (footprint and overall height only), Wikipedia, ride-extravaganza, Commons photos, forums. The only related figures: suspended model 13.2 m overall (HUSS); Talocan 18 m (Wikipedia); Toxicator 24 m (Wikipedia); classic footprint 22 m by 11.5 m (forum quoting HUSS, unverified, and a later poster said that figure was a concrete loading structure).
- **A working-site fact** (not found in any source): whether permanent installations stand the ride on a raised concrete loading structure. Toxicator's 4.9 m platform is the only mention (Wikipedia).

---

## Follow-up check B: Scrambler arms and cars

Asked: arms and cars per arm for Eli Bridge and other makers, and whether the main arms are at the top of the mast with tie rods (overhead) or low.

### Observed in sources
- **Eli Bridge's own service bulletins** (No. 060131-10 and 060131-11, both released January 31, 2006, for the Scrambler, Trailer-Mounted Scrambler and Retro-Fitted Scrambler) show the Scrambler has both a top and a bottom set of arms, tie rods, and seats that hang near the bottom arms. https://adips.co.uk/technical-bulletins-library-dir/Eli-Bridge-Safety-Alerts-Bulletins-Notifications-1-31-2006.pdf (manufacturer bulletins, read with pdftotext). Quotes:
  - "The Scrambler uses two of these [tapered roller] bearings, per sweep, at the top and bottom of the stationary center pole."
  - "Eventually, the swaying will allow the seats to strike the bottom sweeps while the ride is in motion if not corrected."
  - Park-model bases are checked "to verify the distance between each of the bottom sweeps and the top of the catwalk is relatively equidistant, approximately 3.5"". So the bottom sweeps run about 3.5 in above the walkway around the centre.
  - "The hole wear can be in all structural connections such as seat tabs, seat sweep, either end of the upper or lower sweep or the tie rods." "The original diameter of the assembly pin is one inch."
  - Weld cracking is where "the center pole and the base" meet; "the stationary center base" is a separate part, with an interference fit and a weld.
- **An assembly sequence for an Eli Scrambler** (search-result summary of the blog "Engineering Analysis: Eli Bridge Scrambler", which I could not open because of a connection error): set the centre pole, hang the top sweeps with tie rods, suspend the unit poles from the top sweeps, pin the bottom sweeps to the unit poles, then hang the seat sweeps from the unit poles and attach seats. Treat as unconfirmed, but it agrees with the Eli bulletins.
- **Cars per arm**: "twelve cars, divided evenly between three arms" (search summary of the same blog); the original 1953 to 1954 ride had 12 cars on 3 arms (Wikipedia, citing a 1954 trade-magazine caption); Coasterpedia says arms are "usually three" with "usually four" cars on each. https://coasterpedia.net/wiki/Scrambler (fan wiki).
- **Other makers**:
  - Knoebels' Merry Mixer (Garbrick): "16 cars on 4 arms instead of the 12 on 3" (a CoasterBuzz poster). https://coasterbuzz.com/Forums/Topic/scramblers-sizzlers-and-merry-mixers (forum).
  - Schwarzkopf Monster: five arms with four or five cars per arm; Klaus Polyp: five arms with four cars each; the Eyerly Monster is a different ride with arms that move up and down (and the article says in one place six arms). https://en.wikipedia.org/wiki/Monster_(ride) (the article is inconsistent on arm count). These are Monster-type rides, not Scrambler copies.
  - Wisdom Sizzler (and PWS Sizzler): "thicker arms and a platform"; a CoasterBuzz poster quoting Dave Althoff says Sizzler-type rides have a platform and the Scrambler (a "grasscutter") does not; ride-extravaganza says the Sizzler uses hydraulic drives where the Eli Scrambler uses a cog drive (https://www.ride-extravaganza.com/intermediate/scrambler/), and Wikipedia says a Wisdom Family Sizzler has wheels guiding the pods underneath. Wikipedia's lines on these are mostly uncited.
  - A Great Adventure variant (the Sidewinder) had "the pivot arms above the set of seats" (one forum post).
- **Photo** `Eli_Bridge_Scrambler®_-_panoramio.jpg` (at rest): three low arms as red trusses near deck height, each with an upright post at its tip; blue rods run from the peak of a tall bundled mast down to the arm tips; a white horizontal beam crosses above the tubs. That agrees with the Eli bulletins: low bottom sweeps, plus an upper level held by tie rods from the mast. I cannot tell from the photo which member is which or how a tub fastens.
- **The 1941 patent** (US 2,259,691) suspends each seat unit from the top of the pole with its bottom end in a bearing plate on a lower arm. So the earliest design also had top and bottom supports.

### Assumed or not confirmed
- **Arm height, mast height and tie-rod angle in metres.** Not in any source I could open. Eli's FAQ says its engineers do not take information requests, and the Eli manual is not public. The only length-like numbers: bottom sweeps about 3.5 in above the catwalk; assembly pin 1 in.
- **Mondial and "Twister"**: I found no source on a Mondial Scrambler-type ride or on a Schwarzkopf Scrambler copy by name. The "Twist" entries on Coasterpedia (Church, Pollard, Walldren) list makers only; no arm or car counts.
- **Eyerly** Scrambler-type rides: no source found beyond the Eyerly Monster above.
- **Whether the main (top) arms sit at the very top of the mast** or part-way down: bulletins say "top sweeps" and "bottom sweeps" and the photo shows an upper beam well above the tubs, but none gives the height.

---

## Mismatches with the generator

Line numbers are in `C:\Users\SaloQT\Downloads\FPV\src\world\park\`. The conclusions are about what the sources show; where a source is weak I say so.

1. **Top Spin loading floor lowers on four rams** (`generator.ts:325-339`, `flatPhysics.ts:58`). Updated after follow-up check A. NAFLIC bulletin 215 says some Top Spin-type rides have retracting floor sections that "move in and out for loading", so a moving floor is real for some designs. No source says a classic HUSS Top Spin lowers its floor, or how (four rams are mentioned nowhere). Forum posts and one marketing summary say the suspended model's floor or gondola drops. Unconfirmed, not disproved.
2. **Scrambler** (`generator.ts:520-540`, `flatPhysics.ts:55`): three overhead arms at 3.5 m with a satellite hanging under each tip, and 6 cars (2 per satellite). Updated after follow-up check B. Eli Bridge's own bulletins show two sets of arms: top sweeps hung on tie rods, and bottom sweeps about 3.5 in above the centre walkway, with the seats hanging near the bottom sweeps; the photo agrees. The generator has only the upper set (overhead arms at 3.5 m, 2 cars on a cross-arm under each tip). Sources also show 12 cars (3 arms x 4 cars), against 6 here (Merry Mixer: 16 cars on 4 arms).
3. **Teacups** (`generator.ts:606-632`): six cups sit directly on fixed pins on the one big platform. The Disney patent, Technical Park, the Tea Cup 12 listing and the photo all show cups on their own saucers or small turntables carried on a large turntable.
4. **Carousel load path and stroke** (`generator.ts:504-519, 553, 585`; `rideDimensions.ts:39`): the platform is a turntable on a 1.6 m diameter mast, with the main bearing at 0.9 m, and the horse slider travels from -0.28 to 0.28 m (0.56 m). The Tilden manual and Dentzel show the platform hung from the sweeps by drop rods, a top thrust bearing carrying the load, a crank stroke of 10 in (0.25 m), and a centre pole about 15 in (0.38 m) across (MadeHow).
5. **Stairs and handrails** (`assembly.ts:112, 121`; `generator.ts:322`; `rideDimensions.ts:20`): the largest riser allowed is 0.2 m, above the 180 mm maximum in ADA 504.2; entry stair handrails sit 1.05 m above the nosing line, and the station stair 1.1 m, above the 965 mm top in ADA 505.4. The 50 mm grip (`assembly.ts:112`) fits the 32 to 51 mm range in 505.7.1. Going 0.35 m exceeds the 280 mm minimum. Ride stairs may follow other rules; I could not read ASTM F2291.

Other differences, less important:

6. **Enterprise wheel size** (`flatPhysics.ts:6`): radius 7.5 m (15 m across) against an 18 m Alton Towers wheel and a 21 m Zamperla footprint.
7. **Enterprise boom** (`newFlatAssets.ts:47-66`, `flatPhysics.ts:30`): two separate rails 3 m apart with pin-and-cheek-block pivots in a pit; the Tykkimäki and Serengeti photos show one wide box or plate boom. Pivot hardware is unconfirmed. Maximum tilt 1.48 rad (84.8 degrees) (`flatPhysics.ts:39`) against 87 degrees quoted.
8. **Enterprise deck as a ring around a pit** (`flatPhysics.ts:10-13`): no source describes it; the portable unit shows a flat platform and a base housing.
9. **Top Spin counterweight and ballast** (`newFlatAssets.ts:213-216`, `generator.ts:325`): a 1.2 by 2 by 1.4 m block on a stub; photos show a large round disc on a plate arm. Sources mention 27 t of water ballast per tower on portable units; the generator uses footings.
10. **Wave swinger lift** (`generator.ts:518-519`, `generator.ts:667`): the canopy slides 15.4 m up the mast. The reviewer saw a rise of about 6 to 8 ft; a Zierer summary implies about 2.7 m. A 15 m lift matches a tower swing (Star Flyer type, Münster photo), not a wave swinger.
11. **Ferris wheel boarding height** (`generator.ts:304, 346`): the cabin floor is 2.9 m above ground when docked, boarded by stairs and a bridge. London Eye passengers walk on at ground level; other wheels' boarding height is unconfirmed.
12. **Drop tower as a four-column lattice** (`generator.ts:436-497`): the photographed Intamin Giant Drop is one tapered tube with tracks on the outside, and the tower at Heide Park has a footing 8 m deep and 10 m across against the generator's 0.15 m footing. Lattice towers do exist (HUSS patent describes a grid frame).
13. **Pendulum and ship arm** (`generator.ts:416`): a single 0.5 m radius arm; the HUSS Pirate listing says two linked spokes.
14. **Coaster bents** (`coasterSupports.ts:82-123`, `rideDimensions.ts:6, 11`): steel bents use four anchor bolts and no grouted shear key; Movie World shows eight-bolt columns on larger supports and Coaster101 describes grout and shear pins. Wooden bents use round 0.34 m posts; the one account describes paired 6x8 posts and 4x12 ledgers. Spacing 12 m steel and 6 m wood (`coasterSupports.ts:147`) was not checked against any source.

---

## Standards cited in code

### AWS D1.1 weld reinforcement ("permits up to 3 mm")

Cited at `constructionAudit.ts:9`, in the comment above `CONTACT_TOLERANCE` (0.5 mm): "finer than weld reinforcement (AWS D1.1 permits up to 3 mm)".

**Result: I could not reach the text of AWS D1.1, so I cannot confirm that sentence, and I give no clause, table or value as verified.** D1.1 is a paid standard.

What I tried:
- Web searches for the clause and table numbers. They returned only AWS forum threads and a few other pages.
- The AWS forum threads themselves (`app.aws.org/forum/...`) returned 403 when opened, so I saw them only as search-result summaries.
- An AWS Inspection Trends PDF (`app.aws.org/itrends/2010/07/it201007/it0710-23.pdf`) returned 404.
- A Los Alamos welding table (`https://engstandards.lanl.gov/esm/welding/vol2/WFP 2-09-Att-1-R1.pdf`) opened, but it is LANL's own table for DOE nuclear work. It gives reinforcement by thickness (3/32 in up to 1 in, 1/8 in for over 1 to 2 in, and so on). It does not mention D1.1, so it is not evidence for D1.1.

What the search summaries said, all from forum posters and unverified (these are leads to check against the book, not facts):
- Under older editions (before 2010), forum posters quote clause 5.24.4 as: groove welds have minimum face reinforcement, and "in case of butt joints & corner joints it shall not exceed 1/8" inch. 1/8 in is 3.2 mm, so "up to 3 mm" would be a rounded form of that old limit, for butt and corner (groove) joints, not fillets.
- Posters say the 2010 edition replaced the old Table 5.4 with Tables 5.9 and 5.10, where the allowance depends on plate thickness. One poster reads Table 5.10 as allowing 3/16 in for plate over 1 in. Other posters dispute that reading, and a similar 3/16 in tier also appears in ASME B31.3, so the figure may not belong to D1.1. This is unresolved.
- Posters disagree on whether the 1/8 in limit is per face or for both faces, and whether it covers root-side reinforcement.
- Fillet-weld convexity is a separate limit from groove-weld reinforcement.

What this means for the comment: the "3 mm" figure matches the old flat 1/8 in groove-weld limit as quoted by forum posters, but I could not confirm it against D1.1 and the current edition may use a thickness-based table. Before leaving "AWS D1.1 permits up to 3 mm" in the code, someone with the standard should check the current edition's profile table (Tables 5.9 and 5.10 per the forum posts) for the thickness and weld type it applies to. Until then the comment could say "weld reinforcement is typically a few millimetres" without naming the standard.

### Resolution in the code

The AWS D1.1 claim has been removed from `constructionAudit.ts`. The comment at lines 8-10 now justifies the 0.5 mm contact tolerance only by on-screen size: 0.97 pixel at 0.6 m in a 1080p view with a 50 degree field of view.

- **Observed (my own arithmetic, not a source):** if the 50 degrees is the vertical field of view, the view at 0.6 m is 2 x 0.6 x tan(25 degrees) = 0.56 m tall, so one of 1080 pixels covers 0.52 mm, and 0.5 mm is 0.97 of a pixel. That matches the comment. If the 50 degrees were the horizontal field of view, the figure would differ; I did not check which the renderer uses.
- **Assumed or not confirmed:** nothing in this file supports the tolerance from a standard. It rests on screen size alone, and the real weld reinforcement limit in D1.1 is still unchecked (see above).
