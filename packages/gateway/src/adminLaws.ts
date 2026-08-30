import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { TOGGLABLE_PATHS } from '@sj/engine'
import { reportOnce } from './degraded.js'
import { sendJson } from './http.js'

const ADMIN_LAWS_PATH = '/admin/laws'
const DEFAULT_ADMIN_HOST = '127.0.0.1'
const MAX_BODY_BYTES = 4096

const LawRequest = z.object({ path: z.string().min(1), value: z.unknown() })

/** A `:name` segment reaches `handle` as a param; the bearer and interface are already checked. */
export type AdminRoute = {
  method: string
  path: string
  handle: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void
}

export type LawsAdminOpts = {
  // Injected: this listener never touches the engine, it only hands a change on.
  submitLaw: (path: string, value: unknown) => void
  token: string
  host?: string
  routes?: readonly AdminRoute[]
}

export function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let text = ''
    let over = false
    req.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      if (text.length > MAX_BODY_BYTES) over = true
    })
    req.on('end', () => {
      resolve(over ? null : text)
    })
    req.on('error', () => {
      resolve(null)
    })
  })
}

function match(route: AdminRoute, pathname: string): Record<string, string> | null {
  const want = route.path.split('/').filter(Boolean)
  const got = pathname.split('/').filter(Boolean)
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    const seg = want[i]!
    if (seg.startsWith(':')) params[seg.slice(1)] = got[i]!
    else if (seg !== got[i]) return null
  }
  return params
}

// The admin channel is a separate server on a separate port from the read-only
// viewer socket, so no viewer connection can ever reach a write path.
export function createLawsAdmin(opts: LawsAdminOpts): Server {
  const host = opts.host ?? DEFAULT_ADMIN_HOST
  // Binding is the operator's job; this is the second lock — a listener started on 0.0.0.0
  // still refuses every request that did not arrive on the configured address.
  const wrongInterface = (req: IncomingMessage): boolean =>
    host !== '0.0.0.0' &&
    host !== '::' &&
    (req.socket.localAddress ?? '').replace(/^::ffff:/, '') !== host

  const laws: AdminRoute = {
    method: 'POST',
    path: ADMIN_LAWS_PATH,
    handle: (req, res) => {
      void readBody(req).then((text) => {
        if (text === null) {
          sendJson(res, { error: 'body unreadable' }, 400)
          return
        }
        let parsed: z.infer<typeof LawRequest>
        try {
          parsed = LawRequest.parse(JSON.parse(text))
        } catch {
          sendJson(res, { error: 'expected {path, value}' }, 400)
          return
        }
        const schema = TOGGLABLE_PATHS[parsed.path]
        if (schema === undefined) {
          sendJson(res, { error: `${parsed.path} is not a world law` }, 400)
          return
        }
        // The fold THROWS on a value its schema rejects, so a cheerful 202 here
        // would take the world down at the next tick boundary. Refuse it now.
        const value = schema.safeParse(parsed.value)
        if (!value.success) {
          sendJson(res, { error: `value rejected for ${parsed.path}` }, 400)
          return
        }

        opts.submitLaw(parsed.path, value.data)
        sendJson(res, { accepted: parsed.path, value: value.data }, 202)
      })
    },
  }
  const routes: readonly AdminRoute[] = [laws, ...(opts.routes ?? [])]

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    for (const route of routes) {
      const params = match(route, url.pathname)
      if (params === null) continue
      if (route.method !== (req.method ?? 'GET')) {
        sendJson(res, { error: `${route.method} only` }, 405)
      } else if (req.headers.authorization !== `Bearer ${opts.token}`) {
        sendJson(res, { error: 'unauthorized' }, 401)
      } else if (wrongInterface(req)) {
        sendJson(res, { error: `the law channel answers on ${host} only` }, 403)
      } else {
        try {
          route.handle(req, res, params)
        } catch (e) {
          // Unguarded, a throw in here is an uncaughtException on the thread that ticks the town.
          reportOnce(
            `admin.${route.method} ${route.path}`,
            () =>
              `${route.method} ${route.path} threw — ${e instanceof Error ? e.message : String(e)}`,
          )
          if (res.headersSent) res.destroy()
          else sendJson(res, { error: 'internal error' }, 500)
        }
      }
      return
    }
    sendJson(res, { error: 'not found' }, 404)
  })
}
