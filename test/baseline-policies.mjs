// Test fixture only (not used in the demo): a uniform-random bot for runner tests.
export default {
  random: (o, rng) => o.left + o.radius[o.cur] + rng() * (o.right - o.left - 2 * o.radius[o.cur]),
}
