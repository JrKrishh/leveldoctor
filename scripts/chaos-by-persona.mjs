// The Chaos Ratio for the expert bot too, on the same seeds as the regular bot's: does a level's luck depend on
// how you play it? usage: node scripts/chaos-by-persona.mjs [results.json]  → out/chaos-personas.json
import '../src/env.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runBatch } from '../src/runner.mjs'
import { chaosRatio } from '../src/stats.mjs'

const res = JSON.parse(await readFile(path.join('out', process.argv[2] || 'results.json'), 'utf8'))
const POLICY = 'lookahead', N = 30, seeds = Array.from({ length: N }, (_, k) => 1001 + k)   // same seeds as the main run's chaos pairs
const tasks = res.levels.flatMap(l => seeds.flatMap(seed => [
  { level: l.i, policy: POLICY, seed, tempo: res.tempo, tag: 'a' },
  { level: l.i, policy: POLICY, seed, tempo: res.tempo, tag: 'b', nudge: { at: 3, dx: 1e-4 } }]))
const { rows, backend, ms } = await runBatch(tasks, path.resolve(res.policiesFile || 'out/policies.mjs'), { name: 'chaos-expert' })
const out = { policy: POLICY, backend, runs: rows.length, levels: {} }
for (const l of res.levels) {
  const m = rows.filter(r => r.level === l.i)
  const pairs = seeds.map(s => [m.find(r => r.seed === s && r.tag === 'a'), m.find(r => r.seed === s && r.tag === 'b')]).filter(([a, b]) => a && b)
  out.levels[l.i] = chaosRatio(pairs)
  const c = out.levels[l.i], reg = l.chaos
  console.log(`L${String(l.i + 1).padStart(2)} ${l.name.padEnd(15)} regular C=${reg?.C?.toFixed(2) ?? ' – '}  expert C=${c?.C?.toFixed(2) ?? ' – '}`)
}
await writeFile('out/chaos-personas.json', JSON.stringify(out, null, 1))
console.log(`${rows.length} playtests on ${backend} in ${(ms / 1000).toFixed(0)} s`)
