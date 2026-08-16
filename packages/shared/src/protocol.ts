import { z } from 'zod'
import { EventEnvelope } from './events.js'
import { AssetRecordSchema } from './assetCodex.js'
import { MINUTES_PER_DAY } from './time.js'

export const PROTOCOL_VERSION = 1
const tick = z.number().int().nonnegative()

export const ClientHello = z.object({ t: z.literal('hello'), v: z.number().int(), lastSeenTick: tick.nullable() }).strict()
export const ClientScrub = z.object({ t: z.literal('scrub'), tick, reqId: z.number().int().nonnegative() }).strict()
export const ClientLive  = z.object({ t: z.literal('live') }).strict()
export const ClientMsg = z.discriminatedUnion('t', [ClientHello, ClientScrub, ClientLive])
export type ClientMsg = z.infer<typeof ClientMsg>

export const ServerSnapshot = z.object({ t: z.literal('snapshot'), tick, seq: z.number().int().nonnegative(), state: z.unknown(), config: z.unknown(), live: z.boolean() }).strict()
// config = the sim's SimConfig: the client folds deltas with the SAME config as the engine, or live view drifts from truth
export const ServerTick    = z.object({ t: z.literal('tick'), tick, events: z.array(EventEnvelope) }).strict()
export const ServerScrubbed = z.object({ t: z.literal('scrubbed'), reqId: z.number().int().nonnegative(), tick, state: z.unknown() }).strict()
export const ServerThought = z.object({ t: z.literal('thought'), agentId: z.string().min(1), tick, text: z.string() }).strict()
export const ServerAsset   = z.object({ t: z.literal('asset'), record: AssetRecordSchema }).strict() // png travels over HTTP, never the socket
export const ServerMsg = z.discriminatedUnion('t', [ServerSnapshot, ServerTick, ServerScrubbed, ServerThought, ServerAsset])
export type ServerMsg = z.infer<typeof ServerMsg>

export function momentToTick(day: number, time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m || day < 0 || !Number.isInteger(day)) return NaN
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return day * MINUTES_PER_DAY + h * 60 + min
}
export function tickToMoment(t: number): { day: number; time: string } {
  const day = Math.floor(t / MINUTES_PER_DAY), rem = t % MINUTES_PER_DAY
  const pad = (n: number) => String(n).padStart(2, '0')
  return { day, time: `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}` }
}
