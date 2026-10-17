// The agent writes its own bot players as code, tests them in the runner, and rewrites them until skill ranks
// correctly (random < greedy < lookahead). Every attempt, prompt and result is logged to out/agent-log.jsonl.
import { writeFile, appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chat, codeBlock, llmName } from './llm.mjs'
import { runBatch } from './runner.mjs'
import { wilson } from './stats.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out')
export const PERSONAS = ['random', 'greedy', 'lookahead']

export function gameBrief(levels, tiers) {
  return `GAME: Mash Pit, a physics merge game (like Suika). The player drops monsters into a pit from the top.
Two monsters of the SAME tier that touch merge into one monster of the next tier (bigger, more points).
Frozen monsters (ice: true) cannot merge until a merge happens next to them. Gift boxes pop when a merge happens next to them.
You LOSE if the pile stays above the line (y < lineY) for 2 seconds, or you run out of drops. y grows DOWNWARD (floor is the largest y).
The only action: choose the x coordinate to drop the current monster. One drop about every 1.2 seconds.
Goal types: {make: tier} reach that tier; {mash: tier, n} merge into that tier n times; {score: n}; {gifts: true} pop every gift; {ice: true} thaw every frozen monster.
Tier radii: ${JSON.stringify(tiers.map(t => t.r))} (tier 0 is the smallest).
Levels: ${JSON.stringify(levels.map((l, i) => ({ i, name: l.name, goal: l.goal, drops: l.drops, mods: l.mods })))}

OBSERVATION object o passed to a bot each time it must drop:
{ cur: tier in hand, next: tier after that or null (hidden), dropsLeft, score, time,
  left, right: inner pit walls (x), lineY, floorY, dropY, radius: [r per tier],
  goal, mods, progress: {highestTier, mashed},
  mons: [{tier, x, y, ice}], gifts: [{x, y}],
  landY(x, tier = o.cur): the y where a monster of that tier dropped at x would first touch the pile (like the in-game aim guide),
  clampX(x, tier = o.cur): x clamped so the monster fits inside the walls }
A monster spawns at dropY (the top) and falls; judge a drop by where it LANDS (o.landY), not where it spawns.
A bot is a function (o, rng) => x. rng() returns a uniform number in [0,1); use it instead of Math.random.
The game clamps x so the monster stays inside the walls.`
}

const TASK = `Write THREE bot players of increasing skill as ONE JavaScript ES module:

export default {
  random: (o, rng) => ...,     // casual player: drops at a uniformly random x inside the walls
  greedy: (o, rng) => ...,     // regular player, one simple rule at a time: merge when it can (onto the reachable same-tier, unfrozen monster highest in the pile); otherwise go for the level's goal objects (drop next to a gift or a frozen monster); otherwise keep the pile flat
  lookahead: (o, rng) => ...,  // expert: tries ~20 candidate x positions, scores each (merge chances with same-tier neighbours near where the monster would land, keeping the pile low, avoiding the walls of big monsters, using o.next and the goal: gifts, ice), returns the best
}

Rules: pure functions of (o, rng); no imports, no globals, no Math.random; always return a finite number; keep each function under 60 lines; helper functions above the export are allowed.
Reply with the module in ONE \`\`\`js code block.`

async function log(entry) { await mkdir(OUT, { recursive: true }); await appendFile(path.join(OUT, 'agent-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n') }

/** Smoke test + monotonicity check in the runner. Returns { ok, table, errors }. */
// One test level per goal type and twist family, so a bot can't pass by being good at one kind of level only.
export const TEST_LEVELS = [2, 4, 6, 8, 12, 15, 19]
const COLLAPSE = 0.25   // a skilled bot this far below random play on any level is broken there

export async function evaluate(file, { levels = TEST_LEVELS, n = 16, tempo = 1.2 } = {}) {
  const tasks = []
  for (const level of levels) for (const policy of PERSONAS) for (let seed = 1; seed <= n; seed++) tasks.push({ level, policy, seed, tempo })
  const { rows, backend, ms } = await runBatch(tasks, file, { name: 'monotonicity' })
  const errors = [...new Set(rows.filter(r => r.reason === 'error').map(r => `${r.policy}: ${r.error}`))]
  const table = {}
  for (const p of PERSONAS) {
    const mine = rows.filter(r => r.policy === p)
    table[p] = { overall: wilson(mine.filter(r => r.win).length, mine.length) }
    for (const l of levels) { const m = mine.filter(r => r.level === l); table[p][l] = wilson(m.filter(r => r.win).length, m.length) }
  }
  const [a, b, c] = PERSONAS.map(p => table[p].overall.p)
  const collapses = []
  for (const l of levels) for (const p of ['greedy', 'lookahead']) if (table[p][l].p < table.random[l].p - COLLAPSE) collapses.push({ level: l, policy: p, p: table[p][l].p, random: table.random[l].p })
  // What a human tester would report about each bot on each level: how runs ended, goal left over, drop spread.
  const diag = {}
  for (const p of PERSONAS) for (const l of levels) {
    const m = rows.filter(r => r.policy === p && r.level === l), avg = k => (m.reduce((s, r) => s + (r[k] || 0), 0) / Math.max(1, m.length)).toFixed(1)
    const ends = {}; for (const r of m) ends[r.reason] = (ends[r.reason] || 0) + 1
    diag[`${p}|${l}`] = `ended: ${JSON.stringify(ends)}, drops used avg ${avg('drops')}, drop-x spread (SD) ${avg('xsd')} px, at the end: frozen left ${avg('iceLeft')}, gifts left ${avg('giftsLeft')}, mashes ${avg('mashed')}, highest tier ${avg('highestTier')}`
  }
  return { ok: !errors.length && a < b && b < c && !collapses.length, table, errors, collapses, diag, backend, ms, runs: rows.length }
}

const fmt = t => PERSONAS.map(p => `${p}: overall ${(t[p].overall.p * 100).toFixed(0)}% [${Object.entries(t[p]).filter(([k]) => k !== 'overall').map(([k, v]) => `L${+k + 1} ${(v.p * 100).toFixed(0)}%`).join(', ')}]`).join('\n')

export async function writePolicies({ levels, tiers, rounds = 8, onEvent = () => {} }) {
  const file = path.join(OUT, 'policies.mjs')
  const messages = [
    { role: 'system', content: 'You are a senior game AI programmer. You write small, correct, dependency-free JavaScript.' },
    { role: 'user', content: gameBrief(levels, tiers) + '\n\n' + TASK },
  ]
  let best = null, prevCode = null
  for (let round = 1; round <= rounds; round++) {
    onEvent({ type: 'llm', round, model: llmName() })
    const streamLog = []   // the model's real output with timings, replayed in the demo video
    const { text, ms, model } = await chat(messages, { stream: c => streamLog.push(c) })
    await writeFile(path.join(OUT, `llm-stream-round${round}.json`), JSON.stringify({ model, round, chunks: streamLog }))
    const code = codeBlock(text)
    await log({ round, model, ms, reply: text.slice(-6000) })
    if (!code || !/export\s+default/.test(code)) {
      messages.push({ role: 'assistant', content: text.slice(-3000) }, { role: 'user', content: 'Your reply had no ES module with `export default { random, greedy, lookahead }` in a ```js block. Reply with only that block.' })
      onEvent({ type: 'reject', round, why: 'no module' })
      continue
    }
    const roundFile = path.join(OUT, `policies.round${round}.mjs`)
    await writeFile(roundFile, `// Written by ${model}, round ${round}\n${code}`)
    let ev
    try { ev = await evaluate(roundFile) } catch (e) { ev = { ok: false, errors: [String(e.message).slice(0, 600)], table: null } }
    await log({ round, eval: ev })
    onEvent({ type: 'eval', round, ...ev })
    if (!ev.errors.length && ev.table) {
      const [pa, pb, pc] = PERSONAS.map(p => ev.table[p].overall.p)
      const score = Math.min(pb - pa, pc - pb) - 0.5 * ev.collapses.length   // both skill gaps, broken levels cost a lot
      if (!best || ev.ok > best.ev.ok || (ev.ok === best.ev.ok && score > best.score)) best = { round, code, ev, score, model }
    }
    if (ev.ok) break
    const feedback = ev.errors.length
      ? `Running your bots failed:\n${ev.errors.join('\n')}\nFix the bugs and reply with the full module.`
      : `Measured pass rates (n=16 runs per level per bot, real game):\n${fmt(ev.table)}\nRequired: random < greedy < lookahead overall, and no skilled bot far below random play on any level. ${ev.table.greedy.overall.p <= ev.table.random.overall.p ? 'greedy is not better than random: it probably stacks too high or ignores the goal. ' : ''}${ev.table.lookahead.overall.p <= ev.table.greedy.overall.p ? 'lookahead is not better than greedy: improve its scoring (pile height, merges, goal objects, next piece). ' : ''}\n${ev.collapses.map(c => `BROKEN: on L${c.level + 1} ${levels[c.level].name} (goal ${JSON.stringify(levels[c.level].goal)}, mods ${JSON.stringify(levels[c.level].mods)}) ${c.policy} wins ${(c.p * 100).toFixed(0)}% but random play wins ${(c.random * 100).toFixed(0)}%.\n  ${c.policy}: ${ev.diag[`${c.policy}|${c.level}`]}\n  random: ${ev.diag[`random|${c.level}`]}\n  Find the bug in how ${c.policy} handles this goal.`).join('\n')}\nImprove the weaker bots and reply with the full module.`
    const weakest = ev.table && TEST_LEVELS.map(l => ({ l, gap: ev.table.lookahead[l].p - Math.max(ev.table.greedy[l].p, ev.table.random[l].p) })).sort((a, b) => a.gap - b.gap).slice(0, 2)
    const extra = (weakest && !ev.errors.length ? '\nWhere the expert is weakest:\n' + weakest.map(({ l }) => `  L${l + 1} ${levels[l].name}: lookahead ${ev.diag[`lookahead|${l}`]}`).join('\n') : '') +
      (prevCode === code ? '\nNOTE: your module is identical to the previous one. Change the logic, not just the comments.' : '')
    prevCode = code
    const FENCE = '`'.repeat(3)
    const regress = best && best.round !== round
      ? `\nThat version scored worse than your best so far (round ${best.round}: ${PERSONAS.map(p => `${p} ${(best.ev.table[p].overall.p * 100).toFixed(0)}%`).join(', ')}). Start again from that best version:\n${FENCE}js\n${best.code}\n${FENCE}`
      : ''
    messages.push({ role: 'assistant', content: '```js\n' + code + '\n```' }, { role: 'user', content: feedback + extra + regress })
  }
  if (!best) throw new Error('the LLM never produced runnable bots')
  await writeFile(file, `// Written by ${best.model}, round ${best.round} (monotonic: ${best.ev.ok})\n${best.code}`)
  return { file, ...best }
}
