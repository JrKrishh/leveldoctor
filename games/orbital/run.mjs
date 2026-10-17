// LEVEL DOCTOR on a second genre: ORBITAL (endless arcade). Same loop as Mash Pit, different game:
// the LLM writes three bots, they run in the sandbox, the agent fixes them until skill ranks correctly,
// then survival curves, the Chaos Ratio, and one knob (spawn acceleration) tuned to a target, verified.
// usage: node games/orbital/run.mjs   → out/orbital-results.json
import '../../src/env.mjs'
import { writeFile, mkdir, appendFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chat, codeBlock, llmName } from '../../src/llm.mjs'
import { runBatch } from '../../src/runner.mjs'
import { wilson, chaosRatio, quantile } from '../../src/stats.mjs'
import { BASE_KNOBS } from './runtime.mjs'

const OUT = 'out', PERSONAS = ['random', 'reactive', 'predictive'], PASS_T = 20, TARGET = 0.5, REACTION = 0.2
const seeds = (n, from = 1) => Array.from({ length: n }, (_, k) => from + k)
const say = (...a) => console.log(...a)
const batch = (tasks, file, name) => runBatch(tasks, file, { name, game: 'orbital' })

const BRIEF = `GAME: ORBITAL, an endless arcade game. The player circles a star on a fixed orbit (radius orbitR around cx, cy) at angular speed spin (rad/s), direction dir (+1 or -1). Spin slowly increases over time.
Debris spawns off-screen and flies in straight lines toward the star. If a debris piece touches the player (distance < player.r + debrisR) the run ends. Each debris that passes inside the orbit scores a point. Spawns get more frequent over time.
The only action: tap, which reverses dir instantly. Survive as long as possible.
OBSERVATION o (IMPORTANT: it shows the game as it was ${REACTION} s ago, like a human's reaction delay; extrapolate positions forward by ${REACTION} s):
{ angle, dir, spin, orbitR, cx, cy, player: {x, y, r}, debrisR, debris: [{x, y, vx, vy}] (px and px/s), time, score }
Player position at angle a: (cx + cos(a)*orbitR, cy + sin(a)*orbitR); angle changes by dir*spin per second.
A bot is (o, rng) => boolean: true = tap now. It is asked every 0.05 s. rng() is uniform in [0,1); never use Math.random.`
const TASK = `Write THREE bots of increasing skill as ONE JavaScript ES module:
export default {
  random: (o, rng) => ...,      // casual: taps at random moments, about once every 2 seconds on average
  reactive: (o, rng) => ...,    // regular: taps when some debris is about to hit the stretch of orbit just ahead of the player
  predictive: (o, rng) => ...,  // expert: simulates both directions for the next ~1 s (after extrapolating the ${REACTION} s delay) and taps if reversing is clearly safer
}
Pure functions, no imports, no globals, always return a boolean. Reply with the module in ONE \`\`\`js code block.`

async function evaluate(file) {
  const { rows, backend, ms } = await batch(PERSONAS.flatMap(policy => seeds(40).map(seed => ({ policy, seed, reaction: REACTION }))), file, 'orbital-skill')
  const errors = [...new Set(rows.filter(r => r.reason === 'error').map(r => `${r.policy}: ${r.error}`))]
  const table = Object.fromEntries(PERSONAS.map(p => { const m = rows.filter(r => r.policy === p); return [p, { pass: wilson(m.filter(r => r.time >= PASS_T).length, m.length), median: quantile(m.map(r => r.time), 0.5), taps: quantile(m.map(r => r.taps), 0.5) }] }))
  const [a, b, c] = PERSONAS.map(p => table[p].median)
  const idle = ['reactive', 'predictive'].filter(p => table[p].taps < 1)   // a "skilled" bot that never taps isn't playing
  const weak = b < a * 1.2   // the regular bot has to clearly beat random play, or it can't stand in for a player
  return { ok: !errors.length && a < b && b < c && !idle.length && !weak, errors, table, idle, weak, backend, ms }
}

async function writeBots(rounds = 5) {
  const messages = [{ role: 'system', content: 'You are a senior game AI programmer. You write small, correct, dependency-free JavaScript.' }, { role: 'user', content: BRIEF + '\n\n' + TASK }]
  let best = null
  for (let round = 1; round <= rounds; round++) {
    say(`round ${round}: ${llmName()} is writing ORBITAL bots…`)
    const streamLog = []
    const { text, model } = await chat(messages, { stream: c => streamLog.push(c) })
    const code = codeBlock(text)
    if (!code) { messages.push({ role: 'assistant', content: text.slice(-2000) }, { role: 'user', content: 'Reply with only the ```js module.' }); continue }
    const file = path.resolve(OUT, `orbital-policies.round${round}.mjs`)
    await writeFile(file, `// Written by ${model}, round ${round}\n${code}`)
    await writeFile(path.join(OUT, `orbital-llm-stream-round${round}.json`), JSON.stringify({ model, round, chunks: streamLog }))
    const ev = await evaluate(file)
    await appendFile(path.join(OUT, 'orbital-agent-log.jsonl'), JSON.stringify({ round, eval: ev }) + '\n')
    const line = ev.errors.length ? `crashed: ${ev.errors.join(' | ').slice(0, 200)}` : PERSONAS.map(p => `${p} median ${ev.table[p].median.toFixed(1)} s`).join(' · ')
    say(`round ${round}: ${ev.backend} → ${line}${ev.ok ? '  SKILL RANKS CORRECTLY ✓' : ''}`)
    if (!ev.errors.length) { const [a, b, c] = PERSONAS.map(p => ev.table[p].median), score = Math.min(b - a, c - b); if (!best || ev.ok > best.ev.ok || (ev.ok === best.ev.ok && score > best.score)) best = { round, code, ev, score, model, file } }
    if (ev.ok) break
    const fb = ev.errors.length ? `Running your bots failed:\n${ev.errors.join('\n')}\nFix and reply with the full module.`
      : `Measured over 40 runs each (real game, ${REACTION} s reaction delay): ${PERSONAS.map(p => `${p}: median survival ${ev.table[p].median.toFixed(1)} s, median taps ${ev.table[p].taps}`).join('; ')}. Required: random < reactive < predictive median survival.${ev.idle.length ? ` ${ev.idle.join(' and ')} almost never tap${ev.idle.length > 1 ? '' : 's'} (median 0 taps): it is not reacting to debris at all; check its collision prediction.` : ''}${ev.weak ? ' reactive barely beats random: a regular player should survive clearly longer (at least 1.2x random), so make it dodge debris that threatens the next ~0.5 s of its path.' : ''} Improve the weaker bots and reply with the full module.`
    messages.push({ role: 'assistant', content: '```js\n' + code + '\n```' }, { role: 'user', content: fb })
  }
  if (!best) throw new Error('no runnable ORBITAL bots')
  const file = path.resolve(OUT, 'orbital-policies.mjs')
  await writeFile(file, `// Written by ${best.model}, round ${best.round} (skill ranks correctly: ${best.ev.ok})\n${best.code}`)
  return { ...best, file }
}

await mkdir(OUT, { recursive: true })
const t0 = Date.now()
// --reuse: keep the bots the agent already wrote (re-running the analysis only)
const prev = path.resolve(OUT, 'orbital-policies.mjs')
const header = process.argv.includes('--reuse') && existsSync(prev) ? (await readFile(prev, 'utf8')).split('\n')[0] : null
const bots = header ? { file: prev, round: +(header.match(/round (\d+)/)?.[1] || 0), model: header.match(/Written by (\S+)/)?.[1], ev: { ok: /correctly: true/.test(header) } } : await writeBots()
say(`${header ? 'reusing' : 'kept'} round ${bots.round}`)

// Survival curves per persona: the arcade version of a difficulty curve, with the pass rate for any time threshold.
say('▶ survival curves')
const { rows: base } = await batch(PERSONAS.flatMap(policy => seeds(100).map(seed => ({ policy, seed, reaction: REACTION }))), bots.file, 'orbital-base')
const curve = rows => Array.from({ length: 61 }, (_, t) => rows.filter(r => r.time >= t).length / rows.length)
const personas = Object.fromEntries(PERSONAS.map(p => { const m = base.filter(r => r.policy === p); return [p, { pass: wilson(m.filter(r => r.time >= PASS_T).length, m.length), median: quantile(m.map(r => r.time), 0.5), curve: curve(m) }] }))

// Chaos Ratio: same seed, the whole game shifted by 1 ms once. Also report how many runs changed at all,
// so C = 0 reads as "changed but never flipped" rather than "the nudge did nothing".
say('▶ chaos ratio (the whole game shifted by 1 ms at t = 2 s)')
const { rows: ch } = await batch(seeds(100, 1001).flatMap(seed => [{ policy: 'reactive', seed, reaction: REACTION, tag: 'a' }, { policy: 'reactive', seed, reaction: REACTION, tag: 'b', nudge: { t: 2, dt: 0.001 } }]), bots.file, 'orbital-chaos')
const raw = seeds(100, 1001).map(s => [ch.find(r => r.seed === s && r.tag === 'a'), ch.find(r => r.seed === s && r.tag === 'b')]).filter(([a, b]) => a && b)
const chaos = chaosRatio(raw.map(([a, b]) => [{ win: a.time >= PASS_T }, { win: b.time >= PASS_T }]))
if (chaos) chaos.changed = raw.filter(([a, b]) => a.time !== b.time || a.taps !== b.taps).length / raw.length

// Knob sensitivity: which difficulty constant actually changes how long a regular player survives?
// (The arcade version of the twist-exposure check: some knobs look important and do nothing.)
const passOf = rows => wilson(rows.filter(r => r.time >= PASS_T).length, rows.length)
const VARIANTS = Object.fromEntries(Object.keys(BASE_KNOBS).map(k => [k, k === 'SPAWN_RAMP' ? [0.95, 1.0] : [+(BASE_KNOBS[k] * 0.6).toFixed(3), +(BASE_KNOBS[k] * 1.6).toFixed(3)]]))
say('▶ knob sensitivity (each difficulty constant moved down and up, one at a time)')
const { rows: sens } = await batch(Object.entries(VARIANTS).flatMap(([k, vs]) => vs.flatMap(v => seeds(80, 3001).map(seed => ({ policy: 'reactive', seed, reaction: REACTION, knobs: { [k]: v }, tag: `${k}=${v}` })))), bots.file, 'orbital-sensitivity')
const basePass = passOf(base.filter(r => r.policy === 'reactive'))
const sensitivity = Object.entries(VARIANTS).map(([k, vs]) => { const ps = vs.map(v => passOf(sens.filter(r => r.tag === `${k}=${v}`)).p); return { knob: k, base: BASE_KNOBS[k], values: vs, pass: ps, effect: Math.max(...ps.map(p => Math.abs(p - basePass.p))) } }).sort((a, b) => b.effect - a.effect)
const KNOB = sensitivity[0].knob
say(sensitivity.map(s => `  ${s.knob.padEnd(12)} ${s.values.map((v, i) => `${v}: ${(s.pass[i] * 100).toFixed(0)}%`).join('  ')}  (effect ${(s.effect * 100).toFixed(0)} pts)`).join('\n'))

// Tune the knob that matters so a regular player reaches PASS_T half the time, then verify with fresh seeds.
const lo = Math.min(...VARIANTS[KNOB], BASE_KNOBS[KNOB]), hi = Math.max(...VARIANTS[KNOB], BASE_KNOBS[KNOB]) * (KNOB === 'SPAWN_RAMP' ? 1 : 1.5)
const DIAL = Array.from({ length: 9 }, (_, i) => ({ [KNOB]: +(lo + (hi - lo) * i / 8).toFixed(3) }))
const label = k => `${KNOB} ${k[KNOB]}`
say(`▶ tuning ${KNOB} (base ${BASE_KNOBS[KNOB]}) so a regular player reaches ${PASS_T} s ${TARGET * 100}% of the time`)
const { rows: sw } = await batch(DIAL.flatMap((k, i) => seeds(80, 4001).map(seed => ({ policy: 'reactive', seed, reaction: REACTION, knobs: k, tag: String(i) }))), bots.file, 'orbital-sweep')
const sweep = DIAL.map((k, i) => { const m = sw.filter(r => r.tag === String(i)); return { knobs: k, ...passOf(m), median: quantile(m.map(r => r.time), 0.5) } })
const pick = [...sweep].sort((a, b) => Math.abs(a.p - TARGET) - Math.abs(b.p - TARGET))[0]
const { rows: ver } = await batch(seeds(160, 5001).map(seed => ({ policy: 'reactive', seed, reaction: REACTION, knobs: pick.knobs })), bots.file, 'orbital-verify')
const verify = wilson(ver.filter(r => r.time >= PASS_T).length, ver.length)
verify.inBand = verify.lo <= TARGET + 0.1 && verify.hi >= TARGET - 0.1

const res = { game: 'ORBITAL', generatedAt: new Date().toISOString(), llm: llmName(), backend: base[0]?.backend, reaction: REACTION, passT: PASS_T, target: TARGET, botsRound: bots.round, botsOk: bots.ev.ok,
  personas, chaos, knobs: BASE_KNOBS, sensitivity, knob: KNOB, sweep, patch: pick.knobs, patchLabel: label(pick.knobs), baseLabel: label(BASE_KNOBS), verify, runs: base.length + ch.length + sens.length + sw.length + ver.length, seconds: Math.round((Date.now() - t0) / 1000) }
await writeFile(path.join(OUT, 'orbital-results.json'), JSON.stringify(res, null, 1))
say(PERSONAS.map(p => `${p}: reaches ${PASS_T} s in ${(personas[p].pass.p * 100).toFixed(0)}% [${(personas[p].pass.lo * 100).toFixed(0)}–${(personas[p].pass.hi * 100).toFixed(0)}], median ${personas[p].median.toFixed(1)} s`).join('\n'))
say(`Chaos Ratio C = ${chaos?.C?.toFixed(2) ?? '–'} (the shift changed ${(chaos?.changed * 100).toFixed(0)}% of runs, flipped ${(chaos?.flip * 100).toFixed(0)}% vs ${(chaos?.expect * 100).toFixed(0)}% for a coin toss)`)
say(`${label(BASE_KNOBS)} → ${label(pick.knobs)}: regular player ${(personas.reactive.pass.p * 100).toFixed(0)}% → verified ${(verify.p * 100).toFixed(0)}% [${(verify.lo * 100).toFixed(0)}–${(verify.hi * 100).toFixed(0)}] ${verify.inBand ? '✓' : '✗'}  (${res.runs} episodes on ${res.backend}, ${res.seconds} s)`)
