import { useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import type { StakeScore } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { boardRows, type BoardRow } from '../ui/threadModel.js'

// What the camera nearly cut to. The survey is ordered by a raw score and the shot is sticky,
// so a challenger takes row one for a while before the cut hands over. That gap IS the pre-roll.

/** Three rows in the 116px box the direction drew. */
export const BOARD_ROOM = 3

/** The gateway's own identity for a candidate: `stakes.ts` dedupes its survey on exactly this
 *  string, so two rows that share it are one row and the heavier of them stands. */
export const boardKey = (sceneId: string | null, cast: readonly string[]): string =>
  `${sceneId ?? ''}|${cast.join(' ')}`

/** The row the camera holds. A holder whose score has fallen off the survey's top five is on no
 *  row at all, and then the board lights nothing rather than lighting the wrong thing. */
export const holderKey = (cut: StakeScore | null | undefined): string | null =>
  cut === null || cut === undefined ? null : boardKey(cut.sceneId, cut.agentIds)

/** `whyOf` joins the cast to the reasons with one colon, and a row with no reasons is the cast
 *  alone. Split so the names and the reason can be set in different faces. */
export function splitWhy(why: string): { who: string; reason: string | null } {
  const at = why.indexOf(': ')
  return at < 0 ? { who: why, reason: null } : { who: why.slice(0, at), reason: why.slice(at + 2) }
}

export type BoardCard = {
  key: string
  who: string
  reason: string | null
  /** against the top row of the same frame, so the bars always have a full one */
  share: number
  lit: boolean
  /** where this row stands this frame. The DOM order never changes, so a reorder is a
   *  transform and never a layout pass. */
  rank: number
}

/** ★ The three the board has room for, and the shot the camera holds even when it has fallen
 *  past them. A board that drops the row its own picture is standing under contradicts it. */
export function boardCards(
  rows: readonly BoardRow[],
  cut: StakeScore | null,
  room = BOARD_ROOM,
): BoardCard[] {
  if (room < 1) return []
  const held = holderKey(cut)
  const keyed = rows.map((r) => ({ ...r, key: boardKey(r.sceneId, r.cast) }))
  let shown = keyed.slice(0, room)
  if (held !== null && !shown.some((r) => r.key === held)) {
    const holder = keyed.find((r) => r.key === held)
    if (holder !== undefined) shown = [...shown.slice(0, room - 1), holder]
  }
  return shown
    .map((r, rank) => ({
      key: r.key,
      ...splitWhy(r.why),
      share: r.share,
      lit: r.key === held,
      rank,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** ★ THE SHOT BOARD. What the camera nearly cut to, so a cut is announced rather than sprung. */
export function ShotBoard({ store }: { store: WorldStore }) {
  const board = useSyncExternalStore(store.subscribe, store.board, store.board)
  const director = useSyncExternalStore(store.subscribe, store.getDirector, store.getDirector)
  const cut = director?.cut ?? null

  const cards = useMemo(
    () => (board === null ? [] : boardCards(boardRows(board.rows), cut)),
    [board, cut],
  )
  // Null is a scrub or a replay, and empty is a quiet minute with nothing scored anywhere. The
  // board ranks what the survey holds, so with nothing to rank it says nothing.
  if (cards.length === 0) return null
  return <ShotBoardBody cards={cards} />
}

/** The markup alone, so the board can be driven without a browser. */
export function ShotBoardBody({ cards }: { cards: readonly BoardCard[] }) {
  return (
    <aside className="shot-board at-deck">
      <ol className="shot-rows">
        {cards.map((c) => (
          <li
            className={c.lit ? 'shot-row lit' : 'shot-row'}
            key={c.key}
            style={{ '--rank': c.rank } as CSSProperties}
          >
            <p className="shot-line">
              <span className="shot-who">{c.who}</span>
              {c.reason !== null && <span className="shot-why">{c.reason}</span>}
            </p>
            <span className="shot-bar" aria-hidden="true">
              <span className="shot-bar-fill" style={{ width: sharePercent(c.share) }} />
            </span>
          </li>
        ))}
      </ol>
    </aside>
  )
}

/** A share of the leader in the same frame. The gateway's score is unbounded and never leaves
 *  the model, so this is the only width the board can draw. */
export const sharePercent = (share: number): string =>
  `${(Math.min(1, Math.max(0, share)) * 100).toFixed(1)}%`
