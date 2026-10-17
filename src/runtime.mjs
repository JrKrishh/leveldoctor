// Headless runtime: runs the real game code in Node with a virtual clock. No rendering, no audio, no DOM:
// just the game's own update(1/60) driven step by step, a seeded Math.random, and a bot that acts at a set tempo.
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

// ---------- browser stubs (enough for the game to boot; drawing calls go nowhere) ----------
const el = new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? hint => (hint === 'number' ? 0 : '') : k === 'then' ? undefined : el,
  set: () => true,
  apply: () => el,
  construct: () => el,
})
class FakeAudio { constructor() { this.paused = true; this.currentTime = 0 } play() { return Promise.resolve() } pause() {} cloneNode() { return new FakeAudio() } }
class FakeImage { set src(_) { queueMicrotask(() => this.onerror?.()) } }
Object.assign(globalThis, {
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [], createElement: () => el },
  Image: FakeImage, Audio: FakeAudio, devicePixelRatio: 1,
  addEventListener: () => {}, requestAnimationFrame: () => 0, window: globalThis,
})
try { globalThis.navigator ??= {} } catch { }

// ---------- seeded random streams ----------
export function mulberry(seed) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = process.env.GAME_BUNDLE || path.resolve(here, '../build/game.bundle.mjs')
await import(pathToFileURL(BUNDLE).href)
await new Promise(r => setTimeout(r, 0))   // let boot() settle its awaits
export const G = globalThis.__ld
if (!G) throw new Error('game hook missing: rebuild the bundle')
export const BASE_LEVELS = JSON.parse(JSON.stringify(G.LEVELS))

const DT = 1 / 60

// What a bot sees: the same information a player sees on screen.
export function observe() {
  const s = G.s, L = G.LEVELS[s.level], radius = G.TIERS.map(t => t.r)
  const mons = [...G.mons].map(m => ({ tier: m.tier, x: m.b.position.x, y: m.b.position.y, ice: m.ice }))
  const gifts = [...G.gifts].map(g => ({ x: g.b.position.x, y: g.b.position.y }))
  const clampX = (x, tier = s.cur) => Math.max(s.LEFT + radius[tier] + 1, Math.min(s.RIGHT - radius[tier] - 1, x))
  // Where a monster dropped at x would first touch the pile (what the in-game aim guide shows a player).
  const landY = (x, tier = s.cur) => {
    const r = radius[tier], cx = clampX(x, tier)
    let y = G.FLOOR - r
    for (const o of [...mons.map(m => ({ x: m.x, y: m.y, r: radius[m.tier] })), ...gifts.map(g => ({ x: g.x, y: g.y, r: 24 }))]) {
      const d = r + o.r, dx = Math.abs(o.x - cx)
      if (dx < d) y = Math.min(y, o.y - Math.sqrt(d * d - dx * dx))
    }
    return y
  }
  return {
    cur: s.cur, next: s.mods.fog ? null : s.nxt, dropsLeft: s.dropsLeft, score: s.score, time: s.clockT,
    left: s.LEFT, right: s.RIGHT, lineY: G.LINE, floorY: G.FLOOR, dropY: G.DROP_Y,
    radius, goal: L.goal, mods: s.mods, progress: { highestTier: s.highestTier, mashed: s.mashed },
    mons, gifts, clampX, landY,
  }
}

function stateHash() {   // fingerprint of the final pit, to prove two runs were identical
  let h = 2166136261
  const add = v => { h ^= Math.round(v * 1e6) | 0; h = Math.imul(h, 16777619) >>> 0 }
  for (const m of G.mons) { add(m.tier); add(m.b.position.x); add(m.b.position.y) }
  add(G.s.score)
  return h.toString(16)
}

/**
 * Play one level once.
 * @param {number} levelIdx
 * @param {(obs, rng) => number} policy  returns the x to drop at
 * @param {object} o  seed, tempo (s between drops), level (config override), nudge {at, dx}, maxTime (s), trace
 */
export function runLevel(levelIdx, policy, o = {}) {
  const { seed = 1, tempo = 1.2, level, nudge, maxTime = 600, trace = false } = o
  G.LEVELS[levelIdx] = level ? JSON.parse(JSON.stringify(level)) : JSON.parse(JSON.stringify(BASE_LEVELS[levelIdx]))
  G.Matter.Common._nextId = 0
  G.Matter.Pairs.clear(G.engine.pairs)
  G.engine.timing.timestamp = 0
  G.reset()
  Math.random = mulberry(seed * 2654435761)
  const botRng = mulberry(seed * 40503 + 17)
  G.startLevel(levelIdx)
  const frames = []
  let drops = 0, sinceDrop = tempo, steps = 0, err = null, firstDropAt = null
  const xs = []
  while (G.s.state === 'play' && G.s.clockT < maxTime) {
    if (sinceDrop >= tempo && G.s.dropCd <= 0 && G.s.dropsLeft > 0) {
      let x
      try { x = +policy(observe(), botRng) } catch (e) { err = String(e?.message || e); break }
      if (!Number.isFinite(x)) { err = `policy returned ${x}`; break }
      if (nudge && drops === nudge.at) x += nudge.dx
      G.setAim(x); G.drop(); drops++; sinceDrop = 0; xs.push(x)
      firstDropAt ??= G.s.clockT
    }
    G.update(DT); steps++; sinceDrop += DT
    if (trace && steps % 6 === 0) frames.push(snapshot())
  }
  const s = G.s, [goalMet] = G.goalProgress()
  const r = {
    level: levelIdx, seed, win: s.state === 'over' && goalMet, drops, dropsLeft: s.dropsLeft, time: +s.clockT.toFixed(2),
    score: s.score, highestTier: s.highestTier, reason: err ? 'error' : s.state === 'play' ? 'timeout' : goalMet ? 'goal' : s.dropsLeft <= 0 ? 'out_of_drops' : 'overflow',
    hash: stateHash(),
    // diagnostics the agent feeds back to the LLM: how varied the drops were, and how much of the goal was left
    xsd: xs.length > 1 ? +Math.sqrt(xs.reduce((a, x) => a + (x - xs.reduce((p, q) => p + q, 0) / xs.length) ** 2, 0) / xs.length).toFixed(1) : 0,
    iceLeft: [...G.mons].filter(m => m.ice).length, giftsLeft: G.gifts.size, mashed: s.mashed,
  }
  if (err) r.error = err
  if (trace) r.frames = frames
  return r
}

function snapshot() {
  const s = G.s
  return { t: +s.clockT.toFixed(2), l: s.LEFT, r: s.RIGHT, sc: s.score, d: s.dropsLeft,
    m: [...G.mons].map(m => [m.tier, Math.round(m.b.position.x), Math.round(m.b.position.y), +m.b.angle.toFixed(2), m.ice ? 1 : 0]),
    g: [...G.gifts].map(g => [Math.round(g.b.position.x), Math.round(g.b.position.y), +g.b.angle.toFixed(2)]) }
}
