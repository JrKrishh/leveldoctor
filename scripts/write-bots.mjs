// Step 3: the agent writes the bot players and fixes them until skill ranks correctly.
import { writePolicies } from '../src/agent.mjs'
import { G, BASE_LEVELS } from '../src/runtime.mjs'

const pct = w => `${(w.p * 100).toFixed(0)}% [${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}]`
const r = await writePolicies({
  levels: BASE_LEVELS, tiers: G.TIERS,
  onEvent: e => {
    if (e.type === 'llm') console.log(`round ${e.round}: ${e.model} is writing bots…`)
    if (e.type === 'reject') console.log(`round ${e.round}: rejected (${e.why})`)
    if (e.type === 'eval') {
      if (e.errors?.length) console.log(`round ${e.round}: bots crashed: ${e.errors.join(' | ').slice(0, 300)}`)
      else console.log(`round ${e.round}: ${e.runs} runs on ${e.backend} in ${(e.ms / 1000).toFixed(1)} s → ` + ['random', 'greedy', 'lookahead'].map(p => `${p} ${pct(e.table[p].overall)}`).join(' · ') + (e.ok ? '  MONOTONIC ✓' : '  not monotonic'))
    }
  },
})
console.log(`kept round ${r.round} (${r.model}), monotonic=${r.ev.ok} → ${r.file}`)
