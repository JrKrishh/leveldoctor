// Which ORBITAL knob actually moves difficulty? One knob at a time, regular bot, 120 episodes each (test only).
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runEpisode } from '../games/orbital/runtime.mjs'
const bots = (await import(pathToFileURL(path.resolve('out/orbital-policies.mjs')).href)).default
const med = k => { const ts = Array.from({ length: 120 }, (_, i) => runEpisode(bots.reactive, { seed: 3001 + i, knobs: k }).time).sort((a, b) => a - b); return `${ts[60].toFixed(1)}s, ≥20s ${(ts.filter(t => t >= 20).length / 1.2).toFixed(0)}%` }
console.log('base', med({}))
for (const v of [1.0, 0.99, 0.95]) console.log('SPAWN_RAMP', v, med({ SPAWN_RAMP: v }))
for (const v of [0.6, 1.0]) console.log('SPAWN_MIN', v, med({ SPAWN_MIN: v }))
for (const v of [2.0, 3.0]) console.log('SPAWN_START', v, med({ SPAWN_START: v }))
for (const v of [1.2, 2.6]) console.log('BASE_SPIN', v, med({ BASE_SPIN: v }))
for (const v of [80, 180]) console.log('DEBRIS_SPEED', v, med({ DEBRIS_SPEED: v }))
