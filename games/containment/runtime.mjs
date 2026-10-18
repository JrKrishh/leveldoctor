// Third test subject: CONTAINMENT (3D first-person stealth, three.js, hosted on Jabali). Unlike Mash Pit and
// ORBITAL there is no source to bundle, so the real hosted game runs in headless Chromium. It exposes a debug
// handle, window.__game, with step(dt) (simulation only, 1/30 s ticks), state, and begin(difficulty, checkpoint).
// The harness loads the game once per worker, blocks its analytics (bot runs must not count as plays), stops the
// render loop, and plays whole runs inside the page with seeded randomness.
import { chromium } from 'playwright'
import path from 'node:path'

export const GAME_URL = process.env.CONTAINMENT_URL || 'https://games.jabali.ai/236edb21-23ec-45dd-be34-1e36b1c6da1a/756f859a-1e84-4927-8d6d-fe9f0406f301/?demo=true'
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const BLOCK = /jabali-metrics|google|doubleclick|facebook|tiktok|reddit|appsflyer|cookiebot|analytics/i

// Runs inside the page before the game's own scripts.
const INIT = () => {
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = cb => (window.__ldHold ? 0 : raf(cb))   // once held, the render loop stops
  try { window.speechSynthesis.speak = () => {}; window.speechSynthesis.cancel = () => {} } catch { }
  window.__ldMulberry = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
}

// The game keeps hidden state across runs (the warden's timers, event schedulers), so every playtest starts from a
// fresh boot of the real game. Files are cached in memory after the first download: reboots never hit the server.
const cache = new Map()
// The simulation needs no pixels or sound: textures are served as a 1x1 image and audio files are skipped,
// which makes a boot far cheaper (set LD_FULL_ASSETS=1 to load everything, e.g. to watch a run).
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const LIGHT = !process.env.LD_FULL_ASSETS
export async function openGame({ headless = true } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const context = await browser.newContext({ viewport: LIGHT ? { width: 160, height: 120 } : { width: 640, height: 480 } })
  const blocked = []
  await context.route('**/*', async route => {
    try {
      const req = route.request(), u = req.url()
      if (BLOCK.test(u)) { blocked.push(u); return await route.abort() }
      if (LIGHT && /\.(jpe?g|png|webp|ktx2|hdr|exr)(\?|$)/i.test(u)) return await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
      if (LIGHT && /\.(mp3|ogg|wav|m4a|aac)(\?|$)/i.test(u)) return await route.abort()
      if (req.method() !== 'GET') return await route.continue()
      let hit = cache.get(u)
      if (!hit) {
        const resp = await route.fetch(), headers = { ...resp.headers() }
        for (const h of ['content-encoding', 'content-length', 'transfer-encoding']) delete headers[h]   // body() is already decoded
        hit = { status: resp.status(), headers, body: await resp.body() }
        if (resp.status() === 200 && !req.headers().range) cache.set(u, hit)   // never replay partial (206) media responses
      }
      return await route.fulfill(hit)
    } catch { }   // requests still in flight when the browser closes
  })
  await context.addInitScript(INIT)
  const page = await context.newPage()
  page.on('dialog', d => d.accept().catch(() => {}))   // "leave page?" on reboot: yes
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const boot = async () => {
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction('window.__game && window.__game.level && window.__game.level.rows', null, { timeout: 180000 })
    await page.evaluate(() => { window.__ldHold = true })
  }
  await boot()
  return { browser, page, blocked, errors, reboot: boot, close: () => browser.close() }
}

// A fresh-start checkpoint in the game's own save format (what it writes to localStorage at level start).
export const freshCheckpoint = difficulty => ({ v: 1, floor: 'sub3', difficulty, deaths: 0, trust: 0, elapsed: 0, notes: [], terminals: [], reacted: [], revealed: false, decoys: 3, emps: 0, equip: { nv: false, vest: false, tracker: false }, gift: 'none', cores: [], taken: [], laptops: [], pillars: [], keypadOpen: false, capacitors: [], desks: [], stats: { spotted: 0, cams: 0, hacks: 0, emps: 0, decoys: 0, desks: 0 } })

/**
 * Plays one run inside the page. `policySrc` is the source of a module-like object literal
 * `{ name: (o, rng) => action }`; an action is { yaw?, keys?: ['KeyW', ...held], press?: ['KeyF', ...tapped] }.
 */
export async function runEpisode(page, { policySrc, policy, seed = 1, difficulty = 'normal', maxTime = 300, decide = 0.2, trace = false, setup = '' }) {
  return page.evaluate(async ({ policySrc, policy, seed, difficulty, maxTime, decide, cp, trace, setup }) => {
    const g = window.__game
    const bots = (0, eval)('(' + policySrc + ')')
    const bot = bots[policy]
    const held = new Set()
    const key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }))
    const release = () => { for (const k of held) key(k, false); held.clear() }
    release()
    Math.random = window.__ldMulberry(seed * 2654435761)
    const rng = window.__ldMulberry(seed * 40503 + 17)
    try { localStorage.removeItem('containment-progress') } catch { }
    const tb = performance.now()
    g.begin(difficulty, cp)
    if (setup) (0, eval)('(g => {' + setup + '})')(g)   // tuning knobs (and dev experiments) applied after the run starts
    const beginMs = performance.now() - tb, tl = performance.now()
    const C = g.CELL, frames = []
    const cellOf = v => Math.floor(v / C)
    // Map helpers a player gets from the minimap: walkable cells, shortest path, which way to face.
    const rows = g.level.rows, H = rows.length, Wd = rows[0].length
    const solid = new Map()   // the game's own collision test (level.isWallAt, world coords) at each cell's center
    const walkable = (cx, cz) => { if (cz < 0 || cz >= H || cx < 0 || cx >= Wd) return false; const k = cz * Wd + cx; if (!solid.has(k)) solid.set(k, !!g.level.isWallAt((cx + 0.5) * C, (cz + 0.5) * C)); return !solid.get(k) }
    const center = (cx, cz) => ({ x: (cx + 0.5) * C, z: (cz + 0.5) * C })
    const path = (fx, fz, tx, tz) => {   // BFS over the grid; returns the cells after the start, [] if unreachable
      const key = (x, z) => z * Wd + x, prev = new Map([[key(fx, fz), -1]]), q = [[fx, fz]]
      while (q.length) {
        const [x, z] = q.shift()
        if (x === tx && z === tz) { const out = []; let k = key(x, z); while (k !== key(fx, fz)) { out.unshift([k % Wd, Math.floor(k / Wd)]); k = prev.get(k) } return out }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (walkable(nx, nz) && !prev.has(key(nx, nz))) { prev.set(key(nx, nz), key(x, z)); q.push([nx, nz]) } }
      }
      return []
    }
    const yawTo = (px, pz, x, z) => Math.atan2(-(x - px), -(z - pz))   // W moves along (-sin yaw, -cos yaw)
    let t = 0, err = null, spottedMax = 0, fakes = 0, dialogues = 0
    while (t < maxTime) {
      // the fake-death scare runs on real-time timers (3.3 s), then play resumes; terminal dialogues get answer 1
      if (g.mode === 'fake') { fakes++; await new Promise(r => setTimeout(r, 3500)); continue }
      if (g.mode === 'dialogue') { dialogues++; g.press('Digit1'); document.querySelector('#a1')?.click(); await new Promise(r => setTimeout(r, 50)); if (g.mode === 'dialogue') break; continue }
      if (g.mode !== 'play') break
      const w = g.warden, p = g.player
      const o = {
        t, cell: C, rows: g.level.rows,
        player: { x: p.x, z: p.z, cx: cellOf(p.x), cz: cellOf(p.z), yaw: p.yaw, stamina: p.stamina, battery: p.battery, lightOn: p.lightOn, decoys: p.decoys, emps: p.emps, hidden: !!g.hidden },
        warden: { x: w.group?.position?.x, z: w.group?.position?.z, state: w.state, suspicion: w.suspicion },
        cores: g.level.cores.map((c, i) => ({ x: c.x, z: c.z, pulled: !!g.world.cores?.[i]?.pulled })),
        lift: g.level.console, exit: g.level.exit, lockers: g.level.lockers, laptops: g.level.laptops, cameras: g.level.cameras, camsOffline: !!g.world.camsOffline,
        mode: g.mode, floor: g.floor,
        walkable, center,
        path: (tx, tz) => path(cellOf(p.x), cellOf(p.z), tx, tz),
        yawTo: (x, z) => yawTo(p.x, p.z, x, z),
        dist: (x, z) => Math.hypot(x - p.x, z - p.z),
      }
      let a
      try { a = bot(o, rng) || {} } catch (e) { err = String(e?.message || e); break }
      if (typeof a.yaw === 'number' && Number.isFinite(a.yaw)) p.yaw = a.yaw
      const want = new Set(a.keys || [])
      for (const k of [...held]) if (!want.has(k)) { key(k, false); held.delete(k) }
      for (const k of want) if (!held.has(k)) { key(k, true); held.add(k) }
      for (const k of a.press || []) { key(k, true); key(k, false) }
      g.step(decide); t += decide
      spottedMax = Math.max(spottedMax, g.stats.spotted)
      if (trace) frames.push([+t.toFixed(2), +p.x.toFixed(2), +p.z.toFixed(2), +(w.group?.position?.x ?? 0).toFixed(2), +(w.group?.position?.z ?? 0).toFixed(2), w.state])
    }
    release()
    const pulled = (g.world.cores || []).filter(c => c.pulled).length
    const r = { seed, difficulty, policy, mode: g.mode, floor: g.floor, time: +t.toFixed(2), cores: pulled, spotted: g.stats.spotted, deaths: g.memory?.deaths ?? null, fakes, dialogues,
      px: +g.player.x.toFixed(4), pz: +g.player.z.toFixed(4), wstate: g.warden.state, beginMs: Math.round(beginMs), loopMs: Math.round(performance.now() - tl), ...(err ? { error: err } : {}) }
    if (trace) r.frames = frames
    if (g.mode === 'play') g.freeze(true)
    return r
  }, { policySrc, policy, seed, difficulty, maxTime, decide, cp: freshCheckpoint(difficulty), trace, setup })
}
