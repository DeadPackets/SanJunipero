import { createReadStream, readFileSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CARD_HEIGHT, CARD_WIDTH } from './agentCard.js'
import { attr } from './http.js'
import { TITLE_JOIN, TOWN_NAME, type ShareMeta } from './shareCard.js'

// `/assets/:file` is the codex PNG route and 404s anything that is not a png, so the built client
// may not live under /assets. `@sj/web` emits to `client/` (vite.config.ts `build.assetsDir`).
export const CLIENT_ASSET_DIR = 'client'

const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
}
const OCTET = 'application/octet-stream'

const typeOf = (path: string): string =>
  TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? OCTET

/** The file a URL path names inside `root`, or null. Traversal is refused on the RESOLVED path
 *  rather than by pattern: `%2e%2e%2f`, `..%5c` and a symlink arrive as three different strings. */
export function resolveInRoot(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null // a malformed escape is not a file name
  }
  if (decoded.includes('\0')) return null
  const base = resolve(root)
  const full = resolve(base, `.${normalize(decoded.startsWith('/') ? decoded : `/${decoded}`)}`)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}

export type StaticSite = (req: IncomingMessage, res: ServerResponse, pathname: string) => boolean

const SCHEMA = { website: 'WebSite', profile: 'Person', article: 'Article' } as const

function jsonLd(meta: ShareMeta, url: string, image: string): string {
  const type = SCHEMA[meta.type]
  const base = { '@context': 'https://schema.org', '@type': type, url, image }
  const graph =
    type === 'Person'
      ? { ...base, name: meta.title.split(TITLE_JOIN)[0], description: meta.description }
      : type === 'Article'
        ? { ...base, headline: meta.title, description: meta.description }
        : { ...base, name: TOWN_NAME, description: meta.description }
  // `</script` inside a value would close the block; nothing else in JSON can escape it.
  return `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`
}

/** A crawler never runs the app, so this is the only head it sees. `origin` makes the card
 *  absolute — several crawlers refuse a relative `og:image`. */
export function withShareTags(html: string, meta: ShareMeta, origin = ''): string {
  const image = meta.image.startsWith('http') ? meta.image : origin + meta.image
  const url = origin + meta.canonical
  const tags = [
    `<meta name="description" content="${attr(meta.description)}" />`,
    `<link rel="canonical" href="${attr(url)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="${TOWN_NAME}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:url" content="${attr(url)}" />`,
    `<meta property="og:title" content="${attr(meta.title)}" />`,
    `<meta property="og:description" content="${attr(meta.description)}" />`,
    `<meta property="og:image" content="${attr(image)}" />`,
    `<meta property="og:image:width" content="${CARD_WIDTH}" />`,
    `<meta property="og:image:height" content="${CARD_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${attr(meta.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(meta.title)}" />`,
    `<meta name="twitter:description" content="${attr(meta.description)}" />`,
    `<meta name="twitter:image" content="${attr(image)}" />`,
    `<meta name="twitter:image:alt" content="${attr(meta.imageAlt)}" />`,
    jsonLd(meta, url, image),
  ].join('\n    ')
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(meta.title)}</title>`)
    .replace('</head>', `  ${tags}\n  </head>`)
}

export function originOf(req: IncomingMessage): string {
  const header = (name: string): string | null => {
    const v = req.headers[name]
    const first = (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim()
    return first === undefined || first === '' ? null : first
  }
  const host = header('x-forwarded-host') ?? header('host')
  if (host === null) return ''
  return `${header('x-forwarded-proto') ?? 'http'}://${host}`
}

/** A handler for everything the route table did not claim; returns false when the request was not
 *  ours. The client is a single-page app, so an unknown non-API path gets `index.html`. */
export function makeStaticSite(
  root: string,
  shareMeta?: (pathname: string) => ShareMeta | null,
): StaticSite {
  const indexPath = join(resolve(root), 'index.html')
  // The page is a build artifact inside the image: it cannot change under a running process, and
  // re-reading it per request puts a blocking syscall on the first byte of every visit.
  let page: string | null = null

  const sendFile = (res: ServerResponse, path: string, immutable: boolean): boolean => {
    let size: number
    try {
      const st = statSync(path)
      if (!st.isFile()) return false
      size = st.size
    } catch {
      return false
    }
    res.writeHead(200, {
      'content-type': typeOf(path),
      'content-length': String(size),
      // Hashed bundle files never change under their name; index.html always may.
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    createReadStream(path).pipe(res)
    return true
  }

  /** A path that is no page still gets the app — the client must be able to say so — but with a
   *  404, so a crawler stops indexing every typo as a soft duplicate of the town. */
  const sendApp = (req: IncomingMessage, res: ServerResponse, pathname: string): boolean => {
    if (shareMeta === undefined) return sendFile(res, indexPath, false)
    const meta = shareMeta(pathname)
    try {
      page ??= readFileSync(indexPath, 'utf8')
    } catch {
      return false
    }
    const html = meta === null ? page : withShareTags(page, meta, originOf(req))
    res.writeHead(meta === null ? 404 : 200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(html)),
      'cache-control': 'no-cache',
    })
    res.end(html)
    return true
  }

  return (req, res, pathname) => {
    if ((req.method ?? 'GET') !== 'GET' && req.method !== 'HEAD') return false
    const hit = resolveInRoot(root, pathname)
    if (
      hit !== null &&
      hit !== resolve(root) &&
      hit !== indexPath &&
      sendFile(res, hit, pathname.startsWith(`/${CLIENT_ASSET_DIR}/`))
    )
      return true
    // Deep links get the app; a missed API or asset call keeps its honest 404.
    if (pathname.startsWith('/api/') || pathname.startsWith('/assets/') || pathname === '/ws')
      return false
    return sendApp(req, res, pathname)
  }
}
