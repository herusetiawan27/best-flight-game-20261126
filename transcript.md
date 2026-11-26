# Build note — Golden Strait Run (best-flight-game-20261126-0057)

Entry built 26 November 2026 (WITA) for the make.fun bounty
best-flight-game-20261126-0057 ($500, free entry, top 50 paid). Anchor:
makefun anchor a2cf6faa196dc094d84501450b87435850abd28e round 34287143.

## Concept

"Golden Strait Run" — an original golden-hour seaplane game: thread 12
glowing golden rings over a tropical archipelago strait (turquoise sea,
green islands with beaches, a lighthouse, boats), then land gently on the
coastal runway. Deliberately NOT a volcano/Merapi theme — a competitor
(@nofrizal, "Merapi Run") already works that ground.

## Tech

- Canvas 2D pseudo-3D: own perspective projection (camera basis from
  heading/pitch) + painter's-algorithm sorting. Fixed 1280×720 canvas,
  CSS-scaled with aspect preserved. No WebGL, no external assets, no
  network — runs offline from static files.
- Chase view with a banking seaplane drawn from polygons; lit instrument
  cluster (artificial horizon with pitch ladder, altimeter, airspeed,
  throttle bar, vertical speed, stall warning) and a HUD with altitude,
  speed, heading, score, timer and rings left.
- Flight model: throttle/lift/gravity with a forgiving stall; landing is
  judged on speed, sink rate and alignment. Title screen, ring course,
  runway finale, success / game-over screens, R restart, P pause, M mute.
- Controls: arrows + WASD, mouse steering, Enter/click to start.
- Sound: WebAudio synth only (engine hum tracking throttle, ring chime,
  success arpeggio, crash thud); starts on first user gesture.
- Code layout: game/index.html + ES modules in game/src/ (main, render,
  world, input, audio, shots, random, config) — all written fresh for this
  entry. An autopilot proof flew the unmodified game logic end-to-end:
  12/12 rings and a successful landing.

## main.ts

Written fresh (Node 22, stdlib only): copies game/ and screenshots/ into
MAKEFUN_OUTPUT_DIR (default /output) and writes dossier.json there via
buildDossier from vendor/makefun-game.ts (vendored byte-identical,
sha256 dc67187521b24025ff952f8c231485a6eb92d6d71d29edd2a08154ffb4376129)
with caps text_max_bytes 163840, screenshots {max 4, max_bytes 262144},
game_max_files 993, game_max_bytes 50331648, game_path_max_bytes 1000.
A later revision added a preflight check (screenshot count/byte caps and
game file-count cap fail fast with a plain message). Tested in a sandbox
(positive + oversized-screenshot negative test) and against the real repo:
13 files copied, dossier.json 578,541 bytes, schema makefun/dossier/v1,
4 images, cover index 0.

## Screenshots

Deterministic scenes are built into the game: ?shot=<scene>&seed=<n>
builds the world from a seeded RNG, runs a fixed-step (dt = 1/60)
autopilot simulation, renders one frame and sets window.__shotReady.
Scenes: cover 100 steps (seed 7), rings 240 (seed 3), approach 430
(seed 5), title 90 (seed 1).

Capture method: GitHub Pages was enabled on this repo (master branch,
root), and the Simular Box Chrome loaded the Pages URLs; the rendered
frames were photographed from the real browser and cropped to the canvas
(1078×606). Two framing fixes were made along the way: the approach scene
first stopped too far out, then sat dead on the centreline where the
fuselage hides the strip — it now starts ~90 m east of the centreline so
the autopilot's intercept leaves the runway readable beside the nose.
(Browser module caching was bypassed by capturing from fresh staging
paths; the staging copies were removed afterwards.)

Final screenshots (all ≤ 256 KiB, verified visually: aircraft in frame,
instruments lit, ring/runway ahead, HUD altitude/speed/heading readable):

- screenshots/1-cover.jpg — 1078×606, 94,936 bytes (cover)
- screenshots/2-rings.jpg — 1078×606, 98,280 bytes
- screenshots/3-approach.jpg — 1078×606, 83,985 bytes
- screenshots/4-title.jpg — 1078×606, 113,461 bytes

## Aircraft art pass (26 Nov, later)

At the user's request ("perbaiki pesawatnya, buat yg lebih bagus") the
seaplane's rendering in game/src/render.js was reworked — visuals only,
no gameplay/physics/HUD changes, same shot scenes and seeds: shaded
fuselage with sun-side warmth and panel lines, glossy gradient canopy
with sun glint, spinning prop disc with blade streaks and spinner,
two-panel wing with dihedral, leading-edge sheen, aileron/flap lines,
gold tips and glowing nav lights (red left / green right), wing and
float struts, red-striped floats, gold fin with a red band and antenna
wire, exhaust stubs, and a soft water shadow that shrinks and fades
with altitude. All four screenshots were then re-captured from the
Pages build (fresh staging path, same crop box) and verified visually.

## Revision round 3 — feel, sea, total aircraft redesign (26 Nov, later)

The user played the game and complained: the plane felt stiff, up/down
steering was hard, the sea moved along with the steering, and the plane
had to change TOTALLY. All three were fixed:

- **Flight feel** (config.js, main.js): attitude no longer crawls at a
  capped rate — pitch and roll ease exponentially toward the input
  target (pitchResponse 8.5/s, rollResponse 10/s), so a key press
  answers at once and settles smoothly; releasing the keys auto-levels.
  maxPitch 0.42 → 0.50 and the pitch→climb coupling 0.92 → 1.0 make
  up/down genuinely easy. Mouse steering gets the same smoothing. The
  autopilot (same flight model) was re-verified headlessly against the
  real modules: 12/12 rings and a successful landing, score 2654.
- **Anchored sea** (render.js drawSea): the water layer is now fixed to
  the screen — constant horizon at H/2, a gradient defined over fixed
  screen rows, a soft haze band at the waterline, and a static
  screen-space sparkle texture (deterministic hash of the cell). The
  projected latitude lines that slid, rolled and bobbed with every
  steering input are gone; islands, boats, rings and the runway still
  move through the view exactly as before.
- **Aircraft: total redesign** (render.js drawPlane): a new sleek
  aerobatic seaplane drawn from scratch — deep teal + white livery
  with orange accents (nothing like the old red/white/gold plane),
  volumetric rounded fuselage with sun-side highlight and shaded
  flank, a big glossy canopy, a mid wing with rounded orange-tipped
  panels and nav lights, streamlined orange-striped floats, a white
  fin with an orange sunburst, a blurred prop disc with an orange
  spinner, and the altitude-scaled water shadow kept. Drawn ~30%
  larger; banking/pitch behaviour unchanged.

All four screenshots were re-captured from the Pages build (fresh
staging path shotstage6, same scenes/seeds and crop box) and verified
visually — new plane unmistakable in every frame, sea calm behind it:

- screenshots/1-cover.jpg — 1078×606, 85,724 bytes
- screenshots/2-rings.jpg — 1078×606, 88,218 bytes
- screenshots/3-approach.jpg — 1078×606, 79,889 bytes
- screenshots/4-title.jpg — 1078×606, 101,584 bytes

## Revision round 4 — frozen sea, smaller plane, slimmer rear (26 Nov, later)

The user played the round-3 build and complained again: the sea STILL
moved (only the plane should move), and the plane was too big with too
bulky a rear. Both fixed:

- **Sea frozen completely** (render.js drawSea): the water layer is now
  painted exactly once into an offscreen canvas and blitted every
  frame. The painting is a pure function of screen position — it reads
  no time, no frame count, no plane state, no camera — so frame-to-
  frame change in the water is impossible by construction. Verified
  with a real rasterizer (node-canvas): two frames rendered at wildly
  different sim times and plane states (t=0 at the start vs t=999.7,
  banked at altitude) have a sea-region diff of exactly **0 pixels**,
  both for the sea layer alone and for the sky+sea background stack.
  What still changes on the water is only what should: the projected
  world objects (islands, boats, lighthouse, rings, runway) and the
  plane's own shadow. The calm round-3 look (fixed gradient, haze
  band, sun-glitter wedge, static sparkle) is unchanged.
- **Plane smaller, rear slimmed** (render.js drawPlane): overall scale
  back from 1.3 to 1.0 (round 3's enlargement read as too big), and
  the rear made distinctly lighter — the tail cone below the wing
  tapers in sooner and ends higher (tip at y 35.5 instead of 42.5,
  ±9 wide instead of ±12.5), the horizontal stabilizer span is cut
  from ±47 to ±34, the fin is smaller (top -85 instead of -96), the
  floats are slightly slimmer, and the water shadow is re-tuned to
  the smaller airframe. The teal + white + orange design language,
  glossy canopy, prop disc, nav lights and the banking/pitch
  behaviour are all kept. Flight model untouched; the headless
  autopilot re-verification still completes 12/12 rings plus a
  successful landing (score 2654, 62 sim-seconds — identical to
  round 3).

All four screenshots were re-captured from the Pages build (fresh
staging path shotstage7, same scenes/seeds and crop box) and verified
visually — plane clearly smaller with a tapered rear in every frame,
sea calm and static-looking, HUD and scenes unchanged:

- screenshots/1-cover.jpg — 1078×606, 91,448 bytes
- screenshots/2-rings.jpg — 1078×606, 94,675 bytes
- screenshots/3-approach.jpg — 1078×606, 84,949 bytes
- screenshots/4-title.jpg — 1078×606, 109,950 bytes

## Files

- main.ts (95 lines) — hand-in entrypoint
- vendor/makefun-game.ts — dossier library, unchanged
- game/index.html + game/src/*.js (8 modules; game/ tree 59,787 bytes total)
- screenshots/1-cover.jpg … 4-title.jpg
- README.md, LICENSE (MIT), .gitignore

Not done here (parent's step): bundle, kit check, submit.
