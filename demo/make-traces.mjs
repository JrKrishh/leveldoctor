// Records replays for the demo video: a chaos pair (same seed, one drop nudged by 0.0001 units, outcomes differ)
// and a tempo pair (Bass Drop! at bot speed vs human speed). usage: node demo/make-traces.mjs [policies.mjs]
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runLevel, G } from '../src/runtime.mjs'

const polFile = path.resolve(process.argv[2] || 'out/policies.mjs')
const bots = (await import(pathToFileURL(polFile).href)).default
const bot = bots.greedy
const out = { tiers: G.TIERS.map(t => ({ key: t.key, r: t.r, color: t.color })) }

function chaosPair(level) {
  for (let seed = 1001; seed < 1200; seed++) {
    const a = runLevel(level, bot, { seed })
    const b = runLevel(level, bot, { seed, nudge: { at: 3, dx: 1e-4 } })
    if (a.win !== b.win) return { level, name: G.LEVELS[level].name, seed, a: runLevel(level, bot, { seed, trace: true }), b: runLevel(level, bot, { seed, nudge: { at: 3, dx: 1e-4 }, trace: true }) }
  }
}
for (const level of [6, 12, 14, 19, 10]) { const p = chaosPair(level); if (p) { out.chaos = p; break } }
console.log('chaos pair:', out.chaos && `${out.chaos.name} seed ${out.chaos.seed}: ${out.chaos.a.reason} vs ${out.chaos.b.reason}`)

const fast = runLevel(3, bot, { seed: 7, tempo: 0.53, trace: true }), slow = runLevel(3, bot, { seed: 7, tempo: 1.2, trace: true })
out.tempo = { level: 3, name: G.LEVELS[3].name, fast, slow, firstBass: 32 * 60 / 118 }
console.log(`tempo pair: fast ${fast.reason} in ${fast.time}s, human ${slow.reason} in ${slow.time}s (first bass drop at ${out.tempo.firstBass.toFixed(1)}s)`)
await writeFile('demo/traces.json', JSON.stringify(out))
