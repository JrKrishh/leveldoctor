// Does a 1 ms shift change an ORBITAL run at all? Compares paired episodes (test only).
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runEpisode } from '../games/orbital/runtime.mjs'
const bots = (await import(pathToFileURL(path.resolve('out/orbital-policies.mjs')).href)).default
let same = 0, diffTime = 0, flips = 0
for (let s = 1001; s < 1041; s++) {
  const a = runEpisode(bots.reactive, { seed: s }), b = runEpisode(bots.reactive, { seed: s, nudge: { t: 2, dt: 0.001 } })
  if (a.time === b.time && a.taps === b.taps) same++; else diffTime++
  if ((a.time >= 20) !== (b.time >= 20)) flips++
}
console.log(`40 pairs: identical ${same}, different ${diffTime}, pass/fail flips ${flips}`)
