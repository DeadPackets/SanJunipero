import { MINUTES_PER_DAY, castWords, whyOf, type StakeTerm } from '@sj/shared'

// Every head on screen is the town's own sentence if the town has written one. The fixed
// vocabulary is the last rung and never the first, because two of its 24 strings set at 21px
// read as a slot machine by the second afternoon.

type LadderRung = 'beat' | 'summary' | 'chronicle' | 'chapter' | 'why'

/** Twenty sim minutes. A head said twice inside that reads as a stuck record, so the ladder
 *  drops a rung rather than repeat itself. */
export const LADDER_RECENT_TICKS = 20

/** A sim-day. A line this old is still the town's own words and still true of this story, so it
 *  is marked and kept: every rung under it is further from what happened, not closer. */
const LADDER_STALE_TICKS = MINUTES_PER_DAY

export type LadderSource = {
  beat?: string | undefined
  summary?: string | undefined
  /** when the town wrote the beat or the summary */
  proseTick?: number | undefined
  /** the shared chronicle sentence for the newest event this story owns */
  chronicle?: string | null
  /** the narrator's chapter title, for a day-level head */
  chapter?: string | null
  /** The last rung fires only with both of these, and only the camera passes them: `whyOf` is
   *  the camera's stated reason and is never a thread's title. */
  cast?: readonly string[] | undefined
  terms?: readonly StakeTerm[] | undefined
}

/** What was said lately and when. Injected, so a test drives the whole ladder without a clock. */
export type Ledger = Map<string, number>

export type LadderLine = { text: string; rung: LadderRung; ageTicks: number; stale: boolean }

const said = (ledger: Ledger, text: string, now: number): boolean => {
  const at = ledger.get(text)
  return at !== undefined && Math.abs(now - at) < LADDER_RECENT_TICKS
}

const why = (src: LadderSource): string | null => {
  if (src.cast === undefined || src.terms === undefined || src.terms.length === 0) return null
  return whyOf(castWords(src.cast), src.terms.slice(0, 2))
}

/** The line and the rung it came from, or null when the town has nothing to say about this and
 *  the caller is not the camera. Nothing here writes a sentence. */
export function ladderLine(src: LadderSource, now: number, ledger: Ledger): LadderLine | null {
  const rungs: readonly (readonly [LadderRung, string | null | undefined])[] = [
    ['beat', src.beat],
    ['summary', src.summary],
    ['chronicle', src.chronicle],
    ['chapter', src.chapter],
    ['why', why(src)],
  ]
  for (const [rung, raw] of rungs) {
    const text = raw?.trim() ?? ''
    if (text === '' || said(ledger, text, now)) continue
    const prose = rung === 'beat' || rung === 'summary'
    const ageTicks = prose && src.proseTick !== undefined ? Math.max(0, now - src.proseTick) : 0
    return { text, rung, ageTicks, stale: ageTicks >= LADDER_STALE_TICKS }
  }
  return null
}

/** Book a line as said. Anything past the window is dropped on the way through, so a session
 *  ledger stays the size of what is on screen. */
export function remember(ledger: Ledger, line: LadderLine | null, now: number): void {
  if (line === null) return
  for (const [text, at] of ledger)
    if (Math.abs(now - at) >= LADDER_RECENT_TICKS) ledger.delete(text)
  ledger.set(line.text, now)
}
