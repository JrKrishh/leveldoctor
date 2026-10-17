// Gate 1: the same seed must give a byte-identical run, in any order; one run must take under a second.
import { runLevel, G } from '../src/runtime.mjs'

const random = (o, rng) => o.left + o.radius[o.cur] + rng() * (o.right - o.left - 2 * o.radius[o.cur])
const levels = [0, 3, 6, 8, 12]
const a = levels.map(i => runLevel(i, random, { seed: 42 }))
const b = [...levels].reverse().map(i => runLevel(i, random, { seed: 42 })).reverse()
let ok = true
for (let k = 0; k < levels.length; k++) {
  const same = a[k].hash === b[k].hash && a[k].drops === b[k].drops && a[k].win === b[k].win
  ok &&= same
  console.log(`L${levels[k] + 1} ${G.LEVELS[levels[k]].name.padEnd(15)} ${a[k].reason.padEnd(12)} drops=${a[k].drops} t=${a[k].time}s  ${same ? 'IDENTICAL' : 'DIFFERENT ' + a[k].hash + ' vs ' + b[k].hash}`)
}
const t0 = performance.now(); let n = 0
for (let s = 1; s <= 20; s++) { runLevel(6, random, { seed: s }); n++ }
console.log(`speed: ${((performance.now() - t0) / n).toFixed(1)} ms per run (Tight Squeeze, tempo 1.2 s)`)
console.log(ok ? 'DETERMINISM: PASS' : 'DETERMINISM: FAIL')
process.exit(ok ? 0 : 1)
