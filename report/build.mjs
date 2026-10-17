// Builds the static report: report/dist/index.html with the results embedded (no server, no build step to host).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resFile = path.join(ROOT, 'out', process.argv[2] || 'results.json')
const res = JSON.parse(await readFile(resFile, 'utf8'))
const polFile = path.join(ROOT, res.policiesFile || 'out/policies.mjs')
const bots = existsSync(polFile) ? await readFile(polFile, 'utf8') : ''
let agent = []
try { agent = (await readFile(path.join(ROOT, 'out', 'agent-log.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.eval).map(e => ({ round: e.round, ok: e.eval.ok, errors: e.eval.errors, table: e.eval.table && Object.fromEntries(Object.entries(e.eval.table).map(([p, t]) => [p, t.overall])) })) } catch { }
let sandbox = null, orbital = null
try { sandbox = JSON.parse(await readFile(path.join(ROOT, 'out', 'sandbox-check.json'), 'utf8')) } catch { }
try { orbital = JSON.parse(await readFile(path.join(ROOT, 'out', 'orbital-results.json'), 'utf8')) } catch { }
try { if (sandbox) sandbox.cross = JSON.parse(await readFile(path.join(ROOT, 'out', 'cross-check.json'), 'utf8')) } catch { }
const tpl = await readFile(path.join(ROOT, 'report', 'template.html'), 'utf8')
const data = JSON.stringify({ res, bots, agent, sandbox, orbital }).replace(/</g, '\\u003c')
await mkdir(path.join(ROOT, 'report', 'dist'), { recursive: true })
await writeFile(path.join(ROOT, 'report', 'dist', 'index.html'), tpl.replace('/*__DATA__*/null', data))
console.log('report → report/dist/index.html')
