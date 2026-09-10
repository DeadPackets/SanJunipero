// A sim-day's camera work as a table, so pacing is a number instead of an afternoon of watching.
// The replay that feeds these rows lives in `directorTopFive.ts`; the camera it drives is here.
import { PEAK_SCORE, type StakeScore, TICK_REAL_MS, tickToMoment } from '@sj/shared'
import type { ZoomStop } from '../../web/src/render/camera.js'
import { type CameraClaim, CUT_MIN_MS } from '../../web/src/ui/directorCut.js'
import {
  type Shot,
  SHOT_STOP,
  type ShotKind,
  shotKindFor,
  type ShotSpec,
  type ShotTarget,
  nextShot,
  takeShot,
} from '../../web/src/ui/shot.js'

/** One shot the camera would have taken, closed at the tick the next one cut it off. */
export type ShotRow = {
  tick: number
  wallMs: number
  kind: ShotKind
  target: string
  stop: number
  dwellMs: number
  why: string
  beatId: string | null
}

export type ShotSummary = {
  shots: number
  simHours: number
  perSimHour: number
  medianDwellMs: number
  p90DwellMs: number
  kinds: Record<ShotKind, number>
  refused: number
  longestGapMs: number
}

const KINDS = Object.keys(SHOT_STOP) as ShotKind[]

/** The viewer's own cut floor read on ticks instead of a timer: `cutFloor` gates the GATEWAY's
 *  cut, so a round turn never meets it, and a refused cut lands on the first tick it may. */
export function tickFloor(): {
  hold: (cut: StakeScore | null, nowMs: number) => StakeScore | null
  refused: () => number
} {
  const castOf = (c: StakeScore): string => c.agentIds.join(' ')
  let last = -CUT_MIN_MS
  let shown: StakeScore | null = null
  let waiting = ''
  let refused = 0
  return {
    hold(cut, nowMs) {
      if (cut !== null && (shown === null || castOf(cut) !== castOf(shown))) {
        if (nowMs - last < CUT_MIN_MS) {
          // One want turned away is ONE refusal, however many ticks it stands there.
          if (waiting !== castOf(cut)) refused++
          waiting = castOf(cut)
          return shown
        }
        last = nowMs
      }
      waiting = ''
      shown = cut
      return shown
    },
    refused: () => refused,
  }
}

/** What the camera is looking at this tick, or null while the shot that is up stands. The key is
 *  what `driveShot` re-runs on: a walk starting mid-shot renames the kind, it does not cut. */
type Want = { spec: ShotSpec; key: string; target: string }

/** The camera the replay drives: one shot at a time, closed at the tick the next one cuts it
 *  off. It runs the browser's own latch, so a shot inside its own floor is not replaced here
 *  either and the table is the pacing a viewer would have got. There is no hand in a replay,
 *  so nothing ever overrides the floor. */
export function shotTape(nameOf: (id: string) => string): {
  at: (
    tick: number,
    claim: CameraClaim,
    of: { cut: StakeScore | null; walking: ReadonlySet<string>; fitted?: ZoomStop | undefined },
  ) => void
  close: (tick: number) => ShotRow[]
  /** ticks a scored cut could not be shown at all: its cast indoors and not in one room */
  holds: () => number
  /** wants the shot's own floor turned away, the browser's latch counted */
  underFloor: () => number
} {
  const rows: ShotRow[] = []
  const shown = new Set<string>()
  let running: { shot: Shot; target: string; tick: number } | null = null
  let runningKey = ''
  let framed = false
  let holds = 0
  let underFloor = 0

  const closeShot = (nowMs: number): void => {
    if (running === null) return
    rows.push({
      tick: running.tick,
      wallMs: running.shot.startedMs,
      kind: running.shot.kind,
      target: running.target,
      stop: running.shot.stop,
      dwellMs: nowMs - running.shot.startedMs,
      why: running.shot.why,
      beatId: running.shot.beatId,
    })
    running = null
  }

  const wantOf = (
    claim: CameraClaim,
    of: { cut: StakeScore | null; walking: ReadonlySet<string>; fitted?: ZoomStop | undefined },
  ): Want | null => {
    if (claim.by === 'cut' || claim.by === 'interior') {
      const room = claim.by === 'interior' ? claim.structureId : null
      const cut = of.cut
      const scene = cut?.sceneId ?? null
      const kind = shotKindFor({
        opening: scene !== null && !shown.has(scene),
        peak: (cut?.score ?? 0) >= PEAK_SCORE,
        indoors: room !== null,
        walking: claim.cast.length === 1 && of.walking.has(claim.cast[0]!),
        cast: claim.cast.length,
      })
      const target: ShotTarget =
        room === null ? { at: 'cast', ids: claim.cast } : { at: 'room', structureId: room }
      const spec: ShotSpec = { kind, target, why: cut?.why ?? '', beatId: scene }
      if (of.fitted !== undefined) spec.fitted = of.fitted
      return {
        spec,
        key: `${claim.by}|${room ?? claim.cast.join(' ')}`,
        target: claim.cast.map(nameOf).join(', '),
      }
    }
    if (claim.by === 'round') {
      const who = nameOf(claim.agentId)
      const kind = shotKindFor({
        opening: false,
        peak: false,
        indoors: false,
        walking: of.walking.has(claim.agentId),
        cast: 1,
      })
      return {
        spec: {
          kind,
          target: { at: 'body', id: claim.agentId },
          why: `nothing is scored, so the round turns to ${who}`,
        },
        key: `round|${claim.agentId}`,
        target: who,
      }
    }
    // The overview is the OPENING shot and only that: once the town has been framed, a claim the
    // map cannot show leaves the shot that is up standing.
    if (claim.by === 'town' && !framed) {
      return {
        spec: { kind: 'overview', target: { at: 'town' }, why: 'the camera opens on the town' },
        key: 'overview|town',
        target: 'the town',
      }
    }
    return null
  }

  return {
    at(tick, claim, of) {
      if (claim.by === 'hold') {
        if (of.cut !== null) holds++
        return
      }
      const want = wantOf(claim, of)
      framed = true
      if (want === null || want.key === runningKey) return
      const nowMs = tick * TICK_REAL_MS
      const shot = nextShot(running?.shot ?? null, want.spec, nowMs)
      if (running !== null && shot === running.shot) {
        underFloor++
        return
      }
      closeShot(nowMs)
      running = { shot: shot ?? takeShot(want.spec, nowMs), target: want.target, tick }
      runningKey = want.key
      const beat = want.spec.beatId
      if (typeof beat === 'string') shown.add(beat)
    },
    close(tick) {
      closeShot(tick * TICK_REAL_MS)
      return rows
    },
    holds: () => holds,
    underFloor: () => underFloor,
  }
}

/** Nearest rank, so every reported dwell is a dwell the town actually held. */
function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!
}

export function summarise(
  rows: readonly ShotRow[],
  span: { fromTick: number; toTick: number },
  refused: number,
): ShotSummary {
  const dwells = rows.map((r) => r.dwellMs).sort((a, b) => a - b)
  const kinds = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<ShotKind, number>
  for (const r of rows) kinds[r.kind]++
  const ticks = Math.max(0, span.toTick - span.fromTick)
  const simHours = ticks / 60
  const first = rows[0]
  const leadInMs = (first === undefined ? ticks : first.tick - span.fromTick) * TICK_REAL_MS
  return {
    shots: rows.length,
    simHours,
    perSimHour: simHours === 0 ? 0 : rows.length / simHours,
    medianDwellMs: percentile(dwells, 0.5),
    p90DwellMs: percentile(dwells, 0.9),
    kinds,
    refused,
    longestGapMs: Math.max(leadInMs, dwells[dwells.length - 1] ?? 0),
  }
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

const clock = (ms: number): string => {
  const t = Math.max(0, Math.round(ms / 1000))
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`
}

export function shotLines(rows: readonly ShotRow[]): string[] {
  return rows.map((r) => {
    const { day, time } = tickToMoment(r.tick)
    const head = `${String(r.tick).padStart(6)}  ${clock(r.wallMs)}  d${day} ${time}`
    const shot = `${r.kind.padEnd(9)} ${String(r.stop).padStart(4)}  ${secs(r.dwellMs).padStart(7)}`
    return `${head}  ${shot}  ${r.target}  ${r.beatId ?? '-'}  ${r.why}`
  })
}

export function summaryLines(s: ShotSummary): string[] {
  return [
    `shots            ${s.shots} over ${s.simHours.toFixed(1)} sim-hours`,
    `per sim-hour     ${s.perSimHour.toFixed(2)}`,
    `dwell median     ${secs(s.medianDwellMs)}`,
    `dwell p90        ${secs(s.p90DwellMs)}`,
    `refused by floor ${s.refused}`,
    `longest no cut   ${secs(s.longestGapMs)}`,
    `kinds            ${KINDS.map((k) => `${k} ${s.kinds[k]}`).join('   ')}`,
  ]
}
