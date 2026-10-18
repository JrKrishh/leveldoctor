// Dev tool: how long does one simulated second take, and what dominates it?
import { openGame, freshCheckpoint } from './runtime.mjs'

const g = await openGame()
const r = await g.page.evaluate(async cp => {
  const G = window.__game
  G.begin('normal', cp)
  const time = (label, fn) => { const t0 = performance.now(); fn(); return [label, +(performance.now() - t0).toFixed(1)] }
  const out = []
  out.push(time('step(5) idle', () => G.step(5)))
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
  out.push(time('step(5) walking', () => G.step(5)))
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))
  // how much is the warden's update?
  const J = G.warden, upd = J.update.bind(J)
  let wardenMs = 0
  J.update = (...a) => { const t0 = performance.now(); const v = upd(...a); wardenMs += performance.now() - t0; return v }
  out.push(time('step(5) with warden timing', () => G.step(5)))
  out.push(['  of which warden.update', +wardenMs.toFixed(1)])
  J.update = upd
  const w = G.world, wupd = w.update.bind(w)
  let worldMs = 0
  w.update = (...a) => { const t0 = performance.now(); const v = wupd(...a); worldMs += performance.now() - t0; return v }
  out.push(time('step(5) with world timing', () => G.step(5)))
  out.push(['  of which world.update', +worldMs.toFixed(1)])
  w.update = wupd
  return { mode: G.mode, out }
}, freshCheckpoint('normal'))
console.log(JSON.stringify(r, null, 1))
await g.close()
