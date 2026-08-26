// One process, one port: the world ticks, the socket serves and the built viewer is handed to a
// browser from the same origin.
//
//   pnpm stream                 RESUME the town that was running (a new one if there is none)
//   SJ_FRESH=1 pnpm stream      throw that town away and start a new day 0
//   PORT=9000 SJ_RINGS=3 …      pick the port and how far the town is platted
//   SJ_LAMPS=0 pnpm stream      leave the streets dark (a lamplighter raises eight otherwise)
//   SJ_LIVE=1 pnpm stream       ★ THE BODIES ARE LLM MINDS. Costs real money.
//   SJ_ARBITER=0 …              turn the god layer off inside a live run (it is ON by default)
//
// Scripted by default at $0.00/hour — the live path is not even imported unless SJ_LIVE=1
// (dynamic import below).
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
  if (process.env[name] !== undefined)
    console.log(`stream: ${name}=${process.env[name]} ignored; using ${fallback}`)
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
  const map: DevMapKind = process.env.SJ_MAP === 'scripted' ? 'scripted' : 'showcase'
  const interiors = process.env.SJ_INTERIORS === '1'
  const fresh = process.env.SJ_FRESH === '1'
  const lamps = intEnv('SJ_LAMPS', STREAM_LAMPS, 0)

  // The import itself is behind the flag: `@sj/agents` pulls in onnxruntime and a 128 MB
  // sentence-transformer, and a scripted stream should pay for neither.
  const live = process.env.SJ_LIVE === '1'
  const mindsDir = process.env.SJ_MINDS_DIR ?? STREAM_MINDS_DIR
  let world: Awaited<ReturnType<typeof startDevWorld>> | undefined
  // A FACTORY, not a cast: `startDevWorld` deletes the minds when `SJ_FRESH=1`, and a cast
  // built out here would already be holding those files open. Wipe first, build second.
  const castFactory = (): Promise<LiveCast> =>
    import('./liveWorld.js').then(({ createLiveCast }) =>
      createLiveCast({
        agentDbDir: mindsDir,
        ...(process.env.SJ_MODELS_DIR === undefined
          ? {}
          : { modelsDir: process.env.SJ_MODELS_DIR }),
        // The cap kills the process: a stream that stops thinking and keeps serving is a town of
        // statues nobody would notice for hours.
        onSpendStop: () => {
          void world?.stop().then(() => process.exit(1))
        },
        // Opt-OUT, and it only ever fires on an act the engine has no verb for — a per-novelty
        // call, not a per-turn one. It bills the same ledger and dies on the same $5 stop.
        useArbiter: process.env.SJ_ARBITER !== '0',
      }),
    )

  try {
    world = await startDevWorld({
      ingest: true,
      map,
      rings,
      interiors,
      port,
      fresh,
      builders: true,
      lamps,
      staticDir: CLIENT_DIST,
      // `agentDbDir` is what makes `SJ_FRESH=1` delete the minds in the same breath as the town;
      // without it a fresh boot is the one state worse than either a reset or a resume.
      ...(live ? { cast: castFactory, agentDbDir: mindsDir } : {}),
    })
  } catch (e) {
    // A raw EADDRINUSE stack says nothing an operator can act on. The pre-flight and amnesia
    // refusals are whole paragraphs written for an operator, so they are printed as written.
    const busy = (e as { code?: string }).code === 'EADDRINUSE'
    const text = e instanceof Error ? e.message : String(e)
    console.error(
      busy
        ? `stream: port ${port} is already in use — pick another with PORT=…`
        : text.includes('\n')
          ? text
          : `stream: could not start — ${text}`,
    )
    process.exitCode = 1
    return
  }
  const running = world
  console.log(
    running.resumedAtTick === null
      ? 'stream: this is a new town — SJ_FRESH=1 starts another one over it'
      : `stream: this is the town that was running, resumed at tick ${running.resumedAtTick}`,
  )
  // Said out loud in both directions, because "is anything actually thinking?" is the one
  // question a viewer cannot answer by looking.
  console.log(
    running.live
      ? `stream: the cast is LIVE MINDS — this costs money, and memory is kept in ${mindsDir}/`
      : 'stream: the cast is SCRIPTED and free — SJ_LIVE=1 puts LLM minds behind these bodies',
  )
  console.log(`stream: the town is open at http://localhost:${running.gateway.port}/`)

  // A stream is a long-running process and a container stops it with a signal; without this the
  // world dies mid-write and the next boot reads a half-flushed db.
  const stop = (signal: string): void => {
    console.log(`stream: ${signal} — closing the town`)
    void running.stop().then(() => process.exit(0))
  }
  process.on('SIGTERM', () => {
    stop('SIGTERM')
  })
  process.on('SIGINT', () => {
    stop('SIGINT')
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
