// Gate 2: a batch through the runner gives the same results as running the levels directly in this process.
import { runBatch } from '../src/runner.mjs'
import { runLevel } from '../src/runtime.mjs'
import policies from '../test/baseline-policies.mjs'

const tasks = []
for (const level of [0, 6, 12]) for (let seed = 1; seed <= 8; seed++) tasks.push({ level, policy: 'random', seed, tempo: 1.2 })
const { rows, backend, ms } = await runBatch(tasks, new URL('../test/baseline-policies.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), { name: 'check' })
let same = 0
for (const t of tasks.slice(0, 8)) {
  const direct = runLevel(t.level, policies.random, { seed: t.seed, tempo: t.tempo })
  const r = rows.find(r => r.level === t.level && r.seed === t.seed)
  if (r && r.hash === direct.hash) same++
}
console.log(`${backend}: ${rows.length}/${tasks.length} runs in ${ms} ms; wins ${rows.filter(r => r.win).length}; batch == direct on ${same}/8`)
process.exit(rows.length === tasks.length && same === 8 ? 0 : 1)
