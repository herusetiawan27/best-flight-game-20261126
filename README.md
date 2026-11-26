[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/herusetiawan27/best-flight-game-20261126/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/herusetiawan27/best-flight-game-20261126/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

# Golden Strait Run

A golden-hour seaplane flight through glowing target rings over a tropical
archipelago strait — turquoise sea, green islands with sandy beaches, a
lighthouse, boats, and a coastal runway waiting at the end of the course.

Built for the make.fun bounty
[best-flight-game-20261126-0057](https://make.fun/bounty/best-flight-game-20261126-0057).

## The game

You fly a seaplane over the strait at golden hour. Thread the 12 glowing
golden rings in order — chain them quickly to build a combo (the chime
climbs in pitch and the score multiplies) — then bring her home: line up
with the runway on the coast island and touch down gently. Too fast, too
steep, or into the sea ends the run. Landings are rated PERFECT / GOOD /
ROUGH, and every run is scored against the clock for a Bronze, Silver or
Gold medal. Your best score is kept in the browser.

The flight model is a proper little arcade sim: inputs drive smoothed
angular velocity (never instant rotation), banking rolls the plane into
the turn, speed trades against climb, and she stalls gently if you get
slow. The chase camera lags behind the plane on springs, the view widens
as you open the throttle, and C switches between chase, cockpit and a
slow orbit camera.

The world is alive: a big low sun with a golden glitter path on the
water, drifting clouds, cliff islets, bobbing boats and wheeling birds.
Passing a ring bursts into sparks with a floating score popup; skimming
the water throws spray and ripples; your wingtips trail contrails at
speed. The view carries a lit instrument cluster (artificial horizon,
altimeter, airspeed), a HUD with altitude, speed and heading, ring
progress pips and a mini-compass. Engine, wind, water and a relaxed
ambient pad are synthesised live with WebAudio — no audio files.

## Difficulty

Pick on the title screen (keys 1 / 2 / 3, or tap a pill):

| Difficulty | Rings | Assist | Landing judge |
| --- | --- | --- | --- |
| Santai | Bigger | Strong auto-level | Lenient |
| Normal | Standard | Standard | Standard |
| Pro | Smaller | Weak | Tight alignment & sink |

## Controls

| Input | Action |
| --- | --- |
| Arrow Up / Down | Pitch |
| Arrow Left / Right, A / D | Roll / turn |
| W / S | Throttle up / down |
| Mouse move | Steer toward the pointer |
| C | Camera: chase / cockpit / orbit |
| T | Autopilot demo (logs its result to the console) |
| 1 / 2 / 3 | Difficulty: Santai / Normal / Pro |
| Enter / click | Start / "Coba lagi" |
| R | Restart instantly |
| P | Pause |
| M | Mute |
| Touch | Left thumb: virtual stick · right thumb: throttle slider |

## Run it

The game is plain static files — no build step, no network. Serve the `game/`
folder with any static server and open it in a desktop browser, e.g.:

```sh
npx serve game
# or
python3 -m http.server -d game 8000
```

Then open the printed URL. It also runs from GitHub Pages (see the repo's
Pages site, under `/game/`).

Deterministic screenshot scenes are built in: open
`game/index.html?shot=cover&seed=7` (also `rings`, `approach`, `title`) and
the game renders one fixed, reproducible frame — that is how the images in
`screenshots/` were captured.

## Hand it in

```sh
node main.ts
```

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
into `MAKEFUN_OUTPUT_DIR` (default `/output`) and writes `dossier.json` there
using `buildDossier` from `vendor/makefun-game.ts`.

## Files

- `main.ts` — entrypoint: assembles the hand-in and writes `dossier.json`
- `vendor/makefun-game.ts` — make.fun dossier library (vendored, unchanged)
- `game/` — the game: `index.html` + ES modules under `game/src/`
  (`config`, `physics`, `camera`, `effects`, `audio`, `ui`, `input`,
  `world`, `render`, `shots`, `random`, `main`)
- `screenshots/` — four real renders of the game (the first is the cover)
- `LICENSE` — MIT
