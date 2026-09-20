import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

type Progress = { tick: number; advancedAt: number }
const STALL_MS = 15 * 60_000
const CHECKPOINT = '/tmp/sanjunipero-health.json'

export function nextProgress(previous: Progress | null, tick: number, now: number): Progress {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid town tick')
  if (previous?.tick !== tick || !Number.isFinite(previous.advancedAt) || previous.advancedAt > now)
    return { tick, advancedAt: now }
  if (now - previous.advancedAt >= STALL_MS)
    throw new Error(
      `Town has not advanced for 15 minutes at tick ${String(tick)}. Check for a pause or stall.`,
    )
  return previous
}

async function main(): Promise<void> {
  const response = await fetch('http://127.0.0.1:8080/api/timeline/marks', {
    signal: AbortSignal.timeout(4_000),
  })
  if (!response.ok) throw new Error(`Town returned HTTP ${String(response.status)}`)
  const body = (await response.json()) as { throughTick: number }
  const previous = existsSync(CHECKPOINT)
    ? (JSON.parse(readFileSync(CHECKPOINT, 'utf8')) as Progress)
    : null
  const next = nextProgress(previous, body.throughTick, Date.now())
  if (next !== previous) writeFileSync(CHECKPOINT, JSON.stringify(next))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Town health check failed')
    process.exitCode = 1
  })
