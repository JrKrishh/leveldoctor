// Dev tool: profile a step while the warden is chasing (after a run that left it hunting).
import { openGame, runEpisode, freshCheckpoint } from './runtime.mjs'

const bots = `{ wander: (o, rng) => ({ yaw: o.t % 2 < 0.21 ? rng() * Math.PI * 2 : undefined, keys: ['KeyW'] }) }`
const g = await openGame()
for (let i = 0; i < 2; i++) await runEpisode(g.page, { policySrc: bots, policy: 'wander', seed: 7, maxTime: 30 })
const r = await g.page.evaluate(cp => {
  const G = window.__game
  G.begin('normal', cp)
  const J = G.warden, w = G.world
  const timers = {}
  const wrap = (obj, name, label) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t0 = performance.now(); const v = f(...a); timers[label] = (timers[label] || 0) + performance.now() - t0; return v } }
  wrap(J, 'update', 'warden.update'); wrap(w, 'update', 'world.update')
  const sfx = G.sfx
  for (const k of Object.keys(sfx)) if (typeof sfx[k] === 'function') wrap(sfx, k, 'sfx.' + k)
  const t0 = performance.now()
  G.step(5)
  const total = performance.now() - t0
  return { mode: G.mode, warden: J.state, totalMs: +total.toFixed(1), timers: Object.fromEntries(Object.entries(timers).map(([k, v]) => [k, +v.toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 12)) }
}, freshCheckpoint('normal'))
console.log(JSON.stringify(r, null, 1))
await g.close()
