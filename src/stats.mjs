// Deterministic statistics (no LLM): intervals, the Chaos Ratio, twist exposure, and drop-limit tuning.

/** Wilson 95% interval for k successes in n trials. */
export function wilson(k, n, z = 1.96) {
  if (!n) return { k, n, p: 0, lo: 0, hi: 1 }
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) }
}

/**
 * Chaos Ratio from paired runs: each pair is the same seed, one with a drop nudged by an imperceptible amount.
 * C = flip rate / 2p(1-p). 1: outcomes are re-rolled by any perturbation (luck). 0: outcomes are reproducible (fixable).
 */
export function chaosRatio(pairs) {
  const n = pairs.length
  if (!n) return null
  const wins = pairs.reduce((s, [a, b]) => s + a.win + b.win, 0), p = wins / (2 * n)
  const flips = pairs.filter(([a, b]) => a.win !== b.win).length, f = flips / n, expect = 2 * p * (1 - p)
  return { n, p, flip: f, expect, C: expect > 0.02 ? f / expect : null, flips }
}

/** Twist Exposure Rate: the share of paired runs (twist on vs off, same seed) that differ at all. */
export function exposure(pairs) {
  const n = pairs.length
  const differ = pairs.filter(([a, b]) => a.hash !== b.hash || a.drops !== b.drops).length
  return { n, rate: n ? differ / n : 0, ci: wilson(differ, n) }
}

/**
 * Survival-curve tuning: runs played with unlimited drops record how many drops it took to reach the goal
 * (or that the pit overflowed first). The pass rate for any drop limit D is the share of runs that won within D.
 */
export function passAtLimit(rows, D) {
  const k = rows.filter(r => r.win && r.drops <= D).length
  return wilson(k, rows.length)
}
export function solveLimit(rows, target, { min = 5, max = 120 } = {}) {
  let best = null
  for (let D = min; D <= max; D++) {
    const w = passAtLimit(rows, D), err = Math.abs(w.p - target)
    if (!best || err < best.err - 1e-9) best = { D, err, ...w }
  }
  return best
}

export const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
