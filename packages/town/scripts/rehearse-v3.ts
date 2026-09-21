import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { startDevWorld, type DevWorld } from '../src/devWorld.js'
import { createLiveCast } from '@sj/live'
import { foundingIds } from '@sj/shared'
import { MIND_MODEL, FALLBACK_MODELS } from '@sj/llm'

const output = process.argv[2]
if (!output || !process.env.OPENROUTER_API_KEY)
  throw new Error('A new output directory and OpenRouter credential are required')
if (MIND_MODEL !== 'openai/gpt-5.6-luna' || FALLBACK_MODELS.length !== 0)
  throw new Error('Rehearsal pricing requires the reviewed Luna route with no model fallbacks')
const dir = resolve(output)
if (existsSync(dir))
  throw new Error('Rehearsal requires a new directory; existing history is retained')
mkdirSync(dir, { recursive: true })
process.env.SJ_IDLE_PACING = '0'
process.env.SJ_ART_DAILY_USD = '0'
const startedAt = Date.now()
const manifest = {
  startedAt: new Date(startedAt).toISOString(),
  seed: 'v3-day-1',
  realMsPerTick: 1000,
  targetTick: 1560,
  wallDeadlineMinutes: 30,
  spendCapUsd: 15,
  port: 8776,
  imageGeneration: false,
  note: 'Accelerated local causal rehearsal; no comparison with production wall-clock pacing.',
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
let world: DevWorld | undefined
let stopReason: string | undefined
let stopping = false
let poll: ReturnType<typeof setInterval> | undefined
let forceExit: ReturnType<typeof setTimeout> | undefined
const requestStop = (reason: string) => {
  forceExit ??= setTimeout(() => {
    try {
      writeFileSync(
        join(dir, 'finished.json'),
        JSON.stringify({
          reason: `${reason}: shutdown deadline`,
          tick: world?.loop.tick ?? null,
          elapsedMs: Date.now() - startedAt,
        }),
      )
    } finally {
      process.exit(1)
    }
  }, 20_000)
  void stop(reason)
}
const deadline = setTimeout(() => {
  requestStop('wall deadline')
}, 30 * 60_000)
async function stop(reason: string) {
  stopReason ??= reason
  if (!world || stopping) return
  stopping = true
  clearTimeout(deadline)
  clearInterval(poll)
  const tick = world.loop.tick
  try {
    await world.stop()
    writeFileSync(
      join(dir, 'finished.json'),
      JSON.stringify({ reason: stopReason, tick, elapsedMs: Date.now() - startedAt }, null, 2),
    )
    clearTimeout(forceExit)
    console.log('Local rehearsal stopped', { reason: stopReason, tick })
  } catch (error) {
    console.error(
      'Local rehearsal shutdown failed',
      error instanceof Error ? error.message : String(error),
    )
    process.exitCode = 1
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    requestStop(signal)
  })
try {
  const agentDbDir = join(dir, 'minds')
  const narratorDbPath = join(agentDbDir, '_narrator.db')
  world = await startDevWorld({
    dbPath: join(dir, 'world.db'),
    agentDbDir,
    narratorDbPath,
    port: manifest.port,
    realMsPerTick: manifest.realMsPerTick,
    seed: manifest.seed,
    ingest: true,
    staticDir: resolve('packages/web/dist'),
    world: {
      map: 'orchard',
      founders: 12,
      interiors: true,
      builders: true,
      bridge: true,
      jointBuild: false,
    },
    cast: () =>
      createLiveCast({
        agentDbDir,
        narratorDbPath,
        founderIds: foundingIds(12),
        spendCapUsd: manifest.spendCapUsd,
        spendDailyUsd: manifest.spendCapUsd,
        useArbiter: true,
        onSpendStop: () => {
          requestStop('budget stop')
        },
      }),
  })
  console.log('Local AI rehearsal ready', { live: world.live, port: manifest.port })
  if (stopReason) await stop(stopReason)
  else
    poll = setInterval(() => {
      if (world && world.loop.tick >= manifest.targetTick)
        requestStop('full day and reflection window')
    }, 1000)
} catch (error) {
  clearTimeout(deadline)
  clearTimeout(forceExit)
  await stop('startup failed')
  throw error
}
