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

/** A request target as a URL, or null when it is not one. `//x:99999/` is a target llhttp accepts
 *  and `URL` refuses, and unguarded that throw is an uncaughtException in a bare listener. */
export const parseTarget = (target: string | undefined): URL | null => {
  try {
    return new URL(target ?? '/', 'http://localhost')
  } catch {
    return null
  }
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

/** Text bound for an XML attribute or an SVG `<text>` body — the share card escapes the same
 *  four characters, and a chapter title must not be able to close either. */
export const attr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
