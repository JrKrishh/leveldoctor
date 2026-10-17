# 🩺 Level Doctor

**An AI agent that writes its own bot players, playtests your web game thousands of times inside a CreateOS sandbox, finds out *why* players lose, and re-tunes your levels with error bars on every number.**

Built for the CreateOS × Stripe Projects hackathon (Oct 18, 2026). Demo subject: [Mash Pit](https://w.run/boopathiraja/mash-pit), my own 20-level physics merge game, live in a game jam with real players. Tuning its levels by hand took three rounds of guessing. Level Doctor replaces that with measurement.

## The problem

Small game teams tune difficulty by feel. Existing playtesting tools either play in real time (a few runs, no statistics), need an engine plugin, or need ML training. Nobody gives an indie web game **statistically sound difficulty numbers, a diagnosis, and a verified fix** in minutes.

## How it works

```
LLM (Nebius Token Factory / OpenRouter)
  │ 1. reads the game's rules + observation API
  │ 2. WRITES three bot players as JavaScript: casual (random) → regular (greedy) → expert (lookahead)
  ▼
CreateOS sandbox (devbox:1, network locked down: the LLM's code can't reach anything)
  │ 3. runs the REAL game code headless with a virtual clock: ~0.16 s per level, byte-identical replays
  │ 4. thousands of seeded playtests → JSONL
  ▼
Agent loop
  │ 5. skill check: casual < regular < expert on 7 test levels covering every goal type;
  │    crashes and broken bots go back to the LLM, which rewrites its code until they pass
  ▼
Statistics (deterministic, no LLM)
  │ 6. pass rate per level × bot with Wilson 95% intervals
  │ 7. Chaos Ratio, twist exposure, survival-curve tuning (below)
  ▼
Patch → verify with fresh seeds → report page served from the sandbox's live URL → fixed build (a copy)
```

## What's new here

- **Chaos Ratio.** Replay a run with one drop nudged by 0.0001 units (far below a pixel). C = flip rate ÷ 2p(1−p). **C ≈ 1: losses are dice rolls** a designer can only soften. **C ≈ 0: losses are reproducible traps** a designer can find and fix. Pass rate alone can't tell these apart. On Mash Pit, *Tight Squeeze* (C ≈ 1.2) and *Frozen Friends* (C = 0.00) have similar pass rates and completely different problems.
- **Twist exposure.** Each run is paired with a copy where one twist is switched off (same seeds); identical pairs mean the twist never mattered. A bot playing at typical bot speed clears *Bass Drop!* before the first bass drop arrives: it reports the level is fine without ever hearing its twist (5% of runs exposed vs 100% at human tempo). Level Doctor's bots play at a human 1.2 s per drop.
- **One-batch drop-limit tuning.** Play once with unlimited drops, read the pass rate for *every* possible limit straight off the survival curve, pick the limit that hits the target, then verify it with fresh seeds.
- **Error bars everywhere.** Every pass rate carries a 95% interval; patches count as verified only when the interval reaches the target band.
- **Churn funnel.** A mixed population (40% casual × 3 tries, 40% regular × 5, 20% expert × 8) shows where players would quit, before vs after.

## Not tied to one game: ORBITAL

The same agent also runs on **ORBITAL**, an endless arcade game (circle a star, tap to reverse, dodge debris), a different genre with no levels at all. `games/orbital/` is the whole adapter: the game's difficulty constants become tunable at load time, bots see the game 0.2 s late (human reaction time), and the "level pass rate" becomes "reaches 20 seconds". The LLM writes three new bots, the agent checks they rank by skill *and* actually play (a "skilled" bot that never taps gets sent back), then measures survival curves and the Chaos Ratio, and tunes how fast debris spawns accelerate so a regular player reaches 20 s half the time, verified with fresh seeds.

```bash
node games/orbital/run.mjs   # bots → survival curves → chaos → tune SPAWN_RAMP → verify → out/orbital-results.json
```

## How Stripe Projects and CreateOS Sandbox are used

- **Stripe Projects** sets up the stack from the CLI: `stripe projects init`, `stripe projects add createos/project` (and `openrouter/api`), `stripe projects env --pull` puts the credentials in `.env`.
- **CreateOS Sandbox** (`@nodeops-createos/sandbox`) runs every batch: one reused `devbox:1` sandbox, **egress locked down** (the bots are LLM-written code; `scripts/sandbox-check.mjs` proves an outbound request fails), auto-pause between batches, and **ingress** to serve the report from the sandbox's public URL.

## Run it

```bash
npm install
node src/bundle.mjs                 # bundle the game headless (GAME_SRC=path/to/game/src/main.js)
node scripts/check-determinism.mjs  # gate: same seed → identical run
node scripts/write-bots.mjs         # the agent writes + fixes its bots (needs NEBIUS_API_KEY or OPENROUTER_API_KEY, else local Ollama)
node scripts/run-doctor.mjs         # full diagnosis → out/results.json
node report/build.mjs               # report → report/dist/index.html
node scripts/ship-fixed.mjs         # verified patch applied to a COPY of the game, built
```

Backend: the CreateOS sandbox when `CREATEOS_SANDBOX_API_KEY` is set, otherwise local worker processes running the same `src/batch.mjs` (every result row records where it ran).

## Tech

Node 24 · esbuild · matter-js (the game's own physics, bundled unmodified) · CreateOS Sandbox SDK · Stripe Projects CLI · Nebius Token Factory (Qwen3-235B) / OpenRouter · Playwright + ffmpeg + edge-tts for the demo video.

## Honest limits

- The target curve is a designer choice (95% → 60% for a regular player); calibrate it against real analytics before applying a patch to a live game.
- Bots are only as good as the code the LLM writes; the skill check catches broken bots, not subtly unhuman ones.
- Mash Pit's source is not in this repo: it's the input, a separate live game. All Level Doctor code was written during the hackathon.
