import { useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import { WHY_NAMES_MAX, agentName, castWords, type ThreadRow } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { bustStyle } from '../ui/bustStyle.js'
import { VALENCE_TONE, threadCapsules, type Capsule } from '../ui/threadModel.js'

/** Three capsules at 320px is 984px of a 1920px band. The sheet drops the second and the third
 *  under 900px rather than a resize listener doing it. */
export const STRIP_ROOM = 3

/** The bust the strip overlaps, in CSS pixels of the source frame. */
export const STRIP_BUST_PX = 26

/** What the strip says when the town holds no running story. True of the frame it came in and
 *  of nothing else: the gateway ships an empty list when nothing is above the thread floor. */
export const STRIP_QUIET = 'No story is running.'

/** Sim-days with the unit on them. The one figure the strip prints. */
export function daysWord(days: number): string {
  const d = Math.max(0, days)
  return `${d.toFixed(1)} ${d === 1 ? 'day' : 'days'}`
}

/** The state word, and the goodbye of a story that merged away. */
export const stateWord = (c: Capsule): string =>
  c.handover === null ? c.state.toUpperCase() : 'HANDED OVER'

/** The heat bar as the sheet reads it. A share, never the raw heat: nothing on this band is an
 *  unbounded number. */
export const shareStyle = (share: number): CSSProperties =>
  ({ '--share': `${(Math.min(1, Math.max(0, share)) * 100).toFixed(1)}%` }) as CSSProperties

/** ★ The three the strip has room for, and never without the story the camera is on. The
 *  ribbon's head agrees with the cut on 47.9% of ticks, so a strip taken off the top alone
 *  contradicts the picture it stands under about half the time. */
export function stripCast(caps: readonly Capsule[], room = STRIP_ROOM): Capsule[] {
  const top = caps.slice(0, room)
  if (room < 1 || top.some((c) => c.onScreen)) return top
  const lit = caps.find((c) => c.onScreen)
  return lit === undefined ? top : [...top.slice(0, room - 1), lit]
}

/** Who a story handed itself to, said as the town names them. Null when the surviving story is
 *  not in the same frame, because a thread id is not a thing a viewer may be shown. */
export function becameWords(
  rows: readonly ThreadRow[],
  id: string | null,
  nameOf: (agentId: string) => string,
): string | null {
  if (id === null) return null
  const row = rows.find((r) => r.id === id)
  return row === undefined ? null : castWords(row.members.map((m) => nameOf(m)))
}

/** Everyone in a story, for a reader who cannot see the busts. `castWords` names three, so the
 *  count covers the fourth bust as well as the members past the cap. */
export function castLabel(c: Capsule, nameOf: (agentId: string) => string): string {
  const said = castWords(c.cast.map((id) => nameOf(id)))
  const rest = c.cast.length + c.more - Math.min(WHY_NAMES_MAX, c.cast.length)
  return rest > 0 ? `${said} and ${String(rest)} more` : said
}

/** ★ THE STORY STRIP. The one band that says what has been running here without you. Present in
 *  every mode, and honest in a quiet town: it never writes a sentence the town did not. */
export function StoryStrip({ store }: { store: WorldStore }) {
  const threads = useSyncExternalStore(store.subscribe, store.threads, store.threads)
  const director = useSyncExternalStore(store.subscribe, store.getDirector, store.getDirector)
  const cut = director?.cut?.agentIds

  // ★ A ledger of its own per pass. `remember` books every line it hands back, so a ledger kept
  // across renders reads the strip's own last frame as the town repeating itself and drops the
  // sentence: one director frame is enough to take every head off the band.
  const shown = useMemo(
    () =>
      threads === null
        ? []
        : stripCast(
            threadCapsules(threads.threads, {
              now: threads.tick,
              cutCast: cut ?? [],
              ledger: new Map(),
            }),
          ),
    [threads, cut],
  )

  // Null is a scrub or a replay: the frame does not exist off the live edge, so the band claims
  // nothing at all rather than standing empty.
  if (threads === null) return null

  const nameOf = (id: string): string => agentName(store.getState()?.agents, id)
  const records = store.assetRecords()

  return (
    <div className="story-strip">
      {shown.length === 0 ? (
        <p className="story-quiet">{STRIP_QUIET}</p>
      ) : (
        <ol className="story-row">
          {shown.map((c, i) => {
            const became = becameWords(threads.threads, c.handover, nameOf)
            const names = castLabel(c, nameOf)
            return (
              <li
                key={c.id}
                className={c.onScreen ? 'story-capsule lit' : 'story-capsule'}
                data-tone={VALENCE_TONE[`${c.valence}`]}
                style={{ '--step': i } as CSSProperties}
              >
                <span className="story-cast" role="img" aria-label={names}>
                  {c.cast.map((id) => {
                    const bust = bustStyle(records, id, STRIP_BUST_PX)
                    return (
                      <span
                        key={id}
                        className={bust === null ? 'story-bust none' : 'story-bust'}
                        style={bust ?? undefined}
                      />
                    )
                  })}
                </span>
                <p className="story-meta">
                  {c.onScreen && <span className="story-here">ON SCREEN</span>}
                  <span className="story-state">{stateWord(c)}</span>
                  {became !== null && <span className="story-became">to {became}</span>}
                  <span className="story-days">{daysWord(c.days)}</span>
                </p>
                <p className="story-line" data-stale={c.line?.stale === true ? 'yes' : undefined}>
                  {c.line?.text ?? names}
                </p>
                <span className="story-heat" aria-hidden="true">
                  <span className="story-heat-fill" style={shareStyle(c.heatShare)} />
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
