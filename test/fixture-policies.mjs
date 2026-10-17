// Test fixture only (pipeline tests, never in the demo): three trivial bots with the persona names.
const rand = (o, rng) => o.left + o.radius[o.cur] + rng() * (o.right - o.left - 2 * o.radius[o.cur])
const same = (o, rng) => { const m = o.mons.filter(m => m.tier === o.cur && !m.ice).sort((a, b) => a.y - b.y)[0]; return m ? m.x : rand(o, rng) }
export default { random: rand, greedy: same, lookahead: same }
