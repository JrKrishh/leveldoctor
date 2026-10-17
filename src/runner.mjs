// One interface, two backends. `createos`: the batch runs inside a CreateOS sandbox (one reused sandbox).
// `local`: the same batch.mjs in child processes on this machine. Every result line records where it ran.
import './env.mjs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SANDBOX_FILE = path.join(ROOT, 'out', '.sandbox-id')
// What each game needs inside the sandbox: its batch program and the files that program imports.
const GAMES = {
  mashpit: { batch: 'src/batch.mjs', files: ['src/runtime.mjs', 'src/batch.mjs', 'build/game.bundle.mjs'] },
  orbital: { batch: 'games/orbital/batch.mjs', files: ['src/random.mjs', 'games/orbital/runtime.mjs', 'games/orbital/batch.mjs', 'build/orbital.bundle.mjs'] },
}

export const backendName = () => process.env.LD_BACKEND || (createosKey() ? 'createos' : 'local')
function createosKey() { return process.env.CREATEOS_SANDBOX_API_KEY || process.env.CREATEOS_API_KEY }

/** Run tasks; returns the parsed result rows. `policiesFile` is a path to the policies module. */
export async function runBatch(tasks, policiesFile, { name = 'batch', game = 'mashpit' } = {}) {
  const G = GAMES[game]
  await mkdir(path.join(ROOT, 'out', 'jobs'), { recursive: true })
  const jobDir = path.join(ROOT, 'out', 'jobs')
  await writeFile(path.join(jobDir, `${name}.policies.mjs`), await readFile(policiesFile))   // per job: two jobs can share the sandbox
  const job = { policies: `./${name}.policies.mjs`, tasks }
  const jobFile = path.join(jobDir, `${name}.json`)
  await writeFile(jobFile, JSON.stringify(job))
  const backend = backendName()
  const t0 = Date.now()
  const rows = backend === 'createos' ? await runCreateos(jobFile, name, G) : await runLocal(jobFile, G)
  for (const r of rows) r.backend = backend
  rows.sort((a, b) => a.i - b.i)
  return { rows, backend, ms: Date.now() - t0 }
}

function runLocal(jobFile, G) {
  const shards = Math.max(1, Math.min(os.cpus().length - 1, 7))
  return Promise.all(Array.from({ length: shards }, (_, s) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(ROOT, G.batch), jobFile, String(s), String(shards)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d)
    p.on('close', code => code === 0 ? res(parse(out)) : rej(new Error(`batch shard ${s} failed: ${err.slice(-800)}`)))
  }))).then(parts => parts.flat())
}
const parse = text => text.split('\n').filter(Boolean).map(l => JSON.parse(l))

// ---------- CreateOS sandbox ----------
// The bots are LLM-written code, so the sandbox gets no network at all. An empty allowlist means "allow all",
// so the allowlist names one host that can't resolve: everything else is blocked.
const NO_EGRESS = ['egress-blocked.invalid:443']
let sandboxP = null
export async function getSandbox() {
  if (sandboxP) return sandboxP
  sandboxP = (async () => {
    const { CreateosSandboxClient } = await import('@nodeops-createos/sandbox')
    const client = new CreateosSandboxClient({ apiKey: createosKey(), baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL || 'https://api-eu.sb.createos.sh' })
    if (existsSync(SANDBOX_FILE)) {   // free plan: 10 sandboxes a day, so reuse one all night
      try {
        const sb = await client.getSandbox((await readFile(SANDBOX_FILE, 'utf8')).trim())
        if (sb.status === 'paused') await sb.resume()
        // resume() returns while the sandbox is still "resuming"; commands need it "running"
        for (let i = 0; i < 60 && ['resuming', 'pausing', 'starting', 'creating'].includes(sb.status); i++) { await new Promise(r => setTimeout(r, 1000)); await sb.refresh() }
        if (sb.status === 'running') { await sb.setEgress(NO_EGRESS); return sb }
      } catch { }
    }
    const sb = await client.createSandbox({ shape: 's-1vcpu-1gb', rootfs: 'devbox:1', egress: NO_EGRESS, ingress_enabled: true, auto_pause_after_seconds: 900 })
    await writeFile(SANDBOX_FILE, sb.id)
    await sb.runCommand('mkdir', ['-p', '/work/src', '/work/build', '/work/out/jobs', '/work/site'])
    return sb
  })()
  return sandboxP
}

/** Proves the lockdown: an outbound request from inside the sandbox must fail. */
export async function checkIsolation() {
  const sb = await getSandbox()
  const { result } = await sb.runCommand('curl', ['-sS', '-m', '6', '-o', '/dev/null', '-w', '%{http_code}', 'https://example.com'], { timeoutMs: 20_000 })
  return { blocked: result.exit_code !== 0, exit: result.exit_code, detail: (result.stderr || result.stdout || '').trim().slice(0, 160), egress: (await sb.getEgress()).egress }
}

/** Serves the report from the sandbox's public URL (ingress); the sandbox wakes on request after auto-pause. */
export async function serveReport(htmlFile) {
  const sb = await getSandbox()
  await sb.files.upload('/work/site/index.html', await readFile(htmlFile))
  await sb.processes.create({ cmd: 'python3', args: ['-m', 'http.server', '8080', '--directory', '/work/site'] })
  return sb.previewUrl(8080)
}

const uploaded = new Map()
async function upload(sb, local, remote) {
  const data = await readFile(local)
  const key = createHash('sha1').update(data).digest('hex')   // content hash: a new round's bots must never be skipped
  if (uploaded.get(remote) === key) return
  await sb.files.upload(remote, data)
  uploaded.set(remote, key)
}

const madeDirs = new Set()
async function runCreateos(jobFile, name, G) {
  const sb = await getSandbox()
  const dirs = [...new Set(G.files.map(f => '/work/' + path.posix.dirname(f)))].filter(d => !madeDirs.has(d))
  if (dirs.length) { await sb.runCommand('mkdir', ['-p', ...dirs]); dirs.forEach(d => madeDirs.add(d)) }
  for (const f of G.files) await upload(sb, path.join(ROOT, f), '/work/' + f)
  await upload(sb, path.join(path.dirname(jobFile), `${name}.policies.mjs`), `/work/out/jobs/${name}.policies.mjs`)
  await upload(sb, jobFile, `/work/out/jobs/${name}.json`)
  // big batches go in chunks so no single request runs for many minutes
  const total = JSON.parse(await readFile(jobFile, 'utf8')).tasks.length, chunks = Math.max(1, Math.ceil(total / 250))
  const rows = []
  let execMs = 0
  for (let k = 0; k < chunks; k++) {
    const { result, exec_ms } = await sb.runCommand('node', ['/work/' + G.batch, `/work/out/jobs/${name}.json`, String(k), String(chunks)], { timeoutMs: 15 * 60_000 })
    if (result.exit_code !== 0) throw new Error(`sandbox batch failed (${result.exit_code}): ${(result.stderr || result.error || '').slice(-800)}`)
    rows.push(...parse(result.stdout)); execMs += exec_ms
    if (chunks > 1) console.log(`  [createos] chunk ${k + 1}/${chunks}: ${rows.length}/${total} runs`)
  }
  for (const r of rows) r.sandbox = sb.id
  console.log(`  [createos] sandbox ${sb.id}: ${rows.length} runs in ${(execMs / 1000).toFixed(1)} s`)
  return rows
}
