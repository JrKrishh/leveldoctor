// Loads the patched copy of the game in a real browser: it must boot with no errors and carry the new drop limits.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DIST = path.resolve('out/mashpit-fixed/dist'), TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' }
const srv = createServer(async (req, res) => {
  try { const f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); const data = await readFile(f); res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(data) }
  catch { res.writeHead(404); res.end() }
}).listen(8123)
const CHROME = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const b = await chromium.launch({ executablePath: CHROME })
const p = await b.newPage({ viewport: { width: 400, height: 800 } })
const errors = []; p.on('pageerror', e => errors.push(e.message))
await p.goto('http://localhost:8123/')
await p.waitForFunction('window.__mp && window.__mp.LEVELS', null, { timeout: 15000 })
const drops = await p.evaluate(() => Object.fromEntries(window.__mp.LEVELS.map(l => [l.name, l.drops])))
const want = (await readFile('out/patch.diff', 'utf8')).match(/^\+ .*$/gm).map(l => [l.match(/name: '([^']+)'/)[1], +l.match(/drops: (\d+)/)[1]])
for (const [n, d] of want) console.log(`${n.padEnd(14)} drops ${drops[n]} ${drops[n] === d ? '✓ patched' : `✗ expected ${d}`}`)
await p.screenshot({ path: 'out/fixed-build.png' })
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'boots with no page errors')
await b.close(); srv.close()
