import { MINUTES_PER_DAY, THREAD_MEMBER_CAP, type StakeScore, type ThreadRow } from '@sj/shared'
import { ladderLine, remember, type LadderLine, type Ledger } from './sentenceLadder.js'

// What a capsule draws from, and nothing a renderer can get wrong. No raw score leaves this
// file: a bar is a share of something the same frame carries, or there is no bar.

/** The one word a surface writes for a sign. Every panel that paints a valence reads it here, so
 *  a courtship and a quarrel wear the same two colours wherever they are drawn. */
export const VALENCE_TONE = { '-1': 'cost', '0': 'plain', '1': 'gain' } as const

export type Capsule = {
  id: string
  /** the bodies a 320px capsule can overlap, in the order they paid */
  cast: readonly string[]
  /** members past the busts, as a count */
  more: number
  /** the town's own sentence for this story, or null when it has not written one */
  line: LadderLine | null
  /** sim-days running, to one place */
  days: number
  heatShare: number
  state: ThreadRow['state']
  valence: ThreadRow['valence']
  arc?: ThreadRow['arc']
  /** the story the camera is on. Usually NOT the first capsule. */
  onScreen: boolean
  /** the story this one became. A story that merges away says so once and hands over. */
  handover: string | null
}

/** Sim-days to one place, never negative: a scrub can put `now` behind a story's own opening. */
export const daysRunning = (openedTick: number, now: number): number =>
  Math.round((Math.max(0, now - openedTick) / MINUTES_PER_DAY) * 10) / 10

/** Heat against the story's own high-water mark. A bad frame cannot push a bar past its box. */
export const heatShare = (heat: number, peak: number): number => {
  if (!Number.isFinite(heat) || !Number.isFinite(peak) || peak <= 0) return 0
  return Math.min(1, Math.max(0, heat / peak))
}

/** The row the camera's cut is in. A cut's cast can straddle two stories, so the widest overlap
 *  wins and never two rows, and no overlap at all marks nothing. */
function onScreenIndex(rows: readonly ThreadRow[], cutCast: readonly string[]): number {
  let best = -1
  let hits = 0
  rows.forEach((row, i) => {
    let n = 0
    for (const id of cutCast) if (row.members.includes(id)) n++
    if (n > hits) {
      hits = n
      best = i
    }
  })
  return best
}

export type CapsuleOpts = {
  now: number
  /** `director.cut?.agentIds` — who the camera is scored for this minute */
  cutCast?: readonly string[]
  /** the shared chronicle sentence for the newest event this story owns, if the caller has one */
  chronicleOf?: (row: ThreadRow) => string | null
  /** carried across frames so the same head is not written twice inside twenty minutes */
  ledger?: Ledger
}

export function threadCapsules(rows: readonly ThreadRow[], opts: CapsuleOpts): Capsule[] {
  const ledger = opts.ledger ?? new Map<string, number>()
  const lit = onScreenIndex(rows, opts.cutCast ?? [])
  return rows.map((row, i) => {
    // No `cast` and no `terms`: `whyOf` is the camera's reason and never a story's title.
    const line = ladderLine(
      {
        beat: row.beat,
        summary: row.summary,
        proseTick: row.proseTick,
        chronicle: opts.chronicleOf?.(row) ?? null,
      },
      opts.now,
      ledger,
    )
    remember(ledger, line, opts.now)
    return {
      id: row.id,
      cast: row.members.slice(0, THREAD_MEMBER_CAP),
      more: Math.max(0, row.members.length - THREAD_MEMBER_CAP),
      line,
      days: daysRunning(row.openedTick, opts.now),
      heatShare: heatShare(row.heat, row.peak),
      state: row.state,
      valence: row.valence,
      arc: row.arc,
      onScreen: i === lit,
      handover: row.became ?? null,
    }
  })
}

export type BoardRow = {
  sceneId: string | null
  cast: readonly string[]
  why: string
  /** against the top row of the same frame, so the bars always have a full one */
  share: number
  beatId?: string | undefined
}

/** The shot board, normalised where the frame it came in is still to hand. The gateway's score
 *  is unbounded and has no denominator of its own, so it never reaches a renderer. */
export function boardRows(rows: readonly StakeScore[]): BoardRow[] {
  const top = rows[0]?.score ?? 0
  return rows.map((row) => ({
    sceneId: row.sceneId,
    cast: row.agentIds,
    why: row.why,
    share: heatShare(row.score, top),
    beatId: row.beatId,
  }))
}
