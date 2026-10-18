// Runs CONTAINMENT playtests across parallel headless browsers. Every playtest starts from a fresh boot.
// Task: { policy, seed, difficulty, maxTime?, setup?, tag? }. Returns rows in task order.
import { openGame, runEpisode } from './runtime.mjs'

export async function runContainment(tasks, policySrc, { workers = 4, onProgress = () => {} } = {}) {
  const rows = new Array(tasks.length)
  let next = 0, done = 0
  const worker = async () => {
    const g = await openGame()
    try {
      while (next < tasks.length) {
        const i = next++, t = tasks[i]
        let r
        try { r = await runEpisode(g.page, { policySrc, maxTime: 300, decide: 0.2, ...t }) }
        catch (e) { r = { ...t, mode: 'harness-error', error: String(e.message).slice(0, 200) } }
        rows[i] = { i, tag: t.tag, ...r, win: r.mode === 'end' }
        onProgress(++done, tasks.length, rows[i])
        await g.reboot()
      }
    } finally { await g.close() }
  }
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, worker))
  return rows
}
