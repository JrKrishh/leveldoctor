// LEVEL DOCTOR on CONTAINMENT: the LLM writes three stealth bots as code, the agent plays them in the real game
// (headless browser, each bot's code runs inside the page), and feeds back what a tester would report until
// skill ranks correctly. usage: node games/containment/agent.mjs   → out/containment-policies.mjs
import '../../src/env.mjs'
import { writeFile, appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chat, codeBlock, llmName } from '../../src/llm.mjs'
import { runContainment } from './batch.mjs'

const OUT = 'out', PERSONAS = ['random', 'regular', 'expert'], DIFFS = ['story', 'normal'], N = +process.env.N || 6
const say = (...a) => console.log(...a)

export const BRIEF = `GAME: CONTAINMENT, a first-person stealth game on a grid map (each cell is 3 units; world position of cell (cx, cz) is ((cx+0.5)*3, (cz+0.5)*3)).
GOAL: pull 3 server cores (stand within 2 units of a core and HOLD E for 2 seconds; starting a pull makes a loud noise the hunter hears), then go to the lift and hold E within 2 units of it. That wins.
THE HUNTER: a drone (o.warden) patrols, hears noise, and hunts by sight: it sees you from 13 units with your flashlight on, 5 units with it off, and crouching cuts its sight further. If it gets within ~1.1 units it catches you and the run is lost. Its state is 'patrol', 'search' or 'chase'. Walk 3.2 u/s, run (ShiftLeft) 5.6 u/s but loud and drains stamina, crouch (KeyC) 1.7 u/s. Drone speeds: patrol 1.8, search 2.5, chase 3.9 u/s, so you cannot outrun a chase for long: break line of sight, go dark, hide.
Cameras (o.cameras) report you to the hunter if you walk into their cone (range 6.5). Lockers (o.lockers): stand next to one and press E to hide inside; press E again to step out. A hidden player is safe unless the drone saw you go in. Decoys (KeyQ, o.player.decoys) are thrown where you look and distract the drone.
Use E only at cores, the lift and lockers (E at terminals or laptops opens dialogues and hacking you should skip).

OBSERVATION o (called every 0.2 s):
{ t, cell: 3, rows: map strings ('#' wall),
  player: { x, z, cx, cz, yaw, stamina, battery, lightOn, decoys, emps, hidden },
  warden: { x, z, state, suspicion },
  cores: [{ x, z, pulled }] (cells), lift: { x, z } (cell), lockers: [{ x, z }], cameras: [{ x, z }], camsOffline,
  walkable(cx, cz), center(cx, cz) -> { x, z }, path(tx, tz) -> [[cx, cz], ...] shortest walkable path from you to a cell ([] if unreachable),
  yawTo(x, z) -> the yaw that faces a world point, dist(x, z) -> distance from you }
ACTION: return { yaw, keys, press }: yaw = facing angle (use o.yawTo); keys = keys to HOLD this step, e.g. ['KeyW'] to walk forward, ['KeyW','ShiftLeft'] to run, ['KeyW','KeyC'] to sneak, ['KeyE'] to hold E; press = keys to TAP once, e.g. ['KeyF'] toggles the flashlight, ['KeyQ'] throws a decoy, ['KeyE'] enters or leaves a locker.
To walk along a path: next = o.center(...path[0]); return { yaw: o.yawTo(next.x, next.z), keys: ['KeyW'] }.
A bot is (o, rng) => action; rng() is uniform in [0,1); never use Math.random. Keep any memory in variables outside the function (one bot plays one run at a time).`

const TASK = `Write THREE bots of increasing skill as ONE JavaScript object literal (not a module, no export), exactly:
{
  random: (o, rng) => ...,   // casual: wanders to random walkable cells, flashlight on, pulls a core only if it happens to stand next to one
  regular: (o, rng) => ...,  // regular: goes core by core along o.path, holds E at each, then the lift; turns the flashlight off when the drone is within 15 units; when the drone chases, runs away and hides in the nearest locker if one is close
  expert: (o, rng) => ...,   // expert: plays stealth: flashlight off almost always, sneaks (KeyC) when the drone is near, picks the next core that keeps distance from the drone, waits out patrols, avoids camera cells, hides in lockers early, throws decoys away from its route when hunted
}
Helper functions and state variables may be declared INSIDE an IIFE that returns the object: (() => { let mem = {}; const helper = ...; return { random: ..., regular: ..., expert: ... } })()
Reply with that expression in ONE \`\`\`js code block.`

async function evaluate(file, code) {
  const tasks = PERSONAS.flatMap(policy => DIFFS.flatMap(difficulty => Array.from({ length: N }, (_, k) => ({ policy, difficulty, seed: 100 + k }))))
  const t0 = Date.now()
  const rows = await runContainment(tasks, code, { workers: +process.env.WORKERS || 4 })
  const errors = [...new Set(rows.filter(r => r.error).map(r => `${r.policy}: ${r.error}`))]
  const table = {}
  for (const p of PERSONAS) {
    const m = rows.filter(r => r.policy === p), ends = {}
    for (const r of m) ends[r.mode] = (ends[r.mode] || 0) + 1
    table[p] = { wins: m.filter(r => r.win).length, n: m.length, score: m.reduce((s, r) => s + r.cores + (r.win ? 1 : 0), 0) / m.length,
      cores: +(m.reduce((s, r) => s + r.cores, 0) / m.length).toFixed(2), time: +(m.reduce((s, r) => s + r.time, 0) / m.length).toFixed(1), spotted: +(m.reduce((s, r) => s + r.spotted, 0) / m.length).toFixed(1), ends }
  }
  const [a, b, c] = PERSONAS.map(p => table[p].score)
  return { ok: !errors.length && a < b && b < c, errors, table, minutes: +((Date.now() - t0) / 60000).toFixed(1), runs: rows.length }
}

const fmt = t => PERSONAS.map(p => `${p}: wins ${t[p].wins}/${t[p].n}, avg cores ${t[p].cores}, avg time ${t[p].time}s, spotted ${t[p].spotted}x, runs ended ${JSON.stringify(t[p].ends)}`).join('\n')

export async function writeContainmentBots(rounds = +process.env.ROUNDS || 5) {
  await mkdir(OUT, { recursive: true })
  const messages = [{ role: 'system', content: 'You are a senior game AI programmer. You write small, correct, dependency-free JavaScript.' }, { role: 'user', content: BRIEF + '\n\n' + TASK }]
  let best = null
  for (let round = 1; round <= rounds; round++) {
    say(`round ${round}: ${llmName()} is writing CONTAINMENT bots…`)
    const stream = []
    const { text, model } = await chat(messages, { stream: c => stream.push(c) })
    const code = codeBlock(text)
    if (!code) { messages.push({ role: 'assistant', content: text.slice(-2000) }, { role: 'user', content: 'Reply with only the ```js expression.' }); say('  no code block'); continue }
    const file = path.join(OUT, `containment-policies.round${round}.js`)
    await writeFile(file, `// Written by ${model}, round ${round}\n${code}`)
    await writeFile(path.join(OUT, `containment-llm-stream-round${round}.json`), JSON.stringify({ model, round, chunks: stream }))
    let ev
    try { (0, eval)('(' + code + ')'); ev = await evaluate(file, code) } catch (e) { ev = { ok: false, errors: [String(e.message).slice(0, 300)], table: null } }
    await appendFile(path.join(OUT, 'containment-agent-log.jsonl'), JSON.stringify({ round, eval: ev }) + '\n')
    say(ev.table ? `round ${round}: ${ev.runs} playtests in ${ev.minutes} min → ` + PERSONAS.map(p => `${p} ${ev.table[p].wins}/${ev.table[p].n} wins, ${ev.table[p].cores} cores`).join(' · ') + (ev.ok ? '  SKILL RANKS CORRECTLY ✓' : '') : `round ${round}: failed: ${ev.errors.join(' | ').slice(0, 200)}`)
    if (ev.table && !ev.errors.length) { const [a, b, c] = PERSONAS.map(p => ev.table[p].score), score = Math.min(b - a, c - b); if (!best || ev.ok > best.ev.ok || (ev.ok === best.ev.ok && score > best.score)) best = { round, code, ev, score, model } }
    if (ev.ok) break
    const fb = ev.table && !ev.errors.length
      ? `Measured in the real game (${N} runs per bot per difficulty, story and normal):\n${fmt(ev.table)}\nRequired: random < regular < expert (score = cores pulled + 1 for escaping). A run that ends in 'play' timed out (300 s): the bot stalled or wandered. 'dead' means the drone caught it. Improve the weaker bots and reply with the full expression.`
      : `Running your bots failed:\n${(ev.errors || []).join('\n')}\nFix it and reply with the full expression.`
    messages.push({ role: 'assistant', content: '```js\n' + code + '\n```' }, { role: 'user', content: fb })
  }
  if (!best) throw new Error('no runnable CONTAINMENT bots')
  const file = path.join(OUT, 'containment-policies.js')
  await writeFile(file, `// Written by ${best.model}, round ${best.round} (skill ranks correctly: ${best.ev.ok})\n${best.code}`)
  return { ...best, file }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const r = await writeContainmentBots()
  say(`kept round ${r.round} (${r.model}) → ${r.file}`)
}
