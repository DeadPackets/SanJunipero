import type { IncomingMessage, ServerResponse } from 'node:http'

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void

/** What every `mount*Api` is handed. A leaf on purpose: `server.ts` imports all of them, so the
 *  route contract cannot live there without every route module importing the server back. */
export type Router = { route(method: string, pattern: string, fn: RouteHandler): void }
