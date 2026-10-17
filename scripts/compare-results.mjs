// Cross-check: the same diagnosis run in the CreateOS sandbox and on local workers must agree number for number.
// usage: node scripts/compare-results.mjs out/results.json out/results-local.json
import { readFile, writeFile } from 'node:fs/promises'

const [a, b] = await Promise.all(process.argv.slice(2, 4).map(async f => JSON.parse(await readFile(f, 'utf8'))))
const keys = l => JSON.stringify({ p: Object.fromEntries(Object.entries(l.personas).map(([k, v]) => [k, [v.k, v.n]])), c: l.chaos && [l.chaos.flips, l.chaos.n], e: l.exposure, patch: l.patch, verify: l.verify && [l.verify.k, l.verify.n] })
let same = 0
const diffs = []
for (let i = 0; i < a.levels.length; i++) { if (keys(a.levels[i]) === keys(b.levels[i])) same++; else diffs.push(a.levels[i].name) }
const out = { a: a.runs.backend, b: b.runs.backend, runs: [a.runs.total, b.runs.total], levelsIdentical: same, levels: a.levels.length, diffs }
console.log(`${a.runs.backend} (${a.runs.total} runs) vs ${b.runs.backend} (${b.runs.total} runs): ${same}/${a.levels.length} levels identical${diffs.length ? ' · differ: ' + diffs.join(', ') : ''}`)
await writeFile('out/cross-check.json', JSON.stringify(out, null, 1))
