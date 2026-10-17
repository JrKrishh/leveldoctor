// Runs a batch of ORBITAL episodes and prints one JSON line per episode (runs locally or inside the sandbox).
// usage: node games/orbital/batch.mjs <job.json> [shard] [shards]
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { runEpisode } from './runtime.mjs'

const [jobPath, shard = '0', shards = '1'] = process.argv.slice(2)
const job = JSON.parse(await readFile(jobPath, 'utf8'))
const policies = (await import(pathToFileURL(path.resolve(path.dirname(jobPath), job.policies)).href)).default
const out = []
job.tasks.forEach((t, i) => {
  if (i % +shards !== +shard) return
  const policy = policies[t.policy]
  if (!policy) throw new Error(`unknown policy ${t.policy}`)
  const r = runEpisode(policy, { seed: t.seed, reaction: t.reaction, knobs: t.knobs, nudge: t.nudge })
  out.push(JSON.stringify({ i, tag: t.tag, policy: t.policy, ...r }))
})
process.stdout.write(out.join('\n') + (out.length ? '\n' : ''))
