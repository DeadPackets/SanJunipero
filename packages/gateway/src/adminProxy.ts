import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import { notFound, sendJson } from './http.js'

/** Where the operator's channel listens when `SJ_ADMIN_TOKEN` opens one. */
const ADMIN_HOST = '127.0.0.1'
export const ADMIN_PORT_DEFAULT = 8788

/** The loopback port the operator's channel listens on, or null when no token opened one.
 *  Read twice: @sj/town starts the channel there, and the gateway forwards `/admin/*` to it. */
export function adminChannelPort(env: NodeJS.ProcessEnv = process.env): number | null {
  if ((env.SJ_ADMIN_TOKEN ?? '') === '') return null
  const asked = Number(env.SJ_ADMIN_PORT ?? '')
  return Number.isInteger(asked) && asked >= 1 ? asked : ADMIN_PORT_DEFAULT
}

/** What the browser is allowed to say to the channel. The bearer is the whole lock, and the
 *  channel reads a JSON body; anything else a page attaches is not the operator's business. */
const FORWARDED = ['authorization', 'content-type'] as const

export type AdminProxy = (req: IncomingMessage, res: ServerResponse) => void

/**
 * `/admin/*` from the page's own origin, handed to the loopback channel. The port stays bound to
 * 127.0.0.1 and the bearer still decides — this only spares the browser a cross-origin call it
 * would refuse. No channel configured, no route: a stranger learns nothing from a 404.
 */
export function makeAdminProxy(port: number | null): AdminProxy {
  return (req, res) => {
    if (port === null) {
      notFound(res)
      return
    }
    const headers: Record<string, string> = {}
    for (const name of FORWARDED) {
      const value = req.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    const upstream = request(
      { host: ADMIN_HOST, port, path: req.url ?? '/', method: req.method ?? 'GET', headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      },
    )
    upstream.on('error', () => {
      sendJson(res, { error: 'the operator channel is not answering' }, 502)
    })
    req.pipe(upstream)
  }
}
