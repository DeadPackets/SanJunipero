import { useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import type { StakeScore, ThreadRow } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { bustStyle, type BustStyle } from '../ui/bustStyle.js'
import { CONDITION_WORD, conditionsOf, stateLine, type Condition } from '../ui/status.js'
import { boardRows, heatShare } from '../ui/threadModel.js'
import { sharePercent } from './ShotBoard.js'

// Every living body, ranked by what it has riding on it. Pressure is read off the two scales
// the frame already carries normalised, so no unbounded number reaches the rail.

/** Head and shoulders at the size the direction drew. */
export const RAIL_BUST_PX = 44

/** ★ What a body has riding on it this minute, on the two scales the frame already carries with
 *  a denominator: the survey's share of its own leader, and a story's heat against its own peak.
 *  A body in neither is under no pressure, and that is a real answer in a quiet town. */
export function pressureIndex(
  board: readonly StakeScore[],
  threads: readonly ThreadRow[],
): Map<string, number> {
  const out = new Map<string, number>()
  const put = (id: string, v: number): void => {
    if (v > (out.get(id) ?? 0)) out.set(id, v)
  }
  for (const row of boardRows(board)) for (const id of row.cast) put(id, row.share)
  for (const t of threads) for (const id of t.members) put(id, heatShare(t.heat, t.peak))
  return out
}

export type Dossier = {
  id: string
  name: string
  /** the word and the minutes left, off the town's own state table */
  line: string
  /** the one condition worth a ring, or none at all */
  condition: Condition | null
  /** null off the live edge: the frames that carry pressure do not exist there, and nothing
   *  riding on nobody is a claim about the minute, not the absence of one */
  pressure: number | null
  /** in the camera's own cut this minute */
  onScreen: boolean
  /** a provider call is in flight for this body right now */
  deciding: boolean
  /** where this card stands. The DOM order never changes, so a reorder is a transform. */
  rank: number
}

export type RailOpts = {
  pressure: ReadonlyMap<string, number> | null
  /** `director.cut?.agentIds` — who the camera is scored for this minute */
  cutCast: readonly string[]
  /** `store.minds()` read down to the ones in flight; empty off the live edge */
  deciding?: ReadonlySet<string>
  now: number
}

/** ★ One card per living body. The camera's own cast leads: a rail beside a picture that never
 *  names who is in it is a rail about somebody else. Everything under that is pressure. */
export function dossiers(state: WorldState | null, opts: RailOpts): Dossier[] {
  if (state === null) return []
  const rows = Object.values(state.agents)
    .filter((a) => a.alive)
    .map((a) => ({
      id: a.id,
      name: a.name,
      line: stateLine(a, opts.now),
      condition: conditionsOf(a)[0] ?? null,
      pressure: opts.pressure === null ? null : (opts.pressure.get(a.id) ?? 0),
      onScreen: opts.cutCast.includes(a.id),
      deciding: opts.deciding?.has(a.id) ?? false,
      rank: 0,
    }))
  rows.sort(
    (a, b) =>
      Number(b.onScreen) - Number(a.onScreen) ||
      (b.pressure ?? 0) - (a.pressure ?? 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
  return rows.map((r, rank) => ({ ...r, rank }))
}

/** Who this is and what is wrong, for a reader who cannot see the bust. */
export const railLabel = (d: Dossier): string =>
  d.condition === null ? d.name : `${d.name}, ${CONDITION_WORD[d.condition]}`

const NO_BOARD: readonly StakeScore[] = []
const NO_THREADS: readonly ThreadRow[] = []

/** ★ THE DOSSIER RAIL. Everybody still living, in the order the town has them under pressure. */
export function DossierRail({ store }: { store: WorldStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const now = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const board = useSyncExternalStore(store.subscribe, store.board, store.board)
  const threads = useSyncExternalStore(store.subscribe, store.threads, store.threads)
  const director = useSyncExternalStore(store.subscribe, store.getDirector, store.getDirector)
  const minds = useSyncExternalStore(store.subscribe, store.minds, store.minds)
  useSyncExternalStore(store.subscribe, store.assetsSeq, store.assetsSeq)
  const cutCast = director?.cut?.agentIds

  // A scrub and a replay null both frames at once. The census is still true of the minute on
  // screen, what has been riding on it is simply not in hand, and zero would be a lie.
  const pressure = useMemo(
    () =>
      board === null && threads === null
        ? null
        : pressureIndex(board?.rows ?? NO_BOARD, threads?.threads ?? NO_THREADS),
    [board, threads],
  )
  const deciding = useMemo(
    () => new Set([...minds].filter(([, m]) => m.state === 'deciding').map(([id]) => id)),
    [minds],
  )
  const cards = dossiers(state, { pressure, cutCast: cutCast ?? [], deciding, now })
  if (cards.length === 0) return null
  return (
    <DossierRailBody
      cards={cards}
      bustOf={(id) => bustStyle(store.assetRecords(), id, RAIL_BUST_PX)}
    />
  )
}

const NO_BUST = (): BustStyle | null => null

/** The markup alone, so the rail can be driven without a browser. */
export function DossierRailBody({
  cards,
  bustOf = NO_BUST,
}: {
  cards: readonly Dossier[]
  bustOf?: (agentId: string) => BustStyle | null
}) {
  return (
    <aside className="dossier-rail at-deck">
      <ol className="dossier-cards" style={{ '--rows': cards.length } as CSSProperties}>
        {cards.map((d) => {
          const bust = bustOf(d.id)
          return (
            <li
              className={d.onScreen ? 'dossier-card lit' : 'dossier-card'}
              data-deciding={d.deciding ? '' : undefined}
              key={d.id}
              style={{ '--rank': d.rank } as CSSProperties}
            >
              {d.pressure !== null && (
                <span className="dossier-gutter" aria-hidden="true">
                  <span
                    className="dossier-gutter-fill"
                    style={{ height: sharePercent(d.pressure) }}
                  />
                </span>
              )}
              <span
                aria-label={railLabel(d)}
                className={bust === null ? 'dossier-bust none' : 'dossier-bust'}
                data-cond={d.condition ?? undefined}
                role="img"
                style={bust ?? undefined}
              />
              <p className="dossier-name">{d.name}</p>
              <p className="dossier-doing">{d.line}</p>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
