// Dev check: playtests per minute with parallel browsers (scripted test bot, warden on).
import { runContainment } from './batch.mjs'

const scripted = `{
  route: (o, rng) => {
    const left = o.cores.filter(c => !c.pulled)
    const target = left.length ? left.sort((a, b) => o.path(a.x, a.z).length - o.path(b.x, b.z).length)[0] : o.lift
    const tc = o.center(target.x, target.z)
    if (o.dist(tc.x, tc.z) < 2.2) return { yaw: o.yawTo(tc.x, tc.z), keys: ['KeyE'] }
    const p = o.path(target.x, target.z), next = p.length ? o.center(p[0][0], p[0][1]) : tc
    return { yaw: o.yawTo(next.x, next.z), keys: ['KeyW'] }
  },
}`
const tasks = ['story', 'normal'].flatMap(difficulty => [1, 2, 3, 4].map(seed => ({ policy: 'route', seed, difficulty })))
const t0 = Date.now()
const rows = await runContainment(tasks, scripted, { workers: +process.env.WORKERS || 4, onProgress: (d, n, r) => console.log(`  ${d}/${n} ${r.difficulty} seed ${r.seed}: ${r.mode} at ${r.time}s, cores ${r.cores}${r.error ? ' ERR ' + r.error : ''}`) })
const min = (Date.now() - t0) / 60000
console.log(`${rows.length} playtests in ${min.toFixed(1)} min → ${(rows.length / min).toFixed(1)} per minute`)
