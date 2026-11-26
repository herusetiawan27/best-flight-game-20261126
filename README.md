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

You fly a seaplane in a chase view over the strait at golden hour. Thread the
12 glowing golden rings in order — each one you catch scores points and buys
time — then bring her home: line up with the runway on the coast island and
touch down gently. Too fast, too steep, or into the sea ends the run.

The view carries a lit instrument cluster (artificial horizon, altimeter,
airspeed) and a HUD with altitude, speed and heading, so it flies like a real
approach, not an arcade float. Engine hum, ring chimes and the touchdown call
are synthesised live with WebAudio — no audio files.

## Controls

| Input | Action |
| --- | --- |
| Arrow Up / Down | Pitch |
| Arrow Left / Right, A / D | Roll / turn |
| W / S | Throttle up / down |
| Mouse move | Steer toward the pointer |
| Enter / click | Start |
| R | Restart |
| P | Pause |
| M | Mute |

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
- `screenshots/` — four real renders of the game (the first is the cover)
- `LICENSE` — MIT
