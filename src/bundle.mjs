// Bundles the real game into one headless ES module. Matter.js is bundled in, the SDK is stubbed, and a hook
// exposing the game's internals (step function, state, reset) is inserted just before the render loop.
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const GAME = process.env.GAME_SRC || path.resolve(here, '../../mashpit/src/main.js')
const OUT = path.resolve(here, '../build/game.bundle.mjs')
const ANCHOR = 'function tick(now) {'

const HOOK = `
globalThis.__ld = {
  Matter, update, startLevel, drop, goalProgress, LEVELS, TIERS, mons, gifts, engine, LINE, FLOOR, DROP_Y,
  setAim: x => { aimX = x },
  reset: () => { dropCd = 0; comboT = 0; combo = 0; shake = 0; toastT = 0; particles.length = 0; floaters.length = 0; acc = 0 },
  get s() { return { state, score, cur, nxt, dropsLeft, highestTier, mashed, clockT, dropCd, LEFT, RIGHT, level, mods } },
}
`

const hook = {
  name: 'level-doctor-hook',
  setup(b) {
    b.onLoad({ filter: /main\.js$/ }, async args => {
      const src = await readFile(args.path, 'utf8')
      if (!src.includes(ANCHOR)) throw new Error(`hook anchor not found in ${args.path}`)
      return { contents: src.replace(ANCHOR, HOOK + ANCHOR), loader: 'js', resolveDir: path.dirname(args.path) }
    })
  },
}

await build({
  entryPoints: [GAME], outfile: OUT, bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'],
  alias: { '@series-inc/rundot-game-sdk/api': path.resolve(here, 'sdk-stub.mjs') },
  define: { 'import.meta.env.DEV': 'false' }, plugins: [hook], logLevel: 'warning',
})
console.log('bundled', path.relative(process.cwd(), OUT))
