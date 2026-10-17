// Serves the report from the CreateOS sandbox's public URL (ingress). Run only after deciding to publish.
// --with-game also serves the patched copy of the game at /game/ (the live game itself is never touched).
// usage: node scripts/publish-report.mjs [--with-game]   → prints the live URL(s) and checks they load
import '../src/env.mjs'
import { writeFile, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { getSandbox, serveReport } from '../src/runner.mjs'

const withGame = process.argv.includes('--with-game')
if (withGame) {   // upload out/mashpit-fixed/dist → /work/site/game/
  const sb = await getSandbox(), root = path.resolve('out/mashpit-fixed/dist'), files = []
  const walk = async d => { for (const e of await readdir(d)) { const f = path.join(d, e); (await stat(f)).isDirectory() ? await walk(f) : files.push(f) } }
  await walk(root)
  const dirs = [...new Set(files.map(f => '/work/site/game/' + path.relative(root, path.dirname(f)).split(path.sep).join('/')))]
  await sb.runCommand('mkdir', ['-p', ...dirs])
  for (const f of files) await sb.files.upload('/work/site/game/' + path.relative(root, f).split(path.sep).join('/'), await readFile(f))
  console.log(`uploaded the patched game: ${files.length} files`)
}
const url = await serveReport('report/dist/index.html')
const check = async u => { for (let i = 0; i < 10; i++) { try { const r = await fetch(u); if (r.ok) return `${r.status}` } catch (e) { if (i === 9) return e.message } await new Promise(r => setTimeout(r, 3000)) } return 'not reachable' }
await writeFile('out/report-url.txt', url + '\n')
console.log(`report live at ${url} (check: ${await check(url)})`)
if (withGame) console.log(`patched game at ${url.replace(/\/?$/, '/')}game/ (check: ${await check(url.replace(/\/?$/, '/') + 'game/')})`)
