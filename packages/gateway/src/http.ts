import type { ServerResponse } from 'node:http'
import type { RawData } from 'ws'
import type { SimEvent } from '@sj/shared'

/** ws hands a frame back as `Buffer | ArrayBuffer | Buffer[]`; only the Buffer case survives a
 *  bare `.toString()`, and a fragmented text frame arrives as the array. */
export function frameText(d: RawData): string {
  if (Buffer.isBuffer(d)) return d.toString('utf8')
  if (Array.isArray(d)) return Buffer.concat(d).toString('utf8')
  return Buffer.from(d).toString('utf8')
}

export const sendJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export const notFound = (res: ServerResponse): void => {
  sendJson(res, { error: 'not found' }, 404)
}

/** One `events` row as the read paths take it. Deliberately NOT `EventEnvelope.parse`d:
 *  `worldMirror.ts` already validates what enters the world. */
export type EventRow = { seq: number; tick: number; type: string; payload: string }
export const toEvent = (r: EventRow): SimEvent => ({
  seq: r.seq,
  tick: r.tick,
  type: r.type,
  payload: JSON.parse(r.payload),
})
