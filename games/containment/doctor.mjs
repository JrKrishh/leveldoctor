// LEVEL DOCTOR diagnosis for CONTAINMENT, with the bots the agent wrote:
// difficulty (win rate and progress per difficulty x bot, with intervals), the Chaos Ratio, twist exposure
// (the fake-death scare, the cameras), and warden-speed sensitivity. usage: node games/containment/doctor.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { runContainment } from './batch.mjs'
import { wilson, chaosRatio } from '../../src/stats.mjs'
import { llmName } from '../../src/llm.mjs'

const N = +process.env.N || 12, PAIRS = +process.env.PAIRS || 12, WORKERS = +process.env.WORKERS || 4
const PERSONAS = ['random', 'regular', 'expert'], DIFFS = ['story', 'normal', 'nightmare']
const src = await readFile('out/containment-policies.js', 'utf8')
const code = src.replace(/^\/\/.*\n/, ''), header = src.split('\n')[0]
const t0 = Date.now(), say = (...a) => console.log(...a)
const run = async (tasks, name) => { const t = Date.now(); const rows = await runContainment(tasks, code, { workers: WORKERS }); say(`  ${name}: ${rows.length} playtests in ${((Date.now() - t) / 60000).toFixed(1)} min`); return rows }
const seeds = (n, from) => Array.from({ length: n }, (_, k) => from + k)
const summary = m => ({ ...wilson(m.filter(r => r.win).length, m.length), cores: +(m.reduce((s, r) => s + r.cores, 0) / Math.max(1, m.length)).toFixed(2), coreDist: [0, 1, 2, 3].map(c => m.filter(r => r.cores === c && !r.win).length).concat(m.filter(r => r.win).length), time: +(m.reduce((s, r) => s + r.time, 0) / Math.max(1, m.length)).toFixed(1), spotted: +(m.reduce((s, r) => s + r.spotted, 0) / Math.max(1, m.length)).toFixed(2), fakes: m.filter(r => r.fakes > 0).length / Math.max(1, m.length), ends: m.reduce((e, r) => (e[r.mode] = (e[r.mode] || 0) + 1, e), {}) })

say('▶ 1/4 difficulty: every bot on every difficulty')
const base = await run(PERSONAS.flatMap(policy => DIFFS.flatMap(difficulty => seeds(N, 1).map(seed => ({ policy, difficulty, seed })))), 'baseline')
const grid = Object.fromEntries(DIFFS.map(d => [d, Object.fromEntries(PERSONAS.map(p => [p, summary(base.filter(r => r.difficulty === d && r.policy === p))]))]))

say('▶ 2/4 chaos ratio (regular bot, normal: same seed, one turn nudged by 0.0001 rad)')
const chaosCode = `(() => { const B = ${code}; let k = 0; const wrap = f => (o, rng) => { const a = f(o, rng) || {}; if (++k === 25 && typeof a.yaw === 'number') a.yaw += 1e-4; return a }; return { regular: B.regular, regularNudged: wrap(B.regular) } })()`
const chaosRows = await runContainment(seeds(PAIRS, 1001).flatMap(seed => [{ policy: 'regular', difficulty: 'normal', seed, tag: 'a' }, { policy: 'regularNudged', difficulty: 'normal', seed, tag: 'b' }]), chaosCode, { workers: WORKERS })
say(`  chaos: ${chaosRows.length} playtests`)
const pairs = seeds(PAIRS, 1001).map(s => [chaosRows.find(r => r.seed === s && r.tag === 'a'), chaosRows.find(r => r.seed === s && r.tag === 'b')]).filter(([a, b]) => a && b)
const chaos = chaosRatio(pairs.map(([a, b]) => [{ win: a.cores >= 2 }, { win: b.cores >= 2 }]))   // outcome: reached 2+ cores (wins can be rare)
if (chaos) chaos.changed = pairs.filter(([a, b]) => a.time !== b.time || a.cores !== b.cores || a.px !== b.px).length / pairs.length

say('▶ 3/4 twist exposure: cameras switched off (same seeds), regular bot on normal')
const camRows = await run(seeds(PAIRS, 2001).flatMap(seed => [{ policy: 'regular', difficulty: 'normal', seed, tag: 'on' }, { policy: 'regular', difficulty: 'normal', seed, tag: 'off', setup: 'g.world.cams?.forEach?.(c => { c.offline = true }); g.world.camsOffline = true' }]), 'cameras')
const camPairs = seeds(PAIRS, 2001).map(s => [camRows.find(r => r.seed === s && r.tag === 'on'), camRows.find(r => r.seed === s && r.tag === 'off')]).filter(([a, b]) => a && b)
const cameras = { n: camPairs.length, changed: camPairs.filter(([a, b]) => a.time !== b.time || a.cores !== b.cores || a.px !== b.px).length / Math.max(1, camPairs.length), coresOn: +(camPairs.reduce((s, [a]) => s + a.cores, 0) / Math.max(1, camPairs.length)).toFixed(2), coresOff: +(camPairs.reduce((s, [, b]) => s + b.cores, 0) / Math.max(1, camPairs.length)).toFixed(2) }

say('▶ 4/4 knob: warden speed x0.8 / x1.2 (regular bot, normal)')
const knobRows = await run([0.8, 1.2].flatMap(k => seeds(PAIRS, 3001).map(seed => ({ policy: 'regular', difficulty: 'normal', seed, tag: String(k), setup: `g.warden.speedScale = ${k}` }))), 'warden speed')
const knob = Object.fromEntries([0.8, 1.2].map(k => [k, summary(knobRows.filter(r => r.tag === String(k)))]))

const res = { game: 'CONTAINMENT', generatedAt: new Date().toISOString(), llm: llmName(), bots: header, grid, chaos, cameras, knob, runs: base.length + chaosRows.length + camRows.length + knobRows.length, minutes: +((Date.now() - t0) / 60000).toFixed(1), n: N, pairs: PAIRS }
await writeFile('out/containment-results.json', JSON.stringify(res, null, 1))
for (const d of DIFFS) say(`${d.padEnd(9)} ` + PERSONAS.map(p => { const s = grid[d][p]; return `${p} wins ${(s.p * 100).toFixed(0)}% [${(s.lo * 100).toFixed(0)}–${(s.hi * 100).toFixed(0)}] cores ${s.cores}` }).join(' · '))
say(`chaos (reach 2+ cores): C = ${chaos?.C?.toFixed(2) ?? '–'}, nudge changed ${((chaos?.changed ?? 0) * 100).toFixed(0)}% of runs`)
say(`cameras off changed ${(cameras.changed * 100).toFixed(0)}% of runs; avg cores ${cameras.coresOn} with cameras vs ${cameras.coresOff} without`)
say(`warden speed x0.8: cores ${knob[0.8].cores}, wins ${(knob[0.8].p * 100).toFixed(0)}% · x1.2: cores ${knob[1.2].cores}, wins ${(knob[1.2].p * 100).toFixed(0)}%`)
say(`${res.runs} playtests in ${res.minutes} min`)
