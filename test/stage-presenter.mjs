// Renders presenter-layout frames (right column kept free) to check that nothing is cut off.
import { chromium } from 'playwright'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const CHROME = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const b = await chromium.launch({ executablePath: CHROME })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.goto(pathToFileURL(path.resolve('demo/stage.html')).href + '#presenter')
await p.waitForFunction('window.READY === true'); await p.waitForTimeout(400)
for (const t of process.argv.slice(2).map(Number)) { await p.evaluate(x => window.renderAt(x), t); await p.screenshot({ path: `demo/work/pframe-${t}.png` }) }
await b.close()
