// How accurate are Level Doctor's numbers? Two checks against the saved results:
// 1) repeatability: re-measure every level with fresh seeds; a fresh pass rate should fall inside the original
//    95% interval about 95% of the time if the intervals are honest;
// 2) tuning accuracy: the drop limit's predicted pass rate (from the survival curve) vs the verified one.
// usage: LD_BACKEND=local node scripts/accuracy-check.mjs   → out/accuracy.json
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runBatch } from '../src/runner.mjs'
import { wilson } from '../src/stats.mjs'

const res = JSON.parse(await readFile('out/results.json', 'utf8'))
const N = 40, P = res.player
const tasks = res.levels.flatMap(l => Array.from({ length: N }, (_, k) => ({ level: l.i, policy: P, seed: 9001 + k, tempo: res.tempo })))
const { rows, backend } = await runBatch(tasks, path.resolve(res.policiesFile || 'out/policies.mjs'), { name: 'accuracy' })
let inside = 0
const levels = res.levels.map(l => {
  const m = rows.filter(r => r.level === l.i), fresh = wilson(m.filter(r => r.win).length, m.length), orig = l.personas[P]
  const ok = fresh.p >= orig.lo - 1e-9 && fresh.p <= orig.hi + 1e-9
  if (ok) inside++
  return { name: l.name, original: +orig.p.toFixed(3), lo: +orig.lo.toFixed(3), hi: +orig.hi.toFixed(3), fresh: +fresh.p.toFixed(3), diff: +(fresh.p - orig.p).toFixed(3), inside: ok }
})
const absDiff = levels.map(l => Math.abs(l.diff)), mean = a => a.reduce((s, x) => s + x, 0) / a.length
const tuned = res.levels.filter(l => l.verify && l.tune).map(l => ({ name: l.name, predicted: +l.tune.predicted.toFixed(3), verified: +l.verify.p.toFixed(3), error: +(l.verify.p - l.tune.predicted).toFixed(3), target: +l.target.toFixed(3), offTarget: +(l.verify.p - l.target).toFixed(3) }))
const widths = res.levels.map(l => l.personas[P].hi - l.personas[P].lo)
const out = { backend, seedsPerLevel: N, repeatability: { inside, levels: levels.length, meanAbsDiff: +mean(absDiff).toFixed(3), maxAbsDiff: +Math.max(...absDiff).toFixed(3), perLevel: levels },
  intervalWidth: { mean: +mean(widths).toFixed(3), max: +Math.max(...widths).toFixed(3) },
  tuning: { levels: tuned, meanAbsError: +mean(tuned.map(t => Math.abs(t.error))).toFixed(3), meanAbsOffTarget: +mean(tuned.map(t => Math.abs(t.offTarget))).toFixed(3) } }
await writeFile('out/accuracy.json', JSON.stringify(out, null, 1))
console.log(`repeatability: fresh seeds landed inside the original 95% interval on ${inside}/${levels.length} levels; mean |diff| ${(out.repeatability.meanAbsDiff * 100).toFixed(1)} pts, max ${(out.repeatability.maxAbsDiff * 100).toFixed(0)} pts`)
for (const l of levels.filter(l => !l.inside || Math.abs(l.diff) >= 0.1)) console.log(`  ${l.name.padEnd(15)} original ${(l.original * 100).toFixed(0)}% [${(l.lo * 100).toFixed(0)}–${(l.hi * 100).toFixed(0)}] → fresh ${(l.fresh * 100).toFixed(0)}%${l.inside ? '' : '  OUTSIDE'}`)
console.log(`interval width (regular bot, n=40): mean ±${(out.intervalWidth.mean * 50).toFixed(0)} pts, widest ±${(out.intervalWidth.max * 50).toFixed(0)} pts`)
console.log(`tuning: predicted vs verified pass rate, mean |error| ${(out.tuning.meanAbsError * 100).toFixed(1)} pts; verified vs target, mean |gap| ${(out.tuning.meanAbsOffTarget * 100).toFixed(1)} pts`)
for (const t of tuned) console.log(`  ${t.name.padEnd(15)} predicted ${(t.predicted * 100).toFixed(0)}% → verified ${(t.verified * 100).toFixed(0)}% (target ${(t.target * 100).toFixed(0)}%)`)
