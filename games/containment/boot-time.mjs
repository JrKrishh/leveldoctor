// Dev check: how long does a boot and a reboot take, and does a run still work and stay deterministic?
import { openGame, runEpisode } from './runtime.mjs'

const bots = `{ wander: (o, rng) => ({ yaw: o.t % 2 < 0.21 ? rng() * Math.PI * 2 : undefined, keys: ['KeyW'] }) }`
let t = Date.now()
const g = await openGame()
console.log(`boot ${((Date.now() - t) / 1000).toFixed(1)} s, errors: ${g.errors.length ? g.errors.join(' | ').slice(0, 200) : 'none'}`)
const a = await runEpisode(g.page, { policySrc: bots, policy: 'wander', seed: 7, maxTime: 60 })
for (let i = 0; i < 2; i++) { t = Date.now(); await g.reboot(); console.log(`reboot ${((Date.now() - t) / 1000).toFixed(1)} s`) }
const b = await runEpisode(g.page, { policySrc: bots, policy: 'wander', seed: 7, maxTime: 60 })
console.log(`run: loop ${a.loopMs} ms / ${b.loopMs} ms; same seed identical: ${a.px === b.px && a.pz === b.pz && a.mode === b.mode}`)
await g.close()
