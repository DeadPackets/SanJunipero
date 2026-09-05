import type { ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import { attr } from './http.js'
import { originOf } from './staticSite.js'
import type { Router } from './router.js'
import type { WorldMirror } from './worldMirror.js'

export type CrawlerDeps = { mirror: WorldMirror; narratorDb: Database.Database | null }

/** The town writes a page per person and a page per closed day; rebuilding the list on every
 *  crawl is a full agent scan, and a crawler asks in bursts. */
const SITEMAP_TTL_MS = 300_000

/** The read API, the operator's channel and the hashed bundle are machinery, not pages. */
const ROBOTS = [
  'User-agent: *',
  'Allow: /$',
  'Allow: /agent/',
  'Allow: /moment/',
  'Disallow: /api/',
  'Disallow: /admin/',
  'Disallow: /assets/',
  'Disallow: /card/',
  'Disallow: /client/',
  '',
]

function sitemapPaths(deps: CrawlerDeps): string[] {
  const paths = ['/']
  for (const a of Object.values(deps.mirror.state().agents)) {
    if (a.alive) paths.push(`/agent/${encodeURIComponent(a.id)}`)
  }
  try {
    const days = deps.narratorDb?.prepare('SELECT day FROM chapters ORDER BY day DESC').all() ?? []
    for (const row of days as { day: number }[]) paths.push(`/moment/${row.day}/00:00`)
  } catch {
    // a narrator db that predates the table has written no day yet
  }
  return paths
}

function sitemapXml(paths: readonly string[], origin: string): string {
  const urls = paths.map((p) => `  <url><loc>${attr(origin + p)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

const sendText = (res: ServerResponse, type: string, body: string): void => {
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'public, max-age=300',
  })
  res.end(body)
}

export function mountCrawlerRoutes(router: Router, deps: CrawlerDeps): void {
  router.route('GET', '/robots.txt', (req, res) => {
    sendText(res, 'text/plain', [...ROBOTS, `Sitemap: ${originOf(req)}/sitemap.xml`, ''].join('\n'))
  })

  // The PATHS are held, not the rendered xml: the origin is a header away from being anybody's,
  // and an origin in the key lets a stranger re-scan the town on every request.
  let held: { at: number; paths: string[] } | null = null
  const pathsNow = (): string[] => {
    const now = Date.now()
    if (held !== null && now - held.at <= SITEMAP_TTL_MS) return held.paths
    held = { at: now, paths: sitemapPaths(deps) }
    return held.paths
  }

  router.route('GET', '/sitemap.xml', (req, res) => {
    sendText(res, 'application/xml', sitemapXml(pathsNow(), originOf(req)))
  })
}
