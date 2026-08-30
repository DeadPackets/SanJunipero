import { createReadStream, readFileSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CARD_HEIGHT, CARD_WIDTH } from './agentCard.js'
import { attr } from './http.js'
import type { ShareMeta } from './shareCard.js'

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

/** The share tags for one deep link, written into the head a crawler reads. A crawler never runs
 *  the app, so a single-page title is the only title it would otherwise ever see. */
export function withShareTags(html: string, meta: ShareMeta): string {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${attr(meta.title)}" />`,
    `<meta property="og:description" content="${attr(meta.description)}" />`,
    `<meta property="og:image" content="${attr(meta.image)}" />`,
    `<meta property="og:image:width" content="${CARD_WIDTH}" />`,
    `<meta property="og:image:height" content="${CARD_HEIGHT}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(meta.title)}" />`,
    `<meta name="twitter:description" content="${attr(meta.description)}" />`,
    `<meta name="twitter:image" content="${attr(meta.image)}" />`,
  ].join('\n    ')
  return html.replace('</head>', `  ${tags}\n  </head>`)
}

/** A handler for everything the route table did not claim; returns false when the request was not
 *  ours. The client is a single-page app, so an unknown non-API path gets `index.html`. */
export function makeStaticSite(
  root: string,
  /** what this path is worth saying to a crawler, or null where it is not a page */
  shareMeta?: (pathname: string) => ShareMeta | null,
): StaticSite {
  const indexPath = join(resolve(root), 'index.html')

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

  /** The app, with this link's own share tags in its head. Falls back to the file on disk when
   *  the page is not one a link is pasted from, or when index.html cannot be read. */
  const sendApp = (res: ServerResponse, pathname: string): boolean => {
    const meta = shareMeta?.(pathname) ?? null
    if (meta === null) return sendFile(res, indexPath, false)
    let html: string
    try {
      html = withShareTags(readFileSync(indexPath, 'utf8'), meta)
    } catch {
      return false
    }
    res.writeHead(200, {
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
    return sendApp(res, pathname)
  }
}
