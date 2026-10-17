// Gate for the second game: deterministic episodes, and skill visible in survival time. Test bots only.
import { runEpisode } from '../games/orbital/runtime.mjs'

const never = () => false
const random = (o, rng) => rng() < 0.03
const dodge = o => {   // tap if some debris will pass near our position within 0.6 s
  const ahead = o.angle + o.dir * o.spin * 0.25, px = o.cx + Math.cos(ahead) * o.orbitR, py = o.cy + Math.sin(ahead) * o.orbitR
  return o.debris.some(d => { for (let t = 0; t < 0.6; t += 0.05) if (Math.hypot(d.x + d.vx * t - px, d.y + d.vy * t - py) < 30) return true; return false })
}
const a = runEpisode(dodge, { seed: 7 }), b = runEpisode(dodge, { seed: 7 })
console.log('determinism:', a.time === b.time && a.score === b.score && a.taps === b.taps ? 'IDENTICAL' : `DIFFERENT ${JSON.stringify(a)} ${JSON.stringify(b)}`)
const t0 = performance.now()
for (const [name, p] of Object.entries({ never, random, dodge })) {
  const rs = Array.from({ length: 20 }, (_, k) => runEpisode(p, { seed: k + 1 }))
  const ts = rs.map(r => r.time).sort((x, y) => x - y)
  console.log(`${name.padEnd(7)} median survival ${ts[10].toFixed(1)} s  (p25 ${ts[5].toFixed(1)}, p75 ${ts[15].toFixed(1)})  mean score ${(rs.reduce((s, r) => s + r.score, 0) / 20).toFixed(1)}`)
}
console.log(`${((performance.now() - t0) / 60).toFixed(0)} ms per episode`)
