// Rebuilds every deliverable from the latest results, in order, stopping at the first failure:
// demo traces → report → narrated video → patched copy of the game.
// usage: node scripts/finalize.mjs [results.json]
import { execFileSync } from 'node:child_process'

const results = process.argv[2] || 'results.json'
const steps = [
  ['demo traces', ['demo/make-traces.mjs', 'out/policies.mjs']],
  ['report', ['report/build.mjs', results]],
  ['narrated video', ['demo/build-video.mjs', results]],
  ['patched game copy', ['scripts/ship-fixed.mjs', results]],
]
for (const [name, args] of steps) {
  const t0 = Date.now()
  process.stdout.write(`▶ ${name}… `)
  const out = execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000 }).toString().trim().split('\n').pop()
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${out}`)
}
