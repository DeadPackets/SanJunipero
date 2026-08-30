import type { ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import sharp from 'sharp'
import { MINUTES_PER_DAY, momentToTick } from '@sj/shared'
// The deep path, never the package root: `@sj/narrator`'s index reaches @sj/llm and the `ai`
// SDK, which the scripted stream must never load (town/src/liveSeam.test.ts).
import { renderShareCard } from '@sj/narrator/shareCard'
import type { AssetCodex } from '@sj/forge'
import type { WorldMirror } from './worldMirror.js'
import type { Router } from './server.js'
import { reportOnce } from './degraded.js'
import { AGENT_ID } from './api.js'
import { makeSpriteReader, renderAgentCard, type AgentRead } from './agentCard.js'

export const TOWN_NAME = 'San Junipero'

/** The two suffixes the card route answers on. The router splits on `/`, so the extension is
 *  part of the last segment and this handler owns it. */
const SVG_EXT = '.svg'
const PNG_EXT = '.png'

export type ShareCardDeps = {
  mirror: WorldMirror
  narratorDb: Database.Database | null
  /** Null → a person's card is type only, which is what a world with no forge has to show. */
  getCodex: () => AssetCodex | null
}

/** What one link says about itself when somebody pastes it somewhere. The card is always the
 *  box `agentCard.ts` names, so `staticSite.ts` stamps the size and this says nothing about it. */
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

/** Somebody the world has, and the first sentence of the newest life the town wrote for them —
 *  their own words as they were written, and null rather than prose nobody wrote. */
function readAgent(deps: ShareCardDeps, id: string): AgentRead | null {
  const person = AGENT_ID.test(id) ? deps.mirror.state().agents[id] : undefined
  if (person === undefined) return null
  const life = one(
    deps.narratorDb,
    "SELECT body FROM publications WHERE kind = 'biography' AND subject_id = ? ORDER BY id DESC",
    id,
  )
  const body = words(life, 'body')
  return { id, name: person.name, line: /^[^.!?]*[.!?]/.exec(body?.trim() ?? '')?.[0] ?? null }
}

/** `/agent/:id` → that person. The client addresses one as `?agent=<id>` too; only the path is
 *  ever pasted, and only the path a crawler can read gets tags. */
export function shareRouteAgent(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length !== 2 || segs[0] !== 'agent') return null
  try {
    return decodeURIComponent(segs[1] ?? '')
  } catch {
    return null
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
  const agentId = shareRouteAgent(pathname)
  if (agentId !== null) {
    const read = readAgent(deps, agentId)
    if (read === null) return null
    return {
      title: `${read.name} — ${TOWN_NAME}`,
      description: read.line ?? `${read.name} of ${TOWN_NAME}.`,
      image: `/card/agent/${encodeURIComponent(read.id)}${PNG_EXT}`,
    }
  }
  const day = shareRouteDay(pathname, deps.mirror.state().tick)
  if (day === null) return null
  const read = readDay(deps, day)
  return {
    title: `${read.title} — ${TOWN_NAME}`,
    description: `Day ${read.day} in ${TOWN_NAME}. ${read.subtitle}`,
    image: `/card/moment/${read.day}/00:00${PNG_EXT}`,
  }
}

/** A card that is not one. Plain text, not JSON: what asked for it wanted an image. */
const failCard = (res: ServerResponse, status: number, why: string): void => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(why)
}

/** A recorded day never changes; the live day is rewritten as the town lives it. */
const CACHE = 'public, max-age=300'

/** The name a card path asks for and whether it wants the raster, or null for neither suffix. */
function splitExt(last: string): { name: string; png: boolean } | null {
  for (const ext of [PNG_EXT, SVG_EXT]) {
    if (last.endsWith(ext)) return { name: last.slice(0, -ext.length), png: ext === PNG_EXT }
  }
  return null
}

/**
 * Rasters held at once, keyed by the SVG they came from — so a retitled day or a newly written
 * life misses by construction. A person's card measures 43 ms of libuv's four-thread pool, which
 * is the same pool the tick thread reads files on, and an unfurl refetches on every preview.
 */
const MAX_RASTERS = 32
const rasters = new Map<string, Promise<Buffer>>()
function rasterize(svg: string): Promise<Buffer> {
  let png = rasters.get(svg)
  if (png === undefined) {
    png = sharp(Buffer.from(svg)).png().toBuffer()
    // A failed encode must not be this card's answer for the life of the process.
    png.catch(() => rasters.delete(svg))
    if (rasters.size >= MAX_RASTERS) rasters.delete(rasters.keys().next().value!)
    rasters.set(svg, png)
  }
  return png
}

/** The card, in the format the extension asked for. Every chat client refuses an SVG for
 *  `og:image`, so the PNG is what the tags point at and the SVG is what a person may look at. */
function sendCard(res: ServerResponse, png: boolean, card: string | Promise<string>): void {
  void Promise.resolve(card)
    .then(async (svg) => {
      if (!png) {
        res.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': CACHE,
        })
        res.end(svg)
        return
      }
      const bytes = await rasterize(svg)
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(bytes.length),
        'cache-control': CACHE,
      })
      res.end(bytes)
    })
    .catch((e: unknown) => {
      reportOnce(
        'shareCard.render',
        () => `a share card would not draw — ${e instanceof Error ? e.message : String(e)}`,
      )
      failCard(res, 500, 'card unavailable')
    })
}

export function mountShareCard(router: Router, deps: ShareCardDeps): void {
  const spriteFor = makeSpriteReader(deps.getCodex)

  router.route('GET', '/card/moment/:day/:time', (_req, res, params) => {
    const asked = splitExt(params.time ?? '')
    const day = Number(/^(?:day)?(\d+)$/.exec(params.day ?? '')?.[1] ?? NaN)
    if (asked === null || Number.isNaN(momentToTick(day, asked.name))) {
      failCard(res, 404, 'not found')
      return
    }
    const read = readDay(deps, day)
    sendCard(
      res,
      asked.png,
      renderShareCard({
        day: read.day,
        title: read.title,
        subtitle: `${asked.name} · ${read.subtitle}`,
        heat: read.heat,
      }),
    )
  })

  router.route('GET', '/card/agent/:file', (_req, res, params) => {
    const asked = splitExt(params.file ?? '')
    const read = asked === null ? null : readAgent(deps, asked.name)
    if (asked === null || read === null) {
      failCard(res, 404, 'not found')
      return
    }
    sendCard(
      res,
      asked.png,
      spriteFor(read.id).then((sprite) => renderAgentCard(read, sprite, TOWN_NAME)),
    )
  })
}
