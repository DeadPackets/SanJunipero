import { createReadStream, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Serving the built client from the world's own origin is what makes the stream one
// address instead of two terminals and a proxy.
//
// ★ THE BUILT CLIENT MAY NOT LIVE UNDER /assets. `/assets/:file` is the codex PNG route and it
// answers 404 to anything that is not a png, so a bundle emitted to vite's default
// `assets/` directory 404s on every one of its own scripts. `@sj/web` emits to `client/`
// instead (vite.config.ts `build.assetsDir`), and this constant is the other half of that pact.
export const CLIENT_ASSET_DIR = 'client'

const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
}
const OCTET = 'application/octet-stream'

const typeOf = (path: string): string => TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? OCTET

/**
 * The file a URL path names inside `root`, or null if it names nothing or names its way out.
 *
 * Traversal is refused on the RESOLVED path rather than by pattern, because `%2e%2e%2f`,
 * `..%5c` and a symlink all arrive here as different strings and leave as the same directory.
 */
export function resolveInRoot(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null                                   // a malformed escape is not a file name
  }
  if (decoded.includes('\0')) return null
  const base = resolve(root)
  const full = resolve(base, `.${normalize(decoded.startsWith('/') ? decoded : `/${decoded}`)}`)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}

export type StaticSite = (req: IncomingMessage, res: ServerResponse, pathname: string) => boolean

/**
 * A handler for everything the route table did not claim. Returns false when the request was
 * not ours, so the caller still answers its own 404.
 *
 * The client is a single-page app: an unknown path that is plainly not an API call is the
 * viewer deep-linking, and it gets `index.html` rather than a 404 they cannot read.
 */
export function makeStaticSite(root: string): StaticSite {
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

  return (req, res, pathname) => {
    if ((req.method ?? 'GET') !== 'GET' && req.method !== 'HEAD') return false
    const hit = resolveInRoot(root, pathname)
    if (hit !== null && hit !== resolve(root)
      && sendFile(res, hit, pathname.startsWith(`/${CLIENT_ASSET_DIR}/`))) return true
    // Deep links get the app; a missed API or asset call keeps its honest 404.
    if (pathname.startsWith('/api/') || pathname.startsWith('/assets/') || pathname === '/ws') return false
    return sendFile(res, indexPath, false)
  }
}
