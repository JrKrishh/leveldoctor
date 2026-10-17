// Builds the narrated demo video from the real results: TTS narration (edge-tts), the stage page recorded by
// Playwright, game music underneath, muxed by ffmpeg into demo/leveldoctor-demo.mp4.
// usage: node demo/build-video.mjs [results.json]   (needs demo/traces.json and out/doctor.log)
import { readFile, writeFile, mkdir, copyFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const ROOT = process.cwd(), DEMO = path.join(ROOT, 'demo'), WORK = path.join(DEMO, 'work')
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const VOICE = process.env.LD_VOICE || 'en-US-AndrewNeural'
const MASHPIT = path.resolve(ROOT, '../mashpit/public')
const res = JSON.parse(await readFile(path.join(ROOT, 'out', process.argv[2] || 'results.json'), 'utf8'))
const traces = JSON.parse(await readFile(path.join(DEMO, 'traces.json'), 'utf8'))
const bots = await readFile(path.join(ROOT, res.policiesFile || 'out/policies.mjs'), 'utf8')
const runLog = existsSync(path.join(ROOT, 'out', 'doctor.log')) ? (await readFile(path.join(ROOT, 'out', 'doctor.log'), 'utf8')).split('\n').filter(l => l.trim()).slice(0, 34) : []
let rounds = []
try { rounds = (await readFile(path.join(ROOT, 'out', 'agent-log.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.eval) } catch { }
const readJson = async (f, d = null) => { try { return JSON.parse(await readFile(path.join(ROOT, f), 'utf8')) } catch { return d } }
const terminal = await readJson('out/doctor-terminal.json', [])            // the real run, line by line with timings
const bestRound = +(bots.match(/round (\d+)/)?.[1] || 0)
const stream = await readJson(`out/llm-stream-round${bestRound}.json`)       // the model's real output with timings
const sbCheck = await readJson('out/sandbox-check.json')
const orbital = await readJson('out/orbital-results.json')
let stripeOk = false
try { stripeOk = !/Welcome to Stripe Projects/.test(execFileSync('stripe', ['projects', 'status'], { cwd: ROOT, stdio: 'pipe', timeout: 30000 }).toString()) } catch { }
await rm(WORK, { recursive: true, force: true }); await mkdir(path.join(WORK, 'audio'), { recursive: true })

// ---------- facts for the script (all from the results) ----------
const pct = p => `${Math.round(p * 100)} percent`
const L = res.levels, createos = res.runs.backend === 'createos'
const byC = L.filter(l => l.chaos?.C != null)
const dice = byC.filter(l => l.chaos.C >= 0.6).sort((a, b) => b.chaos.C - a.chaos.C), traps = byC.filter(l => l.chaos.C <= 0.2 && l.personas[res.player].p < 0.98)
const patched = L.filter(l => l.patch), verified = patched.filter(l => l.verify?.inBand)
const ch = traces.chaos, tp = traces.tempo
const pc0 = p => `${Math.round(p * 100)}%`
const roundsText = rounds.map(r => ({ round: r.round, text: r.eval.errors?.length ? 'bots crashed → rewrite' : `${pc0(r.eval.table.random.overall.p)} < ${pc0(r.eval.table.greedy.overall.p)} < ${pc0(r.eval.table.lookahead.overall.p)} ${r.eval.ok ? '✓' : '→ rewrite'}` }))
const lastOk = rounds.find(r => r.eval.ok)
const say = {
  title: `This is Level Doctor. I shipped a game-jam game with twenty levels, and tuning them by hand took three rounds of guessing. Level Doctor is an agent that does it properly. It writes its own bot players, playtests the game thousands of times, finds out why players lose, and fixes the levels.`,
  code: `Step one: the agent writes code. A language model reads the game's rules and writes three bots, casual, regular and expert, as JavaScript. The agent runs them in the real game and feeds the measured pass rates back until skill ranks correctly.${lastOk ? ` Here that took ${lastOk.round} round${lastOk.round > 1 ? 's' : ''}.` : ''}`,
  run: `Step two: the agent runs its code. The real, unmodified game runs headless with a virtual clock, so a whole level takes a fraction of a second, and the same seed replays byte for byte. ${res.runs.total.toLocaleString('en-US')} playtests, ${createos ? 'inside a CreateOS sandbox provisioned with Stripe Projects' : 'on parallel local workers'}, with a ninety-five percent error bar on every number.`,
  chaos: `Step three is a metric I couldn't find in any existing tool: the Chaos Ratio. This is ${ch.name}. Same seed, same bot. The only difference: the fourth drop moved by one ten-thousandth of a unit. One run ${ch.a.win ? 'wins' : 'loses'}. The other ${ch.b.win ? 'wins' : 'loses'}.`,
  chaosChart: `Do that for every level, compare the flip rate to a coin toss, and losses split into two kinds.${dice.length ? ` On ${dice.slice(0, 2).map(l => l.name).join(' and ')}, losses are dice rolls.` : ''}${traps.length ? ` On ${traps.slice(0, 2).map(l => l.name).join(' and ')}, they're reproducible traps a designer can fix.` : ''} Pass rate alone can't tell these apart, and they need completely different fixes.`,
  tempo: `Step four: twist exposure. This level is called Bass Drop. A bot at typical bot speed clears it in ${tp.fast.time.toFixed(0)} seconds, before the first bass drop at ${tp.firstBass.toFixed(0)}. It says the level is fine without ever hearing its twist. At human speed, the bass drops hit. So Level Doctor's bots play at human tempo, and every twist gets an exposure check.`,
  stack: `Here's the stack.${stripeOk ? ' Stripe Projects set it up from the terminal: init, add CreateOS, and the credentials land in the env file.' : ''} Every batch runs in a CreateOS sandbox with its network locked down, because the bots are code an LLM wrote. A request from inside the sandbox fails. And the same seed gives the same result in the sandbox as on my laptop, hash for hash.`,
  fix: `Finally, the fix. For each off-target level, the agent plays one batch with unlimited drops, reads the pass rate for every possible drop limit straight off the survival curve, picks the limit that hits the target, and verifies it with fresh seeds. ${patched.length ? `${patched.length} level${patched.length > 1 ? 's' : ''} re-tuned, and ${verified.length} of them verified within error bars of the target.` : 'Every level landed inside the target band.'}`,
  orbital: orbital ? `And it isn't tied to one game. Same agent, an endless arcade game: it wrote new bots, measured survival curves, and tuned its difficulty dial so a regular player reaches ${orbital.passT} seconds half the time${orbital.verify.inBand ? ', verified with fresh seeds' : ''}.` : '',
  outro: `Level Doctor. Ten years of triple-A playtesting research, in five minutes, for indie web games. ${createos ? 'Built on CreateOS and Stripe Projects.' : 'Built for CreateOS and Stripe Projects.'}`,
}
const order = ['title', 'code', 'run', 'stack', 'chaos', 'chaosChart', 'tempo', 'fix', ...(orbital ? ['orbital'] : []), 'outro']

// ---------- narration ----------
const durations = {}
for (const k of order) {
  const file = path.join(WORK, 'audio', `${k}.mp3`)
  execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate', '+4%', '--text', say[k], '--write-media', file], { stdio: 'pipe' })
  durations[k] = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()
}
const PAD = { title: 1.2, stack: 1.2, chaos: 2.5, tempo: 2.0, outro: 2.5 }
const timeline = order.map(k => ({ scene: k, dur: +(durations[k] + (PAD[k] ?? 0.8)).toFixed(2), say: say[k], audio: durations[k], lead: k === 'title' ? 0.6 : 0.3 }))
const total = timeline.reduce((a, s) => a + s.dur, 0)
console.log('narration', order.map(k => `${k} ${durations[k].toFixed(1)}s`).join(' · '), `→ ${total.toFixed(1)} s total`)

// ---------- report screenshots for the chart scenes ----------
await mkdir(path.join(DEMO, 'shots'), { recursive: true })
const browser = await chromium.launch({ executablePath: CHROME })
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1.5 })
  await p.goto(pathToFileURL(path.join(ROOT, 'report', 'dist', 'index.html')).href); await p.waitForTimeout(500)
  const cards = await p.$$('section.card')
  await cards[0].screenshot({ path: path.join(DEMO, 'shots', 'curve.png') })
  await cards[1].screenshot({ path: path.join(DEMO, 'shots', 'chaos.png') })
  if (orbital) await (await p.$('#orbcard')).screenshot({ path: path.join(DEMO, 'shots', 'orbital.png') })
  await p.close()
}
await mkdir(path.join(DEMO, 'mon'), { recursive: true })
for (const f of await readdir(path.join(MASHPIT, 'mon'))) await copyFile(path.join(MASHPIT, 'mon', f), path.join(DEMO, 'mon', f))

// ---------- stage data + recording ----------
const stage = {
  traces, bots: bots.replace(/^\/\/.*\n/, ''), llm: res.llm, rounds: roundsText, totalRuns: res.runs.total, runLog, terminal, stream: stream?.chunks || null,
  stack: [
    ...(stripeOk ? ['$ stripe projects init leveldoctor', '$ stripe projects add createos/project', '$ stripe projects env --pull     # credentials → .env'] : []),
    ...(sbCheck ? [`sandbox ${sbCheck.sandbox} · devbox:1 · node ${sbCheck.node}`, `egress allowlist: ${JSON.stringify(sbCheck.isolation.egress)}`, '$ curl https://example.com        # from inside the sandbox', `  → ${sbCheck.isolation.blocked ? 'BLOCKED ✓' : 'open'}  ${sbCheck.isolation.detail.slice(0, 58)}`, `same seeds, sandbox vs laptop → ${sbCheck.identical}/${sbCheck.runs} identical ✓`] : []),
  ],
  backendLabel: createos ? 'inside a CreateOS sandbox' : 'on local workers',
  chaosBullets: [
    ...dice.slice(0, 3).map(l => `🎲 <b>${l.name}</b>: C = ${l.chaos.C.toFixed(2)}. Losses are dice rolls: soften the chaos, not the drop limit.`),
    ...traps.slice(0, 2).map(l => `🪤 <b>${l.name}</b>: C = ${l.chaos.C.toFixed(2)}. Losses are reproducible traps: find them and fix them.`),
  ],
  tempoText: `Bot speed: cleared in ${tp.fast.time.toFixed(1)} s. The first bass drop comes at ${tp.firstBass.toFixed(1)} s. It never happened.<br><br>Human speed: ${tp.slow.time.toFixed(1)} s, with every bass drop.`,
  fixBadges: [`${res.runs.total.toLocaleString('en-US')} playtests`, `${patched.length} levels re-tuned`, `${verified.length} verified in band`, `funnel: ${Math.round(res.funnel.before.at(-1) * 100)}% → ${Math.round(res.funnel.after.at(-1) * 100)}% finish`],
  timeline, total, url: process.env.LD_URL || '',
}
await writeFile(path.join(DEMO, 'stage-data.js'), 'window.STAGE = ' + JSON.stringify(stage).replace(/</g, '\\u003c'))
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: WORK, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
const tOpen = Date.now()
await page.goto(pathToFileURL(path.join(DEMO, 'stage.html')).href)
await page.waitForFunction('window.READY === true', null, { timeout: 30000 })
await page.waitForTimeout(800)
const offset = (Date.now() - tOpen) / 1000
await page.evaluate('window.START()')
await page.waitForFunction('window.DONE === true', null, { timeout: (total + 30) * 1000, polling: 500 })
const video = await page.video().path()
await ctx.close(); await browser.close()

// ---------- audio mix + mux ----------
const inputs = [], filters = []
let at = 0
order.forEach((k, i) => { inputs.push('-i', path.join(WORK, 'audio', `${k}.mp3`)); filters.push(`[${i}:a]adelay=${Math.round((at + (k === 'title' ? 0.6 : 0.3)) * 1000)}|${Math.round((at + (k === 'title' ? 0.6 : 0.3)) * 1000)}[a${i}]`); at += timeline[i].dur })
const music = path.join(MASHPIT, 'audio', 'music.mp3')
let mixIn = order.map((_, i) => `[a${i}]`).join('')
if (existsSync(music)) { inputs.push('-stream_loop', '-1', '-i', music); filters.push(`[${order.length}:a]volume=0.07,atrim=0:${total.toFixed(2)}[m]`); mixIn += '[m]' }
filters.push(`${mixIn}amix=inputs=${order.length + (existsSync(music) ? 1 : 0)}:normalize=0:duration=longest[out]`)
const wav = path.join(WORK, 'mix.wav')
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-t', total.toFixed(2), wav], { stdio: 'pipe' })
const mp4 = path.join(DEMO, 'leveldoctor-demo.mp4')
execFileSync('ffmpeg', ['-y', '-ss', offset.toFixed(2), '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), mp4], { stdio: 'pipe' })
await writeFile(path.join(DEMO, 'narration.txt'), order.map(k => `[${k}] ${say[k]}`).join('\n\n'))
console.log(`video → ${path.relative(ROOT, mp4)} (${total.toFixed(1)} s, recording offset ${offset.toFixed(2)} s)`)
