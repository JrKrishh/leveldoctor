// Second test subject: ORBITAL, an endless arcade game (circle a star, tap to reverse, dodge debris).
// Same approach as Mash Pit: the real game source runs headless with a virtual clock and seeded randomness.
// The difficulty constants are turned into tunable variables at load time; nothing else in the game changes.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import { mulberry } from '../../src/random.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = process.env.ORBITAL_SRC || path.resolve(here, '../../../orbital/src/main.js')
const OUT = path.resolve(here, '../../build/orbital.bundle.mjs')
export const KNOBS = ['BASE_SPIN', 'SPIN_RAMP', 'SPAWN_START', 'SPAWN_MIN', 'SPAWN_RAMP', 'DEBRIS_SPEED']

export async function bundle() {
  let src = await readFile(SRC, 'utf8')
  for (const k of KNOBS) { const re = new RegExp(`const ${k} = `); if (!re.test(src)) throw new Error(`knob ${k} not found`); src = src.replace(re, `let ${k} = `) }
  src += `
globalThis.__orb = {
  start, update, tap, PLAYER_R, DEBRIS_R,
  get s() { return { state, angle, dir, spin, score, elapsed, cx, cy, orbitR, W, H, debris } },
  knobs: () => ({ ${KNOBS.join(', ')} }),
  configure: o => { ${KNOBS.map(k => `if (o.${k} != null) ${k} = o.${k}`).join('; ')} },
  reset: () => { particles.length = 0; trail.length = 0; shake = 0 },
}
`
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, src)
  return OUT
}

// ---------- browser stubs ----------
const el = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? h => (h === 'number' ? 0 : '') : k === 'then' ? undefined : el, set: () => true, apply: () => el, construct: () => el })
Object.assign(globalThis, {
  window: globalThis, innerWidth: 400, innerHeight: 800, devicePixelRatio: 1,
  document: { getElementById: () => el, querySelector: () => el, createElement: () => el },
  localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: () => {}, requestAnimationFrame: () => 0,
})

if (existsSync(SRC)) await bundle()   // inside the sandbox only the prebuilt bundle exists
await import(pathToFileURL(OUT).href)
export const O = globalThis.__orb
export const BASE_KNOBS = O.knobs()
const DT = 1 / 60

function observe() {
  const s = O.s
  const px = s.cx + Math.cos(s.angle) * s.orbitR, py = s.cy + Math.sin(s.angle) * s.orbitR
  return { angle: s.angle, dir: s.dir, spin: s.spin, orbitR: s.orbitR, cx: s.cx, cy: s.cy, player: { x: px, y: py, r: O.PLAYER_R }, debrisR: O.DEBRIS_R,
    debris: s.debris.map(d => ({ x: d.x, y: d.y, vx: d.vx, vy: d.vy })), time: s.elapsed, score: s.score }
}

/**
 * One episode. The bot decides every `every` seconds whether to tap (reverse), but sees the game as it was
 * `reaction` seconds ago, like a human. Returns survival time and score.
 */
export function runEpisode(policy, { seed = 1, reaction = 0.2, every = 0.05, maxTime = 180, knobs, nudge } = {}) {
  O.configure({ ...BASE_KNOBS, ...(knobs || {}) })
  O.reset()
  Math.random = mulberry(seed * 2654435761)
  const rng = mulberry(seed * 40503 + 17)
  O.start()
  const history = [], lag = Math.round(reaction / DT), stride = Math.max(1, Math.round(every / DT))
  let steps = 0, taps = 0, err = null, nudged = false
  while (O.s.state === 'playing' && O.s.elapsed < maxTime) {
    if (nudge && !nudged && O.s.elapsed >= nudge.t) { O.update(nudge.dt); nudged = true }   // shift the whole timeline by nudge.dt once
    history.push(observe()); if (history.length > lag + 1) history.shift()
    if (steps % stride === 0 && history.length > lag) {
      let tap
      try { tap = policy(history[0], rng) } catch (e) { err = String(e?.message || e); break }
      if (tap) { O.tap(); taps++ }
    }
    O.update(DT); steps++
  }
  const s = O.s
  return { seed, time: +s.elapsed.toFixed(2), score: s.score, died: s.state === 'dead', taps, reason: err ? 'error' : s.state === 'dead' ? 'hit' : 'survived', ...(err ? { error: err } : {}) }
}
