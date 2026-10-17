// Applies the verified patch to a COPY of the game and builds it (the live game is never touched).
// usage: node scripts/ship-fixed.mjs [results.json]  → out/mashpit-fixed/dist + out/patch.diff
import { readFile, writeFile, cp, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.cwd(), SRC = path.resolve(ROOT, '../mashpit'), DST = path.join(ROOT, 'out', 'mashpit-fixed')
const res = JSON.parse(await readFile(path.join(ROOT, 'out', process.argv[2] || 'results.json'), 'utf8'))
const fixes = res.levels.filter(l => l.patch && l.verify?.inBand)
await rm(DST, { recursive: true, force: true }); await mkdir(DST, { recursive: true })
for (const f of ['src', 'public', 'index.html', 'vite.config.js', 'package.json']) await cp(path.join(SRC, f), path.join(DST, f), { recursive: true })
if (!existsSync(path.join(DST, 'node_modules'))) execFileSync('cmd', ['/c', 'mklink', '/J', path.join(DST, 'node_modules'), path.join(SRC, 'node_modules')], { stdio: 'pipe' })

const file = path.join(DST, 'src', 'main.js')
let src = await readFile(file, 'utf8'), diff = ''
for (const l of fixes) {
  const esc = l.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "\\\\?'")
  const re = new RegExp(`(\\{ name: ['"]${esc}['"][^\\n]*?drops: )(\\d+)`)
  const m = src.match(re)
  if (!m) { console.log(`could not find L${l.i + 1} ${l.name}`); continue }
  const before = m[0], after = m[1] + l.patch.drops
  src = src.replace(before, after)
  diff += `- ${before.trim()}\n+ ${after.trim()}\n  # L${l.i + 1}: regular pass ${(l.personas[res.player].p * 100).toFixed(0)}% → verified ${(l.verify.p * 100).toFixed(0)}% [${(l.verify.lo * 100).toFixed(0)}–${(l.verify.hi * 100).toFixed(0)}], target ${(l.target * 100).toFixed(0)}%\n`
}
await writeFile(file, src)
await writeFile(path.join(ROOT, 'out', 'patch.diff'), diff || '# no verified changes\n')
execFileSync(process.execPath, [path.join(SRC, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'], { cwd: DST, stdio: 'inherit' })
console.log(`${fixes.length} verified level changes applied → out/mashpit-fixed/dist (patch in out/patch.diff)`)
