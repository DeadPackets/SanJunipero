// One process, one port: the world ticks, the socket serves and the built viewer is handed to a
// browser from the same origin.
//
//   pnpm stream                 RESUME the town that was running (a new one if there is none)
//   SJ_FRESH=1 pnpm stream      throw that town away and start a new day 0
//   PORT=9000 SJ_RINGS=3 …      pick the port and how far the town is platted
//   SJ_LAMPS=0 pnpm stream      leave the streets dark (a lamplighter raises eight otherwise)
//   SJ_LIVE=1 pnpm stream       ★ THE BODIES ARE LLM MINDS. Costs real money.
//   SJ_ARBITER=0 …              turn the god layer off inside a live run (it is ON by default)
//   SJ_SPEND_DAILY_USD=3 …      dollars the live cast may burn in a rolling 24 hours
//   SJ_SPEND_CAP_USD=50 …       dollars over the town's whole life; 0 is no lifetime cap
//   SJ_MAX_MINDS=15 …           how many minds the town may hold; a birth past it gets no mind
//   SJ_ADMIN_TOKEN=… …          open the loopback operator channel (/admin/*) behind a bearer
//   SJ_GIT_SHA=… …              stamped into /admin/export's manifest, so a replay knows the code
//
// Scripted by default at $0.00/hour — the live path is not even imported unless SJ_LIVE=1
// (dynamic import below).
import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { adminChannelPort, adminOpsRoutes, createLawsAdmin, type LiveCast } from '@sj/gateway'
import { DEV_DB_PATH, SHOWCASE_CONFIG, startDevWorld } from './devWorld.js'
import { intEnv, parseWorldEnv } from './worldEnv.js'

export const STREAM_PORT = 8080
export const STREAM_LAMPS = 8
/** Per-mind memory, beside the world db so one volume and one `SJ_FRESH=1` cover both. */
export const STREAM_MINDS_DIR = 'data/minds'
/** The chronicle. Inside the minds directory, so `SJ_FRESH=1` throws the town's story away with
 *  the town; underscore-prefixed to stay out of the `<mindId>.db` namespace. */
export const STREAM_NARRATOR_DB = '_narrator.db'
export const CLIENT_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url))

/** The one instruction a person needs when the viewer has not been built yet. */
export const BUILD_FIRST = 'pnpm --filter @sj/web build'

/** A number, or undefined when the knob is unset: the defaults live in `liveWorld.ts`, which this
 *  file may not import — a static import would pull the mind stack onto the scripted path. */
const numEnv = (name: string, ok: (n: number) => boolean): number | undefined => {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const asked = Number(raw)
  if (ok(asked)) return asked
  console.log(`stream: ${name}=${raw} ignored; using the built-in default`)
  return undefined
}
const usdEnv = (name: string): number | undefined =>
  numEnv(name, (n) => Number.isFinite(n) && n >= 0)
const countEnv = (name: string): number | undefined =>
  numEnv(name, (n) => Number.isInteger(n) && n >= 1)

export async function main(): Promise<void> {
  if (!existsSync(`${CLIENT_DIST}index.html`)) {
    console.error(`stream: no viewer at ${CLIENT_DIST}\nstream: build it first — ${BUILD_FIRST}`)
    process.exitCode = 1
    return
  }
  const port = intEnv('PORT', STREAM_PORT, 1)
  const lamps = intEnv('SJ_LAMPS', STREAM_LAMPS, 0)
  const env = parseWorldEnv()

  // The import itself is behind the flag: `@sj/live` pulls in the mind stack and the `ai` SDK,
  // and a scripted stream should pay for neither.
  const live = process.env.SJ_LIVE === '1'
  const mindsDir = process.env.SJ_MINDS_DIR ?? STREAM_MINDS_DIR
  // One path, two readers: the live cast writes the day's chapter, the gateway serves it.
  const narratorDbPath = join(mindsDir, STREAM_NARRATOR_DB)
  const spendDaily = usdEnv('SJ_SPEND_DAILY_USD')
  const spendCap = usdEnv('SJ_SPEND_CAP_USD')
  const maxMinds = countEnv('SJ_MAX_MINDS')
  let world: Awaited<ReturnType<typeof startDevWorld>> | undefined
  // A FACTORY, not a cast: `startDevWorld` deletes the minds when `SJ_FRESH=1`, and a cast
  // built out here would already be holding those files open. Wipe first, build second.
  const castFactory = (): Promise<LiveCast> =>
    import('@sj/live').then(({ createLiveCast }) =>
      createLiveCast({
        agentDbDir: mindsDir,
        narratorDbPath,
        ...(process.env.SJ_MODELS_DIR === undefined
          ? {}
          : { modelsDir: process.env.SJ_MODELS_DIR }),
        ...(spendDaily === undefined ? {} : { spendDailyUsd: spendDaily }),
        ...(spendCap === undefined ? {} : { spendCapUsd: spendCap }),
        ...(maxMinds === undefined ? {} : { maxMinds }),
        // The cap kills the process: a stream that stops thinking and keeps serving is a town of
        // statues nobody would notice for hours.
        onSpendStop: () => {
          void world?.stop().then(() => process.exit(1))
        },
        // Opt-OUT, and it only ever fires on an act the engine has no verb for — a per-novelty
        // call, not a per-turn one. It bills the same ledger and dies on the same stops.
        useArbiter: process.env.SJ_ARBITER !== '0',
      }),
    )

  try {
    world = await startDevWorld({
      ...env,
      ingest: true,
      port,
      lamps,
      staticDir: CLIENT_DIST,
      // `agentDbDir` is what makes `SJ_FRESH=1` delete the minds in the same breath as the town;
      // without it a fresh boot is the one state worse than either a reset or a resume.
      ...(live ? { cast: castFactory, agentDbDir: mindsDir, narratorDbPath } : {}),
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

  // The only write path into the world. The listener stays on loopback; the gateway carries
  // `/admin/*` to it from the served origin, so the operator's page can reach it (ruling 10)
  // and the bearer is what refuses everyone else — see deploy/README.md.
  const adminToken = process.env.SJ_ADMIN_TOKEN
  const adminPort = adminChannelPort()
  let admin: Server | null = null
  if (adminToken !== undefined && adminPort !== null) {
    admin = createLawsAdmin({
      submitLaw: running.submitLaw,
      token: adminToken,
      routes: adminOpsRoutes({
        clock: running.loop,
        ops: () => running.ops,
        worldDbPath: DEV_DB_PATH,
        mindsDir,
        config: SHOWCASE_CONFIG,
      }),
    })
    admin.listen(adminPort, '127.0.0.1', () => {
      console.log(
        `stream: the operator's channel is open on 127.0.0.1:${adminPort},` +
          ` and the town serves it at http://localhost:${running.gateway.port}/admin/`,
      )
    })
  } else {
    console.log('stream: no law channel — SJ_ADMIN_TOKEN opens one on loopback')
  }

  // A stream is a long-running process and a container stops it with a signal; without this the
  // world dies mid-write and the next boot reads a half-flushed db.
  const stop = (signal: string): void => {
    console.log(`stream: ${signal} — closing the town`)
    admin?.close()
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
