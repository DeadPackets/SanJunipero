import type { IncomingMessage, ServerResponse } from 'node:http'

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void

/** What every `mount*Api` is handed. A leaf on purpose: `server.ts` imports all of them, so the
 *  route contract cannot live there without every route module importing the server back. */
export type Router = { route(method: string, pattern: string, fn: RouteHandler): void }

/** A route's segments against a request's, `:name` capturing. Null when the shapes differ. What
 *  it captures is raw: the viewer server decodes it, the admin channel takes it as written. */
export function matchSegments(
  want: readonly string[],
  got: readonly string[],
): Record<string, string> | null {
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    const seg = want[i]!
    if (seg.startsWith(':')) params[seg.slice(1)] = got[i]!
    else if (seg !== got[i]) return null
  }
  return params
}
