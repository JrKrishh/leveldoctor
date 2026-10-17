// Renders single frames of the stage page at given times, to check layouts without building the whole video.
import { chromium } from 'playwright'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const CHROME = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const b = await chromium.launch({ executablePath: CHROME })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.goto(pathToFileURL(path.resolve('demo/stage.html')).href)
await p.waitForFunction('window.READY === true'); await p.waitForTimeout(400)
for (const t of process.argv.slice(2).map(Number)) { await p.evaluate(x => window.renderAt(x), t); await p.screenshot({ path: `demo/work/frame-${t}.png` }); console.log(`demo/work/frame-${t}.png`) }
await b.close()
