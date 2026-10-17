// Tests the on-camera recorder with Chromium's fake camera/mic: start a take, stop, save, check the file.
import { chromium } from 'playwright'
import path from 'node:path'
import { existsSync, statSync } from 'node:fs'

const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const b = await chromium.launch({ executablePath: CHROME, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
const errors = []; p.on('pageerror', e => errors.push(e.message))
await p.goto('http://localhost:8099/recorder.html')
await p.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 15000 })
console.log('ready:', await p.textContent('#status'))
await p.click('#go')
await p.waitForTimeout(6500)
console.log('prompt while recording:', (await p.textContent('#prompt')).slice(0, 80))
await p.click('#stop')
await p.waitForFunction(() => !document.getElementById('save').disabled, null, { timeout: 10000 })
await p.click('#save')
await p.waitForFunction(() => /Saved|failed/.test(document.getElementById('status').textContent), null, { timeout: 10000 })
const status = await p.textContent('#status')
console.log('status:', status)
const file = status.match(/demo\/work\/\S+\.webm/)?.[0]
console.log(file && existsSync(file) ? `file ok: ${file} ${(statSync(file).size / 1e3).toFixed(0)} kB` : 'FILE MISSING', errors.length ? 'errors: ' + errors.join(' | ') : '')
await b.close()
