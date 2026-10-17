// Screenshot the report at desktop width (for checking layout). usage: node scripts/shot.mjs [out.png] [selector]
import { chromium } from 'playwright'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const [out = 'out/report.png', sel] = process.argv.slice(2)
const b = await chromium.launch({ executablePath: CHROME })
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()))
await p.goto(pathToFileURL(path.resolve('report/dist/index.html')).href)
await p.waitForTimeout(600)
if (sel) await (await p.$(sel)).screenshot({ path: out }); else await p.screenshot({ path: out, fullPage: true })
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors', '→', out)
await b.close()
