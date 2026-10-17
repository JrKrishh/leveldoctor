// Builds the narrated demo video from the real results: TTS narration (edge-tts), the stage page recorded by
// Playwright, game music underneath, muxed by ffmpeg into demo/leveldoctor-demo.mp4.
// usage: node demo/build-video.mjs [results.json]   (needs demo/traces.json and out/doctor.log)
import { readFile, writeFile, mkdir, copyFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
const cross = await readJson('out/cross-check.json')
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
  title: `This is Level Doctor. I shipped a game-jam game with twenty levels, and tuning them by hand took three rounds of guessing. Level Doctor is an agent that writes its own bot players, playtests the game thousands of times, finds out why players lose, and fixes the levels.`,
  code: `Step one: the agent writes code. A language model reads the game's rules and writes three bots, casual, regular and expert, as JavaScript. The agent runs them in the real game and feeds the measured pass rates back until skill ranks correctly.${lastOk ? ` Here that took ${lastOk.round} round${lastOk.round > 1 ? 's' : ''}.` : ''}`,
  run: `Step two: it runs its code. The real, unmodified game runs headless with a virtual clock, a fraction of a second per level, and the same seed replays byte for byte. ${res.runs.total.toLocaleString('en-US')} playtests ${createos ? `inside a CreateOS sandbox${stripeOk ? ' provisioned with Stripe Projects' : ''}` : 'on parallel local workers'}, each number with a ninety-five percent error bar.`,
  chaos: `Step three is a metric I couldn't find in any existing tool: the Chaos Ratio. This is ${ch.name}. Same seed, same bot. The only difference: the fourth drop moved by one ten-thousandth of a unit. One run ${ch.a.win ? 'wins' : 'loses'}. The other ${ch.b.win ? 'wins' : 'loses'}.`,
  chaosChart: `Do that for every level and losses split into two kinds.${dice.length ? ` On ${dice.slice(0, 2).map(l => l.name).join(' and ')}, they're dice rolls.` : ''}${traps.length ? ` On ${traps.slice(0, 2).map(l => l.name).join(' and ')}, they're traps a designer can fix.` : ''} Pass rate alone can't tell them apart.`,
  tempo: `Step four: twist exposure. This level is called Bass Drop. A bot at typical bot speed clears it in ${tp.fast.time.toFixed(0)} seconds, before the first bass drop. It calls the level fine without ever hearing its twist. Level Doctor's bots play at human speed, and every twist gets an exposure check.`,
  stack: `Here's the stack.${stripeOk ? ' Stripe Projects set it up from the terminal: init, add CreateOS, and the credentials land in the env file.' : ''} Every batch runs in a CreateOS sandbox with its network locked down, because the bots are code an LLM wrote. A request from inside the sandbox fails. And the same seed gives the same result in the sandbox as on my laptop, hash for hash.`,
  fix: `Finally, the fix. One batch with unlimited drops gives the pass rate for every possible drop limit. The agent picks the limit that hits the target and re-tests it with fresh seeds. ${patched.length ? `${patched.length} level${patched.length > 1 ? 's' : ''} re-tuned, ${verified.length} verified within error bars.` : 'Every level landed inside the target band.'}`,
  orbital: orbital ? `And it isn't tied to one game. On an endless arcade game, the same agent wrote new bots, found which difficulty knob actually matters, and tuned it so a regular player reaches ${orbital.passT} seconds about half the time${orbital.verify.inBand ? ', verified' : ''}.` : '',
  outro: `Level Doctor. Ten years of triple-A playtesting research, in five minutes, for indie web games. ${createos && stripeOk ? 'Built on CreateOS and Stripe Projects.' : createos ? 'Built on CreateOS.' : 'Built for CreateOS and Stripe Projects.'}`,
}
const order = ['title', 'code', 'run', 'stack', 'chaos', 'chaosChart', 'tempo', 'fix', ...(orbital ? ['orbital'] : []), 'outro']

// ---------- narration ----------
const durations = {}
for (const k of order) {
  const file = path.join(WORK, 'audio', `${k}.mp3`)
  const cached = path.join(DEMO, 'tts-cache', createHash('sha1').update(VOICE + '|' + say[k]).digest('hex') + '.mp3')
  if (existsSync(cached)) await copyFile(cached, file)
  else for (let attempt = 1; ; attempt++) {   // the online voice drops connections now and then; fall back to the offline Windows voice
    try { execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate', '+4%', '--text', say[k], '--write-media', file], { stdio: 'pipe', timeout: 60000 }); await mkdir(path.dirname(cached), { recursive: true }); await copyFile(file, cached); break }
    catch (e) {
      if (attempt < 3) { await new Promise(r => setTimeout(r, 3000 * attempt)); continue }
      const txt = path.join(WORK, 'audio', `${k}.txt`), wav = path.join(WORK, 'audio', `${k}.wav`)
      await writeFile(txt, say[k])
      execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft David Desktop'); $s.Rate = 1; $s.SetOutputToWaveFile('${wav}'); $s.Speak((Get-Content -Raw '${txt}')); $s.Dispose()`], { stdio: 'pipe' })
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, file], { stdio: 'pipe' })
      console.log(`  ${k}: online voice unavailable, used the offline Windows voice`)
      break
    }
  }
  durations[k] = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()
}
const PAD = { title: 1.0, stack: 1.0, chaos: 2.0, tempo: 1.5, outro: 1.5 }
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
  if (orbital) {
    await (await p.$('#orbcurve')).screenshot({ path: path.join(DEMO, 'shots', 'orbital-curve.png') })
    await (await p.$('#orbtable table')).screenshot({ path: path.join(DEMO, 'shots', 'orbital-knobs.png') })
  }
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
    ...(cross ? [`full diagnosis: ${cross.runs[0].toLocaleString('en-US')} playtests in the sandbox → ${cross.levelsIdentical}/${cross.levels} levels identical to local ✓`] : []),
  ],
  backendLabel: createos ? 'inside a CreateOS sandbox' : 'on local workers',
  chaosBullets: [
    ...dice.slice(0, 3).map(l => `🎲 <b>${l.name}</b>: C = ${l.chaos.C.toFixed(2)}. Losses are dice rolls: soften the chaos, not the drop limit.`),
    ...traps.slice(0, 2).map(l => `🪤 <b>${l.name}</b>: C = ${l.chaos.C.toFixed(2)}. Losses are reproducible traps: find them and fix them.`),
  ],
  tempoText: `Bot speed: cleared in ${tp.fast.time.toFixed(1)} s. The first bass drop comes at ${tp.firstBass.toFixed(1)} s. It never happened.<br><br>Human speed: ${tp.slow.time.toFixed(1)} s, with every bass drop.`,
  fixBadges: [`${res.runs.total.toLocaleString('en-US')} playtests`, `${patched.length} levels re-tuned`, `${verified.length} verified in band`, `funnel: ${Math.round(res.funnel.before.at(-1) * 100)}% → ${Math.round(res.funnel.after.at(-1) * 100)}% finish`],
  timeline, total, url: process.env.LD_URL || '', stripeOk, reportUrl: existsSync(path.join(ROOT, 'out', 'report-url.txt')) ? (await readFile(path.join(ROOT, 'out', 'report-url.txt'), 'utf8')).trim() : '',
}
await writeFile(path.join(DEMO, 'stage-data.js'), 'window.STAGE = ' + JSON.stringify(stage).replace(/</g, '\\u003c'))
// Frame-by-frame capture on a virtual clock: set the time, screenshot, repeat. Live screen recording drops
// frames under load and drifts against the narration; this can't.
const FPS = 24, frames = path.join(WORK, 'frames')
await mkdir(frames, { recursive: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(pathToFileURL(path.join(DEMO, 'stage.html')).href)
await page.waitForFunction('window.READY === true', null, { timeout: 30000 })
await page.waitForTimeout(500)   // fonts
const nFrames = Math.ceil(total * FPS)
for (let i = 0; i < nFrames; i++) {
  await page.evaluate(t => window.renderAt(t), i / FPS)
  await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 })
  if (i % (FPS * 20) === 0) process.stdout.write(`  frames ${i}/${nFrames}\n`)
}
await browser.close()

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
execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), mp4], { stdio: 'pipe' })
await writeFile(path.join(DEMO, 'narration.txt'), order.map(k => `[${k}] ${say[k]}`).join('\n\n'))
console.log(`video → ${path.relative(ROOT, mp4)} (${total.toFixed(1)} s, ${nFrames} frames at ${FPS} fps)`)
