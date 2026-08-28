import type Database from 'better-sqlite3'
import { MINUTES_PER_DAY, momentToTick } from '@sj/shared'
// The deep path, never the package root: `@sj/narrator`'s index reaches @sj/llm and the `ai`
// SDK, which the scripted stream must never load (town/src/liveSeam.test.ts).
import { renderShareCard } from '@sj/narrator/shareCard'
import type { WorldMirror } from './worldMirror.js'
import type { Router } from './server.js'

export const TOWN_NAME = 'San Junipero'

/** The suffix the card route answers on. The router splits on `/`, so the extension is part of
 *  the last segment and this handler owns it. */
const CARD_EXT = '.svg'

export type ShareCardDeps = {
  mirror: WorldMirror
  narratorDb: Database.Database | null
}

/** What one link says about itself when somebody pastes it somewhere. */
export type ShareMeta = { title: string; description: string; image: string }

/** A day of the town as the card and the meta tags both read it. */
type DayRead = { day: number; title: string; subtitle: string; heat: number }

type Row = Record<string, unknown>

function one(db: Database.Database | null, sql: string, ...args: unknown[]): Row | null {
  if (db === null) return null
  try {
    return (db.prepare(sql).get(...args) as Row | undefined) ?? null
  } catch {
    // A narrator db that predates a table is a window onto an unfinished room, not an error.
    return null
  }
}

const words = (row: Row | null, key: string): string | null =>
  typeof row?.[key] === 'string' ? row[key] : null

function readDay(deps: ShareCardDeps, day: number): DayRead {
  const chapter = one(deps.narratorDb, 'SELECT title FROM chapters WHERE day = ?', day)
  const caption = one(
    deps.narratorDb,
    "SELECT body FROM publications WHERE kind = 'timelapse_caption' AND day = ? ORDER BY id DESC",
    day,
  )
  const heat = one(
    deps.narratorDb,
    `SELECT MAX(h.total) AS total FROM heat_scores h JOIN scenes s ON s.id = h.scene_id
     WHERE s.day = ?`,
    day,
  )
  return {
    day,
    title: words(chapter, 'title') ?? `Day ${day}`,
    subtitle: words(caption, 'body') ?? TOWN_NAME,
    heat: typeof heat?.total === 'number' ? heat.total : 0,
  }
}

/** `/moment/:day/:time` → that minute; `/` → the day the town is living. Anything else is not
 *  a page a link is ever pasted from, and gets no tags of its own. */
export function shareRouteDay(pathname: string, liveTick: number): number | null {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 0) return Math.floor(liveTick / MINUTES_PER_DAY)
  if (segs[0] !== 'moment') return null
  if (segs.length === 2) return null // `/moment/:id` names a scene, and a scene names its own day
  if (segs.length !== 3) return null
  const day = Number(/^(?:day)?(\d+)$/.exec(segs[1] ?? '')?.[1] ?? NaN)
  let time: string
  try {
    time = decodeURIComponent(segs[2] ?? '')
  } catch {
    return null
  }
  return Number.isNaN(momentToTick(day, time)) ? null : day
}

/** The three tags a paste needs, or null where the path is not a page. */
export function shareMeta(deps: ShareCardDeps, pathname: string): ShareMeta | null {
  const day = shareRouteDay(pathname, deps.mirror.state().tick)
  if (day === null) return null
  const read = readDay(deps, day)
  return {
    title: `${read.title} — ${TOWN_NAME}`,
    description: `Day ${read.day} in ${TOWN_NAME}. ${read.subtitle}`,
    image: `/card/moment/${read.day}/00:00${CARD_EXT}`,
  }
}

export function mountShareCard(router: Router, deps: ShareCardDeps): void {
  router.route('GET', '/card/moment/:day/:time', (_req, res, params) => {
    const miss = (): void => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
    const last = params.time ?? ''
    if (!last.endsWith(CARD_EXT)) {
      miss()
      return
    }
    const day = Number(/^(?:day)?(\d+)$/.exec(params.day ?? '')?.[1] ?? NaN)
    const time = last.slice(0, -CARD_EXT.length)
    if (Number.isNaN(momentToTick(day, time))) {
      miss()
      return
    }
    const read = readDay(deps, day)
    const svg = renderShareCard({
      day: read.day,
      title: read.title,
      subtitle: `${time} · ${read.subtitle}`,
      heat: read.heat,
    })
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      // A recorded day never changes; the live day is rewritten as the town lives it.
      'cache-control': 'public, max-age=300',
    })
    res.end(svg)
  })
}
