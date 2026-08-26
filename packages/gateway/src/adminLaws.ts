import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { TOGGLABLE_PATHS } from '@sj/engine'

export const ADMIN_LAWS_PATH = '/admin/laws'
export const DEFAULT_ADMIN_HOST = '127.0.0.1'
const MAX_BODY_BYTES = 4096

const LawRequest = z.object({ path: z.string().min(1), value: z.unknown() })

export type LawsAdminOpts = {
  // Injected: this listener never touches the engine, it only hands a change on.
  submitLaw: (path: string, value: unknown) => void
  token: string
  host?: string
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string | null> {
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

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== ADMIN_LAWS_PATH) {
      send(res, 404, { error: 'not found' })
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'POST only' })
      return
    }
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    if (wrongInterface(req)) {
      send(res, 403, { error: `the law channel answers on ${host} only` })
      return
    }

    void readBody(req).then((text) => {
      if (text === null) {
        send(res, 400, { error: 'body unreadable' })
        return
      }
      let parsed: z.infer<typeof LawRequest>
      try {
        parsed = LawRequest.parse(JSON.parse(text))
      } catch {
        send(res, 400, { error: 'expected {path, value}' })
        return
      }
      const schema = TOGGLABLE_PATHS[parsed.path]
      if (schema === undefined) {
        send(res, 400, { error: `${parsed.path} is not a world law` })
        return
      }
      // The fold THROWS on a value its schema rejects, so a cheerful 202 here
      // would take the world down at the next tick boundary. Refuse it now.
      const value = schema.safeParse(parsed.value)
      if (!value.success) {
        send(res, 400, { error: `value rejected for ${parsed.path}` })
        return
      }

      opts.submitLaw(parsed.path, value.data)
      send(res, 202, { accepted: parsed.path, value: value.data })
    })
  })
}
