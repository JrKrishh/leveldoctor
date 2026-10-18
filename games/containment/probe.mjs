// Gate for CONTAINMENT: the game boots headless with analytics blocked, a run starts in play mode, inputs move the
// player, and the same seed + same inputs give the same run. Test bot only (walks forward, turns at random).
import { openGame, runEpisode } from './runtime.mjs'

const probeBots = `{
  wander: (o, rng) => ({ yaw: o.t % 2 < 0.21 ? rng() * Math.PI * 2 : undefined, keys: ['KeyW'] }),
}`
const t0 = Date.now()
const g = await openGame()
console.log(`booted in ${((Date.now() - t0) / 1000).toFixed(1)} s; blocked ${g.blocked.length} analytics/ads requests; page errors: ${g.errors.length ? g.errors.join(' | ').slice(0, 300) : 'none'}`)
const info = await g.page.evaluate(() => ({ mode: window.__game.mode, floor: window.__game.floor, w: window.__game.level.w, h: window.__game.level.h }))
console.log('before run:', JSON.stringify(info))
const a = await runEpisode(g.page, { policySrc: probeBots, policy: 'wander', seed: 7, maxTime: 60 })
let tr = Date.now(); await g.reboot(); console.log(`reboot (cached files): ${((Date.now() - tr) / 1000).toFixed(1)} s`)
const b = await runEpisode(g.page, { policySrc: probeBots, policy: 'wander', seed: 7, maxTime: 60 })
await g.reboot()
const c = await runEpisode(g.page, { policySrc: probeBots, policy: 'wander', seed: 8, maxTime: 60 })
await g.reboot()
console.log('run A', JSON.stringify(a))
console.log('run B', JSON.stringify(b))
console.log('run C (other seed)', JSON.stringify(c))
const same = a.px === b.px && a.pz === b.pz && a.time === b.time && a.mode === b.mode
console.log(same ? 'DETERMINISM: same seed → identical run ✓' : 'DETERMINISM: runs differ ✗')
const t1 = Date.now(); await runEpisode(g.page, { policySrc: probeBots, policy: 'wander', seed: 9, maxTime: 60 })
console.log(`speed: 60 s of game time in ${((Date.now() - t1) / 1000).toFixed(2)} s`)
await g.close()
