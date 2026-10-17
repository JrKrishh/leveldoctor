// Serves the report from the CreateOS sandbox's public URL (ingress). Run only after deciding to publish.
// usage: node scripts/publish-report.mjs   → prints the live URL and checks it loads
import '../src/env.mjs'
import { writeFile } from 'node:fs/promises'
import { serveReport } from '../src/runner.mjs'

const url = await serveReport('report/dist/index.html')
let status = 'unchecked'
for (let i = 0; i < 10; i++) {   // the ingress hostname and TLS can take a moment
  try { const r = await fetch(url); status = `${r.status}`; if (r.ok && (await r.text()).includes('Level Doctor')) break } catch (e) { status = e.message }
  await new Promise(r => setTimeout(r, 3000))
}
await writeFile('out/report-url.txt', url + '\n')
console.log(`report live at ${url} (check: ${status})`)
