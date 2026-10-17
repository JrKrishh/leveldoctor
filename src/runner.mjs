// One interface, two backends. `createos`: the batch runs inside a CreateOS sandbox (one reused sandbox).
// `local`: the same batch.mjs in child processes on this machine. Every result line records where it ran.
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SANDBOX_FILE = path.join(ROOT, 'out', '.sandbox-id')

export const backendName = () => process.env.LD_BACKEND || (createosKey() ? 'createos' : 'local')
function createosKey() { return process.env.CREATEOS_SANDBOX_API_KEY || process.env.CREATEOS_API_KEY }

/** Run tasks; returns the parsed result rows. `policiesFile` is a path to the policies module. */
export async function runBatch(tasks, policiesFile, { name = 'batch' } = {}) {
  await mkdir(path.join(ROOT, 'out', 'jobs'), { recursive: true })
  const jobDir = path.join(ROOT, 'out', 'jobs')
  await writeFile(path.join(jobDir, 'policies.mjs'), await readFile(policiesFile))
  const job = { policies: './policies.mjs', tasks }
  const jobFile = path.join(jobDir, `${name}.json`)
  await writeFile(jobFile, JSON.stringify(job))
  const backend = backendName()
  const t0 = Date.now()
  const rows = backend === 'createos' ? await runCreateos(jobFile, name) : await runLocal(jobFile)
  for (const r of rows) r.backend = backend
  rows.sort((a, b) => a.i - b.i)
  return { rows, backend, ms: Date.now() - t0 }
}

function runLocal(jobFile) {
  const shards = Math.max(1, Math.min(os.cpus().length - 1, 7))
  return Promise.all(Array.from({ length: shards }, (_, s) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'src', 'batch.mjs'), jobFile, String(s), String(shards)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d)
    p.on('close', code => code === 0 ? res(parse(out)) : rej(new Error(`batch shard ${s} failed: ${err.slice(-800)}`)))
  }))).then(parts => parts.flat())
}
const parse = text => text.split('\n').filter(Boolean).map(l => JSON.parse(l))

// ---------- CreateOS sandbox ----------
let sandboxP = null
export async function getSandbox() {
  if (sandboxP) return sandboxP
  sandboxP = (async () => {
    const { CreateosSandboxClient } = await import('@nodeops-createos/sandbox')
    const client = new CreateosSandboxClient({ apiKey: createosKey() })
    if (existsSync(SANDBOX_FILE)) {   // free plan: 10 sandboxes a day, so reuse one all night
      try {
        const sb = await client.getSandbox((await readFile(SANDBOX_FILE, 'utf8')).trim())
        if (sb.status === 'paused') await sb.resume()
        if (['running', 'paused'].includes(sb.status) || (await sb.refresh()).status === 'running') return sb
      } catch { }
    }
    const sb = await client.createSandbox({ shape: 's-1vcpu-1gb', rootfs: 'devbox:1', auto_pause_after_seconds: 900 })
    await writeFile(SANDBOX_FILE, sb.id)
    await sb.runCommand('mkdir', ['-p', '/work/src', '/work/build', '/work/out/jobs'])
    return sb
  })()
  return sandboxP
}

const uploaded = new Map()
async function upload(sb, local, remote) {
  const data = await readFile(local)
  const key = remote + ':' + data.length
  if (uploaded.get(remote) === key) return
  await sb.files.upload(remote, data)
  uploaded.set(remote, key)
}

async function runCreateos(jobFile, name) {
  const sb = await getSandbox()
  for (const f of ['src/runtime.mjs', 'src/batch.mjs', 'build/game.bundle.mjs']) await upload(sb, path.join(ROOT, f), '/work/' + f)
  await upload(sb, path.join(path.dirname(jobFile), 'policies.mjs'), '/work/out/jobs/policies.mjs')
  await upload(sb, jobFile, `/work/out/jobs/${name}.json`)
  const { result, exec_ms } = await sb.runCommand('node', ['/work/src/batch.mjs', `/work/out/jobs/${name}.json`], { timeoutMs: 20 * 60_000 })
  if (result.exit_code !== 0) throw new Error(`sandbox batch failed (${result.exit_code}): ${(result.stderr || result.error || '').slice(-800)}`)
  const rows = parse(result.stdout)
  for (const r of rows) r.sandbox = sb.id
  console.log(`  [createos] sandbox ${sb.id}: ${rows.length} runs in ${(exec_ms / 1000).toFixed(1)} s`)
  return rows
}
