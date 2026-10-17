// Runs a batch of playtests and prints one JSON line per run. This is the program that runs inside the sandbox.
// usage: node batch.mjs <job.json> [shard] [shards]
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { runLevel } from './runtime.mjs'

const [jobPath, shard = '0', shards = '1'] = process.argv.slice(2)
const job = JSON.parse(await readFile(jobPath, 'utf8'))
const policies = (await import(pathToFileURL(path.resolve(path.dirname(jobPath), job.policies)).href)).default
const out = []
job.tasks.forEach((t, i) => {
  if (i % +shards !== +shard) return
  const policy = policies[t.policy]
  if (!policy) throw new Error(`unknown policy ${t.policy}`)
  const r = runLevel(t.level, policy, { seed: t.seed, tempo: t.tempo, level: t.override, nudge: t.nudge, trace: t.trace })
  out.push(JSON.stringify({ i, tag: t.tag, policy: t.policy, tempo: t.tempo, ...r }))
})
process.stdout.write(out.join('\n') + (out.length ? '\n' : ''))
