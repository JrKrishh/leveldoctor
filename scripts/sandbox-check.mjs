// Gate: the CreateOS sandbox runs the same batch with identical results, and its network is locked down.
// usage: node scripts/sandbox-check.mjs [policies.mjs]
import '../src/env.mjs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import { getSandbox, checkIsolation, runBatch } from '../src/runner.mjs'
import { runLevel } from '../src/runtime.mjs'

const polFile = path.resolve(process.argv[2] || 'test/fixture-policies.mjs')
const bots = (await import(pathToFileURL(polFile).href)).default
const t0 = Date.now()
const sb = await getSandbox()
console.log(`sandbox ${sb.id} ${sb.status} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
const { result: nodeV } = await sb.runCommand('node', ['-v'])
console.log('node in sandbox:', nodeV.stdout.trim())
const iso = await checkIsolation()
console.log(`egress lockdown: ${iso.blocked ? 'BLOCKED ✓' : 'OPEN ✗'} (curl exit ${iso.exit}: ${iso.detail}) allowlist=${JSON.stringify(iso.egress)}`)

process.env.LD_BACKEND = 'createos'
const tasks = []
for (const level of [0, 6, 12]) for (const seed of [1, 2]) tasks.push({ level, policy: 'greedy', seed, tempo: 1.2 })
const { rows, ms } = await runBatch(tasks, polFile, { name: 'sandbox-check' })
let same = 0
for (const r of rows) if (runLevel(r.level, bots.greedy, { seed: r.seed, tempo: 1.2 }).hash === r.hash) same++
console.log(`batch in sandbox: ${rows.length} runs in ${(ms / 1000).toFixed(1)} s; identical to local on ${same}/${rows.length}`)
await mkdir('out', { recursive: true })
await writeFile('out/sandbox-check.json', JSON.stringify({ at: new Date().toISOString(), sandbox: sb.id, node: nodeV.stdout.trim(), isolation: iso, runs: rows.length, identical: same }, null, 1))
process.exit(iso.blocked && same === rows.length ? 0 : 1)
