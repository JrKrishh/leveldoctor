// LEVEL DOCTOR pipeline: measure every level with error bars, diagnose (chaos vs fixable, twist exposure),
// tune drop limits to a target curve with one survival batch, verify the patch, and write out/results.json.
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBatch } from './runner.mjs'
import { wilson, chaosRatio, exposure, solveLimit, quantile } from './stats.mjs'
import { llmName } from './llm.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out')
export const PERSONAS = ['random', 'greedy', 'lookahead']
export const PLAYER = 'greedy'                       // the "regular player" the target curve is defined for
export const TEMPO = 1.2                             // human tempo, seconds per drop (RESEARCH.md finding 5)
export const target = (i, n) => 0.95 - 0.35 * i / (n - 1)   // regular player: 95% on level 1 down to 60% on the last
export const BAND = 0.10
const TWISTS = ['dj', 'wind', 'tilt', 'gravity', 'narrow', 'slippery', 'bouncy', 'fog']
const MIX = [{ p: 'random', share: 0.4, tries: 3 }, { p: 'greedy', share: 0.4, tries: 5 }, { p: 'lookahead', share: 0.2, tries: 8 }]

const seeds = (n, from = 1) => Array.from({ length: n }, (_, k) => from + k)
const say = (...a) => console.log(...a)

export async function diagnose({ policies, levels, N = 40, chaosN = 30, expN = 20, survN = 60, only, log = say }) {
  const idx = (only || levels.map((_, i) => i))
  const res = { generatedAt: new Date().toISOString(), llm: llmName(), tempo: TEMPO, band: BAND, personas: PERSONAS, player: PLAYER, levels: [] }
  const runs = { total: 0, backend: null, ms: 0 }
  const batch = async (tasks, name) => {
    const { rows, backend, ms } = await runBatch(tasks, policies, { name })
    runs.total += rows.length; runs.backend = backend; runs.ms += ms
    log(`  ${name}: ${rows.length} playtests on ${backend} in ${(ms / 1000).toFixed(1)} s`)
    return rows
  }

  // 1. Baseline: every level × persona, N seeds, real drop limits.
  log('▶ 1/5 measuring difficulty (pass rate with 95% intervals)')
  const base = await batch(idx.flatMap(level => PERSONAS.flatMap(policy => seeds(N).map(seed => ({ level, policy, seed, tempo: TEMPO })))), 'baseline')

  // 2. Chaos Ratio: same seed, one drop nudged by 0.0001 units (far below a pixel).
  log('▶ 2/5 chaos ratio (paired replays with an imperceptible nudge)')
  const chaosTasks = idx.flatMap(level => seeds(chaosN, 1001).flatMap(seed => [
    { level, policy: PLAYER, seed, tempo: TEMPO, tag: 'a' },
    { level, policy: PLAYER, seed, tempo: TEMPO, tag: 'b', nudge: { at: 3, dx: 1e-4 } }]))
  const chaos = await batch(chaosTasks, 'chaos')

  // 3. Twist exposure: each twist switched off, same seeds; identical runs mean the twist never mattered.
  log('▶ 3/5 twist exposure (paired runs with each twist off), at human and bot tempo')
  const expTasks = []
  for (const level of idx) {
    const L = levels[level]
    for (const tw of TWISTS) {
      const on = tw === 'dj' ? (L.mods.dj ?? 16) > 0 : !!L.mods[tw]
      if (!on) continue
      const off = JSON.parse(JSON.stringify(L)); if (tw === 'dj') off.mods.dj = 0; else delete off.mods[tw]
      for (const tempo of [TEMPO, 0.53]) for (const seed of seeds(expN, 2001)) {
        expTasks.push({ level, policy: PLAYER, seed, tempo, tag: `${tw}|${tempo}|on` }, { level, policy: PLAYER, seed, tempo, tag: `${tw}|${tempo}|off`, override: off })
      }
    }
  }
  const exp = await batch(expTasks, 'exposure')

  for (const level of idx) {
    const L = levels[level], t = target(level, levels.length)
    const row = { i: level, name: L.name, goal: L.goal, drops: L.drops, mods: L.mods, target: t, personas: {} }
    for (const p of PERSONAS) {
      const m = base.filter(r => r.level === level && r.policy === p)
      const w = wilson(m.filter(r => r.win).length, m.length)
      const reasons = {}; for (const r of m) reasons[r.reason] = (reasons[r.reason] || 0) + 1
      row.personas[p] = { ...w, reasons, dropsP50: quantile(m.filter(r => r.win).map(r => r.drops), 0.5), dropsP90: quantile(m.filter(r => r.win).map(r => r.drops), 0.9), errors: m.filter(r => r.reason === 'error').length }
    }
    const pl = row.personas[PLAYER]
    row.status = pl.hi < t - BAND ? 'too_hard' : pl.lo > t + BAND ? 'too_easy' : 'ok'
    // a regular bot far below random play can't be trusted to measure this level: don't tune from it
    row.botSuspect = row.personas.random.p - pl.p > 0.25
    const c = chaos.filter(r => r.level === level), pairs = []
    for (const s of seeds(chaosN, 1001)) { const a = c.find(r => r.seed === s && r.tag === 'a'), b = c.find(r => r.seed === s && r.tag === 'b'); if (a && b) pairs.push([a, b]) }
    row.chaos = chaosRatio(pairs)
    row.exposure = {}
    for (const tw of TWISTS) for (const tempo of [TEMPO, 0.53]) {
      const e = exp.filter(r => r.level === level && r.tag?.startsWith(`${tw}|${tempo}|`)); if (!e.length) continue
      const ps = seeds(expN, 2001).map(s => [e.find(r => r.seed === s && r.tag.endsWith('on')), e.find(r => r.seed === s && r.tag.endsWith('off'))]).filter(([a, b]) => a && b)
      const onW = ps.filter(([a]) => a.win).length, offW = ps.filter(([, b]) => b.win).length
      ;(row.exposure[tw] ??= {})[tempo] = { ...exposure(ps), passOn: onW / ps.length, passOff: offW / ps.length }
    }
    // the cheese check: if random play does as well as the regular player, skill doesn't matter here
    row.flags = []
    if (row.personas.random.p >= pl.p && pl.p < 0.98) row.flags.push('LUCK: random play does as well as a regular player')
    if (row.chaos?.C != null && row.chaos.C >= 0.6) row.flags.push(`CHAOS ${row.chaos.C.toFixed(2)}: losses are dice rolls, not fixable traps`)
    if (row.chaos?.C != null && row.chaos.C <= 0.2 && pl.p < 0.98) row.flags.push(`TRAP ${row.chaos.C.toFixed(2)}: losses are reproducible, a designer can fix them`)
    for (const [tw, e] of Object.entries(row.exposure)) {
      if (e[0.53] && e[TEMPO] && e[TEMPO].rate - e[0.53].rate >= 0.4) row.flags.push(`TEMPO: fast bots miss the ${tw} twist (${(e[0.53].rate * 100).toFixed(0)}% exposed vs ${(e[TEMPO].rate * 100).toFixed(0)}% at human tempo)`)
      if (e[TEMPO] && e[TEMPO].rate < 0.3) row.flags.push(`DECORATION: the ${tw} twist changed only ${(e[TEMPO].rate * 100).toFixed(0)}% of runs`)
    }
    if (pl.errors) row.flags.push(`BUG: ${pl.errors} runs crashed`)
    res.levels.push(row)
  }

  // 4. Tune: one batch with unlimited drops per off-target level, then read the pass rate at every limit.
  for (const r of res.levels) if (r.botSuspect && r.status !== 'ok') r.tune = { note: 'the regular bot plays this level worse than random play: fix the bot before tuning the level' }
  const off = res.levels.filter(r => r.status !== 'ok' && !r.botSuspect)
  log(`▶ 4/5 tuning ${off.length} off-target levels with one survival-curve batch`)
  if (off.length) {
    const surv = await batch(off.flatMap(r => {
      const o = JSON.parse(JSON.stringify(levels[r.i])); o.drops = 999
      return seeds(survN, 3001).map(seed => ({ level: r.i, policy: PLAYER, seed, tempo: TEMPO, override: o }))
    }), 'survival')
    for (const r of off) {
      const rows = surv.filter(s => s.level === r.i)
      const sol = solveLimit(rows, r.target, { min: 5, max: Math.max(120, r.drops * 2) })
      const ceiling = rows.filter(s => s.win).length / rows.length
      r.tune = { D: sol.D, predicted: sol.p, ceiling, overflowShare: rows.filter(s => s.reason === 'overflow').length / rows.length }
      if (Math.abs(sol.p - r.target) <= BAND) r.patch = { drops: sol.D }
      else r.tune.note = r.status === 'too_hard' ? `even unlimited drops only reach ${(ceiling * 100).toFixed(0)}%: losses are overflows, so a drop limit can't fix it; soften the twist` : 'cannot hit target by drop limit'
    }
  }

  // 5. Verify the patch with fresh seeds.
  const patched = res.levels.filter(r => r.patch)
  log(`▶ 5/5 verifying ${patched.length} patched levels with fresh seeds`)
  if (patched.length) {
    const ver = await batch(patched.flatMap(r => {
      const o = JSON.parse(JSON.stringify(levels[r.i])); Object.assign(o, r.patch)
      return seeds(N * 1.5, 5001).map(seed => ({ level: r.i, policy: PLAYER, seed, tempo: TEMPO, override: o }))
    }), 'verify')
    for (const r of patched) {
      const m = ver.filter(v => v.level === r.i)
      r.verify = wilson(m.filter(v => v.win).length, m.length)
      r.verify.inBand = r.verify.hi >= r.target - BAND && r.verify.lo <= r.target + BAND
    }
  }

  // Churn funnel: share of a mixed player population still playing at each level (before vs after).
  const funnel = which => {
    const out = []; let alive = MIX.map(m => m.share)
    for (const r of res.levels) {
      out.push(alive.reduce((a, b) => a + b, 0))
      alive = alive.map((a, k) => {
        const p = which === 'after' && r.verify ? (MIX[k].p === PLAYER ? r.verify.p : r.personas[MIX[k].p].p * (r.verify.p / Math.max(0.01, r.personas[PLAYER].p))) : r.personas[MIX[k].p].p
        return a * (1 - Math.pow(1 - Math.min(1, p), MIX[k].tries))
      })
    }
    out.push(alive.reduce((a, b) => a + b, 0))
    return out
  }
  res.funnel = { before: funnel('before'), after: funnel('after'), mix: MIX }
  res.runs = runs
  return res
}

export async function save(res, name = 'results.json') {
  await mkdir(OUT, { recursive: true })
  await writeFile(path.join(OUT, name), JSON.stringify(res, null, 1))
}
