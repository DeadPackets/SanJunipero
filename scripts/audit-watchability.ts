import Database from 'better-sqlite3'
import { resolve, join } from 'node:path'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

type Row = { seq: number; tick: number; type: string; payload: string }
const histogram = (values: string[]) =>
  Object.fromEntries(
    [...new Set(values)].sort().map((key) => [key, values.filter((v) => v === key).length]),
  )
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null
}
export type AuditEvent = {
  seq: number
  tick: number
  type: string
  payload: Record<string, unknown>
}

export function speechWithoutMirrors(events: readonly AuditEvent[]): AuditEvent[] {
  const mirrored = new Set<number>()
  const spoken = events.filter((ev) => ev.type === 'agent_spoke')
  for (const line of events.filter((ev) => ev.type === 'scene_line')) {
    const original = spoken.reduce<AuditEvent | undefined>((best, ev) => {
      if (
        mirrored.has(ev.seq) ||
        Math.abs(ev.tick - line.tick) > 1 ||
        ev.payload.agentId !== line.payload.agentId ||
        ev.payload.text !== line.payload.text
      )
        return best
      return best === undefined || Math.abs(ev.seq - line.seq) < Math.abs(best.seq - line.seq)
        ? ev
        : best
    }, undefined)
    if (original) mirrored.add(original.seq)
  }
  return events.filter(
    (ev) => ev.type === 'scene_line' || (ev.type === 'agent_spoke' && !mirrored.has(ev.seq)),
  )
}

export function auditWatchability(directory: string): void {
  const dir = resolve(directory)
  const world = new Database(join(dir, 'world.db'), { readonly: true, fileMustExist: true })
  const ops = new Database(join(dir, 'minds', '_ops.db'), { readonly: true, fileMustExist: true })
  try {
    const rows = world
      .prepare('SELECT seq,tick,type,payload FROM events ORDER BY seq')
      .all() as Row[]
    const head = rows.reduce((tick, row) => Math.max(tick, row.tick), 0)
    const events = rows.map((row) => ({
      ...row,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }))
    const sceneLines = events.filter((ev) => ev.type === 'scene_line')
    const speech = speechWithoutMirrors(events)
    const starts = events.filter((ev) => ev.type === 'scene_opened')
    const closes = new Map(
      events.filter((ev) => ev.type === 'scene_closed').map((ev) => [ev.payload.id, ev.tick]),
    )
    const intervals = starts
      .map((ev) => [ev.tick, closes.get(ev.payload.id) ?? head] as const)
      .sort((a, b) => a[0] - b[0])
    let covered = 0,
      end = 0
    for (const [from, to] of intervals) {
      covered += Math.max(0, to - Math.max(from, end))
      end = Math.max(end, to)
    }
    const perScene = histogram(sceneLines.map((ev) => String(ev.payload.id)))
    const spokenTexts = speech.map((ev) => String(ev.payload.text).trim().toLowerCase())
    const refusals = events.filter((ev) => ev.type === 'action_refused')
    const calls = ops
      .prepare(
        'SELECT caller,latency_ms,ok,input_tokens,output_tokens,cost_usd,error FROM llm_calls ORDER BY id',
      )
      .all() as {
      caller: string
      latency_ms: number
      ok: number
      input_tokens: number
      output_tokens: number
      cost_usd: number
      error: string | null
    }[]
    const callerNames = [...new Set(calls.map((call) => call.caller))].sort()
    const ties = readdirSync(join(dir, 'minds'))
      .filter((name) => name.endsWith('.db') && !name.startsWith('_'))
      .flatMap((name) => {
        const db = new Database(join(dir, 'minds', name), { readonly: true, fileMustExist: true })
        try {
          return db
            .prepare(`SELECT agent_id,kind,COALESCE(resolution,'open') AS resolution,COUNT(*) AS count
        FROM ties WHERE kind IN ('promise','debt','alliance') GROUP BY agent_id,kind,resolution`)
            .all()
        } finally {
          db.close()
        }
      })
    const result = {
      run: dir,
      throughTick: head,
      simDays: head / 1440,
      eventCount: events.length,
      scenes: {
        opened: starts.length,
        closed: closes.size,
        closeReasons: histogram(
          events
            .filter((ev) => ev.type === 'scene_closed')
            .map((ev) => String(ev.payload.closeReason)),
        ),
        openSceneTickCoverage: head ? covered / head : 0,
        lineCountByScene: perScene,
        note: 'Open-scene coverage is available context, not measured engagement, action, or viewer understanding.',
      },
      dialogue: {
        utterancesWithoutMirroredDuplicates: speech.length,
        exactRepeatedUtterances: spokenTexts.length - new Set(spokenTexts).size,
        sceneLineRetentionAt100LineCap: sceneLines.length
          ? Object.values(perScene).reduce((sum, count) => sum + Math.min(100, count), 0) /
            sceneLines.length
          : null,
        bySpeaker: histogram(speech.map((ev) => String(ev.payload.agentId))),
        note: 'Exact repeats are a diagnostic, not a judgment of conversational value. Delivery is verified by relay tests.',
      },
      actions: {
        completed: histogram(
          events
            .filter((ev) => ev.type === 'action_completed')
            .map((ev) => String(ev.payload.verb)),
        ),
        refusals: histogram(refusals.map((ev) => String(ev.payload.reason))),
        refusalCount: refusals.length,
        completedByResident: histogram(
          events
            .filter((ev) => ev.type === 'action_completed')
            .map((ev) => String(ev.payload.agentId)),
        ),
      },
      commitments: {
        counts: ties,
        note: 'Resident-authored beliefs and resolutions, not independent proof of fulfilment.',
      },
      thoughts: world
        .prepare(
          'SELECT agent_id,COUNT(*) AS count FROM observer_thoughts GROUP BY agent_id ORDER BY agent_id',
        )
        .all(),
      calls: callerNames.map((caller) => {
        const own = calls.filter((call) => call.caller === caller)
        return {
          caller,
          count: own.length,
          failed: own.filter((call) => !call.ok).length,
          latencyP50Ms: percentile(
            own.map((call) => call.latency_ms),
            0.5,
          ),
          latencyP95Ms: percentile(
            own.map((call) => call.latency_ms),
            0.95,
          ),
          inputTokens: own.reduce((sum, call) => sum + call.input_tokens, 0),
          outputTokens: own.reduce((sum, call) => sum + call.output_tokens, 0),
          costUsd: own.reduce((sum, call) => sum + call.cost_usd, 0),
        }
      }),
      costUsd: calls.reduce((sum, call) => sum + call.cost_usd, 0),
      reservations: ops
        .prepare(
          "SELECT status,COUNT(*) AS count,SUM(amount_usd) AS usd FROM llm_reservations WHERE status IN ('held','uncertain') GROUP BY status",
        )
        .all(),
      alerts: ops.prepare('SELECT kind,COUNT(*) AS count FROM alerts GROUP BY kind').all(),
      limits: [
        'No retention uplift measured.',
        'No inference that silence means failure.',
        'No private thoughts or asides exported.',
      ],
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    world.close()
    ops.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2]
  if (!directory)
    throw new Error('Usage: node --import tsx scripts/audit-watchability.ts RUN_DIRECTORY')
  auditWatchability(directory)
}
