// Dev tool: what does winning look like? A scripted test bot (not an LLM bot) walks to each core, holds E,
// then goes to the lift. Prints how the run ended. usage: node games/containment/objective-test.mjs [difficulty] [seed]
import { openGame, runEpisode } from './runtime.mjs'

const scripted = `{
  route: (o, rng) => {
    const left = o.cores.filter(c => !c.pulled)
    const target = left.length ? left.sort((a, b) => o.path(a.x, a.z).length - o.path(b.x, b.z).length)[0] : o.lift
    const tc = o.center(target.x, target.z)
    if (o.dist(tc.x, tc.z) < 2.2) return { yaw: o.yawTo(tc.x, tc.z), keys: ['KeyE'] }   // hold E at the core / the lift
    const p = o.path(target.x, target.z)
    const next = p.length ? o.center(p[0][0], p[0][1]) : tc
    return { yaw: o.yawTo(next.x, next.z), keys: ['KeyW'] }
  },
}`
const [difficulty = 'story', seed = '3'] = process.argv.slice(2)
const g = await openGame()
const setup = process.env.NO_WARDEN ? 'g.warden.disabledFor = 1e9' : ''   // dev only: see the win flow without the hunter
const r = await runEpisode(g.page, { policySrc: scripted, policy: 'route', seed: +seed, difficulty, maxTime: 400, decide: 0.1, trace: true, setup })
const f = r.frames
console.log(JSON.stringify({ ...r, frames: undefined }))
console.log('path samples (t, px, pz, wx, wz, warden):', f.filter((_, i) => i % 100 === 0).map(x => x.join(',')).join(' | '))
const hud = await g.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))
console.log('HUD at end:', hud)
await g.close()
