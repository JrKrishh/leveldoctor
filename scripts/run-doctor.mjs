// Runs the full diagnosis. usage: node scripts/run-doctor.mjs [policies.mjs] [--only 0,3,6] [--quick] [--out name.json]
// Every console line is also recorded with its time (out/doctor-terminal.json) so the demo can replay the real run.
import { writeFile } from 'node:fs/promises'
import { diagnose, save } from '../src/doctor.mjs'
import { BASE_LEVELS } from '../src/runtime.mjs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const policies = path.resolve(args.find(a => a.endsWith('.mjs')) || 'out/policies.mjs')
const only = flag('--only')?.split(',').map(Number)
const quick = args.includes('--quick')
const t0 = Date.now(), terminal = []
const print = console.log.bind(console)
console.log = (...a) => { const line = a.join(' '); terminal.push([Date.now() - t0, line]); print(line) }
console.log(`$ node scripts/run-doctor.mjs  # ${path.relative(process.cwd(), policies)}`)
const res = await diagnose({ policies, levels: BASE_LEVELS, only, ...(quick ? { N: 12, chaosN: 8, expN: 6, survN: 16 } : {}) })
res.policiesFile = path.relative(process.cwd(), policies)
await save(res, flag('--out') || 'results.json')
for (const r of res.levels) {
  const pl = r.personas.greedy, pc = w => `${(w.p * 100).toFixed(0).padStart(3)}%`
  console.log(`L${String(r.i + 1).padStart(2)} ${r.name.padEnd(15)} rnd ${pc(r.personas.random)} reg ${pc(pl)} [${(pl.lo * 100).toFixed(0)}–${(pl.hi * 100).toFixed(0)}] exp ${pc(r.personas.lookahead)} target ${(r.target * 100).toFixed(0)}% ${r.status.padEnd(8)} C=${r.chaos?.C?.toFixed(2) ?? ' – '}${r.patch ? `  PATCH drops ${r.drops}→${r.patch.drops} verify ${(r.verify.p * 100).toFixed(0)}% ${r.verify.inBand ? '✓' : '✗'}` : ''}${r.tune?.note ? '  ' + r.tune.note : ''}`)
  for (const f of r.flags) console.log(`      ⚑ ${f}`)
}
console.log(`${res.runs.total} playtests on ${res.runs.backend}, ${((Date.now() - t0) / 1000).toFixed(0)} s total`)
await writeFile(flag('--terminal') || 'out/doctor-terminal.json', JSON.stringify(terminal))
