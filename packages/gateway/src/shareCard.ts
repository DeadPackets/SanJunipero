import type { ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import sharp from 'sharp'
import { MINUTES_PER_DAY, momentToTick } from '@sj/shared'
// The deep path, never the package root: `@sj/narrator`'s index reaches @sj/llm and the `ai`
// SDK, which the scripted stream must never load (town/src/liveSeam.test.ts).
import { renderShareCard } from '@sj/narrator/shareCard'
import type { AssetCodex } from '@sj/forge'
import type { WorldMirror } from './worldMirror.js'
import type { Router } from './router.js'
import { reportOnce } from './degraded.js'
import { AGENT_ID } from './api.js'
import { makeSpriteReader, renderAgentCard, type AgentRead } from './agentCard.js'

export const TOWN_NAME = 'San Junipero'

export const TOWN_STRAPLINE = 'A town of minds that live their own days, watched kindly.'

/** `staticSite.ts` splits a title back on this for the structured data. */
export const TITLE_JOIN = ' — '

const SVG_EXT = '.svg'
const PNG_EXT = '.png'

export type ShareCardDeps = {
  mirror: WorldMirror
  narratorDb: Database.Database | null
  getCodex: () => AssetCodex | null
}

export type ShareMeta = {
  title: string
  description: string
  image: string
  imageAlt: string
  type: 'website' | 'profile' | 'article'
  canonical: string
}

type DayRead = { day: number; title: string; subtitle: string }

type Row = Record<string, unknown>

function one(db: Database.Database | null, sql: string, ...args: unknown[]): Row | null {
  if (db === null) return null
  try {
    return (db.prepare(sql).get(...args) as Row | undefined) ?? null
  } catch {
    // A narrator db that predates a table is not an error: the table is simply not written yet.
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
  return {
    day,
    title: words(chapter, 'title') ?? `Day ${day}`,
    subtitle: words(caption, 'body') ?? TOWN_STRAPLINE,
  }
}

function readHeat(deps: ShareCardDeps, day: number): number {
  const heat = one(
    deps.narratorDb,
    `SELECT MAX(h.total) AS total FROM heat_scores h JOIN scenes s ON s.id = h.scene_id
     WHERE s.day = ?`,
    day,
  )
  return typeof heat?.total === 'number' ? heat.total : 0
}

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

/** Only the path form gets tags: `?agent=<id>` addresses a person too but is never pasted. */
export function shareRouteAgent(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length !== 2 || segs[0] !== 'agent') return null
  try {
    return decodeURIComponent(segs[1] ?? '')
  } catch {
    return null
  }
}

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

export function shareRouteScene(pathname: string): number | null {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length !== 2 || segs[0] !== 'moment') return null
  const id = Number(segs[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

function dayMeta(deps: ShareCardDeps, day: number, at: string): ShareMeta {
  const read = readDay(deps, day)
  const home = at === '/'
  return {
    title: `${read.title}${TITLE_JOIN}${TOWN_NAME}`,
    description: `Day ${read.day} in ${TOWN_NAME}. ${read.subtitle}`,
    image: `/card/moment/${read.day}/00:00${PNG_EXT}`,
    imageAlt: `${read.title} — day ${read.day} of ${TOWN_NAME}`,
    type: home ? 'website' : 'article',
    canonical: at,
  }
}

export function shareMeta(deps: ShareCardDeps, pathname: string): ShareMeta | null {
  const agentId = shareRouteAgent(pathname)
  if (agentId !== null) {
    if (!AGENT_ID.test(agentId)) return null
    const read = readAgent(deps, agentId)
    const canonical = `/agent/${encodeURIComponent(agentId)}`
    // Somebody the world no longer has is still a page: the link was true when it was pasted.
    if (read === null)
      return {
        title: `Someone the town no longer has${TITLE_JOIN}${TOWN_NAME}`,
        description: `${TOWN_STRAPLINE} This one has walked out of the record.`,
        image: `/card/moment/${Math.floor(deps.mirror.state().tick / MINUTES_PER_DAY)}/00:00${PNG_EXT}`,
        imageAlt: TOWN_NAME,
        type: 'profile',
        canonical,
      }
    return {
      title: `${read.name}${TITLE_JOIN}${TOWN_NAME}`,
      description: read.line ?? `${read.name} of ${TOWN_NAME}.`,
      image: `/card/agent/${encodeURIComponent(read.id)}${PNG_EXT}`,
      imageAlt: `${read.name} of ${TOWN_NAME}`,
      type: 'profile',
      canonical,
    }
  }

  const sceneId = shareRouteScene(pathname)
  if (sceneId !== null) {
    const scene = one(deps.narratorDb, 'SELECT day FROM scenes WHERE id = ?', sceneId)
    if (typeof scene?.day !== 'number') return null
    return dayMeta(deps, scene.day, `/moment/${sceneId}`)
  }

  const day = shareRouteDay(pathname, deps.mirror.state().tick)
  if (day === null) return null
  return dayMeta(deps, day, pathname === '/' ? '/' : `/moment/${day}/00:00`)
}

/** Plain text, not JSON: whatever asked for this wanted an image. */
const failCard = (res: ServerResponse, status: number, why: string): void => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(why)
}

/** A day the town has finished never changes again; the live day is rewritten as it is lived. */
const CACHE_LIVE = 'public, max-age=300'
const CACHE_CLOSED = 'public, max-age=31536000, immutable'

function splitExt(last: string): { name: string; png: boolean } | null {
  for (const ext of [PNG_EXT, SVG_EXT]) {
    if (last.endsWith(ext)) return { name: last.slice(0, -ext.length), png: ext === PNG_EXT }
  }
  return null
}

/** A person's card measures 43 ms of libuv's four-thread pool — the pool the tick thread reads
 *  files on — and an unfurl refetches on every preview. */
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

/** Every chat client refuses an SVG for `og:image`, so the tags point at the PNG. */
function sendCard(
  res: ServerResponse,
  png: boolean,
  card: string | Promise<string>,
  cache: string = CACHE_LIVE,
): void {
  void Promise.resolve(card)
    .then(async (svg) => {
      if (!png) {
        res.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': cache,
        })
        res.end(svg)
        return
      }
      const bytes = await rasterize(svg)
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(bytes.length),
        'cache-control': cache,
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
    const live = Math.floor(deps.mirror.state().tick / MINUTES_PER_DAY)
    sendCard(
      res,
      asked.png,
      renderShareCard({
        day: read.day,
        title: read.title,
        subtitle: `${asked.name} · ${read.subtitle}`,
        heat: readHeat(deps, day),
      }),
      day < live ? CACHE_CLOSED : CACHE_LIVE,
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
