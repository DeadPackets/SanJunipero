// ★ THE STREAM. One process, one port, one address: the world ticks here, the socket serves it
// here, and the built viewer is handed to a browser from the same origin here. Everything before
// this file was a localhost dev split — a gateway on 8787 and a vite server on 5173 proxying to
// it — which is two terminals and cannot be given to a stranger.
//
// This is deliberately NOT a second copy of the world: it is `startDevWorld` with the built
// client bolted to the same http server, so the town a viewer watches over the internet is
// byte-for-byte the town a lane watches on localhost.
//
//   pnpm stream                 RESUME the town that was running (a new one if there is none)
//   SJ_FRESH=1 pnpm stream      throw that town away and start a new day 0
//   PORT=9000 SJ_RINGS=3 …      pick the port and how far the town is platted
//   SJ_LAMPS=0 pnpm stream      leave the streets dark (a lamplighter raises eight otherwise)
//   SJ_LIVE=1 pnpm stream       ★ THE BODIES ARE LLM MINDS. Costs real money. See below.
//   SJ_ARBITER=0 …              turn the god layer off inside a live run (it is ON by default)
//
// ★ RESUME IS THE DEFAULT, AND THAT IS THE WHOLE POINT OF THIS FILE EXISTING. A stream is
// watched because day 12 follows days 1 to 11. Until now `startDevWorld` deleted the world db
// on boot, so every deploy, every crash and every `docker restart` was a new town at day 0 —
// a demo on a loop. The event log held all of it; nothing read it back.
//
// ★ WHAT THIS DOES NOT DO BY DEFAULT: spend money. The founders are a SCRIPTED cast
// (`founders.ts`) unless `SJ_LIVE=1` is asked for by name, and the cost of the scripted world
// is $0.00/hour. That default is load-bearing: a person running `pnpm stream` by reflex must
// not start billing a card, so the live path is not even IMPORTED unless it is selected —
// `liveWorld.ts` arrives through a dynamic `import()` below and nothing else in this package
// references it.
//
// ★ AND WITH `SJ_LIVE=1` THE BODIES ARE DEEPSEEK MINDS. Same town, same port, same viewer,
// same event log — the only difference is who decides. It carries a $5 anomaly stop that kills
// this process rather than quietly serving a town of statues, and it keeps per-mind memory in
// `packages/gateway/data/minds/`, which `SJ_FRESH=1` throws away together with the world.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TOWN_RINGS_GENESIS } from '@sj/shared'
import { startDevWorld, type DevMapKind, type LiveCast } from './devWorld.js'

export const STREAM_PORT = 8080
export const STREAM_LAMPS = 8
/** Per-mind memory, beside the world db so one volume and one `SJ_FRESH=1` cover both. */
export const STREAM_MINDS_DIR = 'data/minds'
export const CLIENT_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url))

/** The one instruction a person needs when the viewer has not been built yet. */
export const BUILD_FIRST = 'pnpm --filter @sj/web build'

const intEnv = (name: string, fallback: number, min: number): number => {
  const asked = Number(process.env[name] ?? fallback)
  if (Number.isInteger(asked) && asked >= min) return asked
  if (process.env[name] !== undefined) console.log(`stream: ${name}=${process.env[name]} ignored; using ${fallback}`)
  return fallback
}

export async function main(): Promise<void> {
  if (!existsSync(`${CLIENT_DIST}index.html`)) {
    console.error(`stream: no viewer at ${CLIENT_DIST}\nstream: build it first — ${BUILD_FIRST}`)
    process.exitCode = 1
    return
  }
  const port = intEnv('PORT', STREAM_PORT, 1)
  const rings = intEnv('SJ_RINGS', TOWN_RINGS_GENESIS, 1)
  const map: DevMapKind = process.env['SJ_MAP'] === 'scripted' ? 'scripted' : 'showcase'
  const interiors = process.env['SJ_INTERIORS'] === '1'
  const fresh = process.env['SJ_FRESH'] === '1'
  // The streets, lit. A viewer who opens the stream at midnight should see what the town can
  // now do; `SJ_LAMPS=0` turns it off, and any other integer sets how many.
  const lamps = intEnv('SJ_LAMPS', STREAM_LAMPS, 0)

  // ★ THE ONE SWITCH THAT COSTS MONEY, AND IT IS OFF UNLESS TYPED. The import itself is behind
  // the flag: `@sj/agents` pulls in onnxruntime and a 128 MB sentence-transformer, and a
  // scripted stream should pay for neither.
  const live = process.env['SJ_LIVE'] === '1'
  const mindsDir = process.env['SJ_MINDS_DIR'] ?? STREAM_MINDS_DIR
  let world: Awaited<ReturnType<typeof startDevWorld>> | undefined
  // A FACTORY, not a cast: `startDevWorld` deletes the minds when `SJ_FRESH=1`, and a cast
  // built out here would already be holding those files open. Wipe first, build second.
  const castFactory = (): Promise<LiveCast> => import('./liveWorld.js').then(({ createLiveCast }) =>
    createLiveCast({
      agentDbDir: mindsDir,
      ...(process.env['SJ_MODELS_DIR'] === undefined ? {} : { modelsDir: process.env['SJ_MODELS_DIR'] }),
      // ★ THE CAP KILLS THE PROCESS. A stream that stops thinking and keeps serving is a town
      // of statues nobody would notice for hours; a stream that dies leaves a resumable town
      // on disk and a message in the log an operator cannot miss.
      onSpendStop: () => { void world?.stop().then(() => process.exit(1)) },
      // ★ THE GOD LAYER IS ON INSIDE A LIVE RUN, and it is opt-OUT rather than opt-in. A
      // person who typed SJ_LIVE=1 asked for minds that decide, and a mind that can only pick
      // from a fixed verb list is the demo, not the product (spec §4). It bills the same
      // ledger and dies on the same $5 stop, and it only ever fires on an act the engine has
      // no verb for — a per-novelty call, not a per-turn one.
      useArbiter: process.env['SJ_ARBITER'] !== '0',
    }))

  try {
    world = await startDevWorld({
      ingest: true, map, rings, interiors, port, fresh, builders: true, lamps,
      staticDir: CLIENT_DIST,
      // ★ THE MINDS ARE WIPED WITH THE WORLD, OR NOT AT ALL. `agentDbDir` is what makes
      // `SJ_FRESH=1` delete them in the same breath as the town; without it a fresh boot is
      // the one state worse than either a reset or a resume.
      ...(live ? { cast: castFactory, agentDbDir: mindsDir } : {}),
    })
  } catch (e) {
    // A taken port is the single most common way this command fails, and a raw EADDRINUSE
    // stack says nothing an operator can act on. The pre-flight and amnesia refusals are whole
    // paragraphs written for an operator, so they are printed as they were written.
    const busy = (e as { code?: string }).code === 'EADDRINUSE'
    const text = e instanceof Error ? e.message : String(e)
    console.error(busy
      ? `stream: port ${port} is already in use — pick another with PORT=…`
      : text.includes('\n') ? text : `stream: could not start — ${text}`)
    process.exitCode = 1
    return
  }
  const running = world
  console.log(running.resumedAtTick === null
    ? 'stream: this is a new town — SJ_FRESH=1 starts another one over it'
    : `stream: this is the town that was running, resumed at tick ${running.resumedAtTick}`)
  // Said out loud in both directions, because "is anything actually thinking?" is the one
  // question a viewer cannot answer by looking, and three lanes have guessed at it.
  console.log(running.live
    ? `stream: the cast is LIVE MINDS — this costs money, and memory is kept in ${mindsDir}/`
    : 'stream: the cast is SCRIPTED and free — SJ_LIVE=1 puts LLM minds behind these bodies')
  console.log(`stream: the town is open at http://localhost:${running.gateway.port}/`)

  // A stream is a long-running process and a container stops it with a signal; without this the
  // world dies mid-write and the next boot reads a half-flushed db.
  const stop = (signal: string): void => {
    console.log(`stream: ${signal} — closing the town`)
    void running.stop().then(() => process.exit(0))
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
