// Dev tool: finds functions in the loaded game script by name (reads the script the page already loaded).
import { openGame } from './runtime.mjs'
const g = await openGame()
const src = await g.page.evaluate(async () => { const s = [...document.scripts].find(s => /assets\/index-/.test(s.src)); return (await fetch(s.src)).text() })
const names = process.argv.slice(2)
console.log('script length', src.length)
const LEN = +process.env.LEN || 1600, SKIP = +process.env.SKIP || 0
for (const n of names) {
  const needle = n.startsWith('@') ? n.slice(1) : `function ${n}(`
  let i = src.indexOf(needle), shown = 0
  if (i < 0) console.log(`\n=== ${n}: not found ===`)
  while (i >= 0 && shown < (+process.env.ALL || 1)) {
    console.log(`\n=== ${n} @${i} ===\n` + src.slice(Math.max(0, i + SKIP), i + SKIP + LEN))
    i = src.indexOf(needle, i + 1); shown++
  }
}
await g.close()
