import type { ServerResponse } from 'node:http'
import type { SimEvent } from '@sj/shared'

export const sendJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export const notFound = (res: ServerResponse): void => sendJson(res, { error: 'not found' }, 404)

/** One `events` row as the read paths take it. Deliberately NOT `EventEnvelope.parse`d:
 *  `worldMirror.ts` already validates what enters the world. */
export type EventRow = { seq: number; tick: number; type: string; payload: string }
export const toEvent = (r: EventRow): SimEvent => ({
  seq: r.seq,
  tick: r.tick,
  type: r.type,
  payload: JSON.parse(r.payload),
})
