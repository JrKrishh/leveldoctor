// Fills the narration cache (demo/tts-cache) with the online voice, retrying patiently, so the video build
// never has to fall back to the offline voice. Reads the lines from the last build's demo/narration.txt.
// usage: node demo/tts-warm.mjs
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const VOICE = process.env.LD_VOICE || 'en-US-AndrewNeural', DIR = 'demo/tts-cache'
await mkdir(DIR, { recursive: true })
const lines = (await readFile('demo/narration.txt', 'utf8')).split(/\n\n/).map(b => b.match(/^\[(\w+)\] ([\s\S]+)$/)).filter(Boolean)
for (const [, k, text] of lines) {
  const file = path.join(DIR, createHash('sha1').update(VOICE + '|' + text.trim()).digest('hex') + '.mp3')
  if (existsSync(file)) { console.log(`${k}: cached`); continue }
  for (let a = 1; a <= 8; a++) {
    try { execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate', '+4%', '--text', text.trim(), '--write-media', file], { stdio: 'pipe', timeout: 60000 }); console.log(`${k}: ok (attempt ${a})`); break }
    catch { if (a === 8) console.log(`${k}: FAILED`); else await new Promise(r => setTimeout(r, 5000 * a)) }
  }
}
