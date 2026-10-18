// Dev tool: does a New Game start (begin without checkpoint, then skip the film/intro with Space) reset the warden?
import { openGame, runEpisode } from './runtime.mjs'

const bots = `{ wander: (o, rng) => ({ yaw: o.t % 2 < 0.21 ? rng() * Math.PI * 2 : undefined, keys: ['KeyW'] }) }`
const g = await openGame()
const wardenNow = () => g.page.evaluate(() => { const J = window.__game.warden; return { mode: window.__game.mode, state: J.state, t: +J.t.toFixed(2), x: +J.group.position.x.toFixed(2), z: +J.group.position.z.toFixed(2), sus: +J.suspicion.toFixed(2), px: window.__game.player.x, pz: window.__game.player.z } })
console.log('fresh page:', JSON.stringify(await wardenNow()))
const r1 = await runEpisode(g.page, { policySrc: bots, policy: 'wander', seed: 7, maxTime: 40 })
console.log('after run 1:', r1.mode, r1.wstate, JSON.stringify(await wardenNow()))
const newGame = await g.page.evaluate(async () => {
  const G = window.__game, log = []
  G.begin('normal')
  log.push(G.mode)
  for (let i = 0; i < 8 && G.mode !== 'play'; i++) { G.press('Space'); await new Promise(r => setTimeout(r, 50)); log.push(G.mode) }
  return log
})
console.log('new game modes:', newGame.join(' → '))
console.log('after new game:', JSON.stringify(await wardenNow()))
await g.close()
