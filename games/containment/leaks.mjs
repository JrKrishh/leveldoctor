// Dev tool: what grows between runs? Measures array/object sizes reachable from __game after each run.
import { openGame, runEpisode } from './runtime.mjs'

const bots = `{ wander: (o, rng) => ({ yaw: o.t % 2 < 0.21 ? rng() * Math.PI * 2 : undefined, keys: ['KeyW'] }) }`
const g = await openGame()
const sizes = () => g.page.evaluate(() => {
  const out = {}, seen = new Set()
  const walk = (o, p, d) => {
    if (!o || typeof o !== 'object' || seen.has(o) || d > 3) return
    seen.add(o)
    if (Array.isArray(o)) { if (o.length > 5) out[p] = o.length }
    else if (o instanceof Map || o instanceof Set) { if (o.size > 5) out[p] = o.size }
    if (o.isObject3D) { out[p + '.children'] = o.children.length; return }
    for (const k of Object.keys(o).slice(0, 60)) { try { walk(o[k], p + '.' + k, d + 1) } catch { } }
  }
  walk(window.__game, 'g', 0)
  out['scene.objects'] = (() => { let n = 0; let s = window.__game.camera; while (s.parent) s = s.parent; s.traverse(() => n++); return n })()
  return out
})
const before = await sizes()
for (let i = 1; i <= 3; i++) {
  const r = await runEpisode(g.page, { policySrc: bots, policy: 'wander', seed: 7, maxTime: 30 })
  const now = await sizes()
  const grew = Object.entries(now).filter(([k, v]) => v !== before[k]).map(([k, v]) => `${k}: ${before[k] ?? 0} → ${v}`)
  console.log(`after run ${i} (loop ${r.loopMs} ms, warden ${r.wstate}):`, grew.join(' · ') || 'no change')
}
await g.close()
