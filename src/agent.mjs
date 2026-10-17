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
  mons: [{tier, x, y, ice}], gifts: [{x, y}] }
A bot is a function (o, rng) => x. rng() returns a uniform number in [0,1); use it instead of Math.random.
The game clamps x so the monster stays inside the walls.`
}

const TASK = `Write THREE bot players of increasing skill as ONE JavaScript ES module:

export default {
  random: (o, rng) => ...,     // casual player: drops at a uniformly random x inside the walls
  greedy: (o, rng) => ...,     // regular player: drops onto the monster of the same tier as o.cur that is highest in the pile (smallest y) and not frozen; otherwise somewhere sensible
  lookahead: (o, rng) => ...,  // expert: tries ~20 candidate x positions, scores each (merge chances with same-tier neighbours near where the monster would land, keeping the pile low, avoiding the walls of big monsters, using o.next and the goal: gifts, ice), returns the best
}

Rules: pure functions of (o, rng); no imports, no globals, no Math.random; always return a finite number; keep each function under 60 lines; helper functions above the export are allowed.
Reply with the module in ONE \`\`\`js code block.`

async function log(entry) { await mkdir(OUT, { recursive: true }); await appendFile(path.join(OUT, 'agent-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n') }

/** Smoke test + monotonicity check in the runner. Returns { ok, table, errors }. */
export async function evaluate(file, { levels = [0, 8, 14], n = 24, tempo = 1.2 } = {}) {
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
  return { ok: !errors.length && a < b && b < c, table, errors, backend, ms, runs: rows.length }
}

const fmt = t => PERSONAS.map(p => `${p}: overall ${(t[p].overall.p * 100).toFixed(0)}% [${Object.entries(t[p]).filter(([k]) => k !== 'overall').map(([k, v]) => `L${+k + 1} ${(v.p * 100).toFixed(0)}%`).join(', ')}]`).join('\n')

export async function writePolicies({ levels, tiers, rounds = 4, onEvent = () => {} }) {
  const file = path.join(OUT, 'policies.mjs')
  const messages = [
    { role: 'system', content: 'You are a senior game AI programmer. You write small, correct, dependency-free JavaScript.' },
    { role: 'user', content: gameBrief(levels, tiers) + '\n\n' + TASK },
  ]
  let best = null
  for (let round = 1; round <= rounds; round++) {
    onEvent({ type: 'llm', round, model: llmName() })
    const { text, ms, model } = await chat(messages)
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
      const score = ev.table.lookahead.overall.p - ev.table.random.overall.p
      if (!best || ev.ok > best.ev.ok || (ev.ok === best.ev.ok && score > best.score)) best = { round, code, ev, score, model }
    }
    if (ev.ok) break
    const feedback = ev.errors.length
      ? `Running your bots failed:\n${ev.errors.join('\n')}\nFix the bugs and reply with the full module.`
      : `Measured pass rates (n=24 runs per level per bot, real game):\n${fmt(ev.table)}\nRequired: random < greedy < lookahead overall. ${ev.table.greedy.overall.p <= ev.table.random.overall.p ? 'greedy is not better than random: it probably stacks too high or ignores the goal. ' : ''}${ev.table.lookahead.overall.p <= ev.table.greedy.overall.p ? 'lookahead is not better than greedy: improve its scoring (pile height, merges, goal objects, next piece). ' : ''}Improve the weaker bots and reply with the full module.`
    messages.push({ role: 'assistant', content: '```js\n' + code + '\n```' }, { role: 'user', content: feedback })
  }
  if (!best) throw new Error('the LLM never produced runnable bots')
  await writeFile(file, `// Written by ${best.model}, round ${best.round} (monotonic: ${best.ev.ok})\n${best.code}`)
  return { file, ...best }
}
