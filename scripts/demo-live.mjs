// Live demo in ~20 s: the LLM-written bots play one Mash Pit level inside the locked-down CreateOS sandbox,
// and the pass rates come back with 95% intervals. usage: node scripts/demo-live.mjs [level 1-20] [seeds]
import '../src/env.mjs'
import path from 'node:path'
import { getSandbox, checkIsolation, runBatch } from '../src/runner.mjs'
import { wilson } from '../src/stats.mjs'

const level = (+process.argv[2] || 7) - 1, n = +process.argv[3] || 16
const t0 = Date.now()
const sb = await getSandbox()
console.log(`CreateOS sandbox ${sb.id} ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
const iso = await checkIsolation()
console.log(`network from inside: ${iso.blocked ? 'BLOCKED ✓ (the bots are LLM-written code)' : 'open'}`)
const tasks = ['random', 'greedy', 'lookahead'].flatMap(policy => Array.from({ length: n }, (_, k) => ({ level, policy, seed: 7000 + k, tempo: 1.2 })))
const { rows, ms } = await runBatch(tasks, path.resolve('out/policies.mjs'), { name: 'demo-live' })
const name = { random: 'casual  (random)', greedy: 'regular (greedy)', lookahead: 'expert  (lookahead)' }
console.log(`\nlevel ${level + 1}: ${rows.length} playtests in the sandbox in ${(ms / 1000).toFixed(1)} s`)
for (const p of ['random', 'greedy', 'lookahead']) {
  const m = rows.filter(r => r.policy === p), w = wilson(m.filter(r => r.win).length, m.length)
  console.log(`  ${name[p].padEnd(20)} ${(w.p * 100).toFixed(0).padStart(3)}%  [${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}]  ${'█'.repeat(Math.round(w.p * 20))}`)
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`)
