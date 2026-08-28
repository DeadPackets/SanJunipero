import { z } from 'zod'
import { EventEnvelope } from './events.js'
import { AssetRecordSchema } from './assetCodex.js'
import { MINUTES_PER_DAY } from './time.js'

export const PROTOCOL_VERSION = 2 // 2: ServerSnapshot.laws is required — a v1 client parses no snapshot

/** The close code for a hello the server does not recognise. Here rather than in the gateway
 *  because the viewer has to be able to tell it apart from a dropped connection. */
export const CLOSE_BAD_HELLO = 4400
const tick = z.number().int().nonnegative()

export const ClientHello = z
  .object({ t: z.literal('hello'), v: z.number().int(), lastSeenTick: tick.nullable() })
  .strict()
export const ClientScrub = z
  .object({ t: z.literal('scrub'), tick, reqId: z.number().int().nonnegative() })
  .strict()
export const ClientLive = z.object({ t: z.literal('live') }).strict()
export const ClientMsg = z.discriminatedUnion('t', [ClientHello, ClientScrub, ClientLive])
export type ClientMsg = z.infer<typeof ClientMsg>

export const ServerSnapshot = z
  .object({
    t: z.literal('snapshot'),
    tick,
    seq: z.number().int().nonnegative(),
    state: z.unknown(),
    config: z.unknown(),
    laws: z.record(z.string(), z.unknown()),
    live: z.boolean(),
    /** The operator has stopped the world clock. Optional: a stream with no admin channel
     *  never says it, and a viewer that is never told reads the town as running. */
    paused: z.boolean().optional(),
  })
  .strict()
// config = the sim's SimConfig: the client folds deltas with the SAME config as the engine, or live view drifts from truth
// laws = the world laws in force right now, so a late joiner reads them without replaying every config_changed
export const ServerTick = z
  .object({
    t: z.literal('tick'),
    tick,
    // The log head this frame carries the client up to: the invalidation signal a read model
    // needs so a viewer can refetch on a change rather than on a timer.
    seq: z.number().int().nonnegative(),
    events: z.array(EventEnvelope),
  })
  .strict()
export const ServerScrubbed = z
  .object({
    t: z.literal('scrubbed'),
    reqId: z.number().int().nonnegative(),
    tick,
    state: z.unknown(),
  })
  .strict()
export const ServerThought = z
  .object({ t: z.literal('thought'), agentId: z.string().min(1), tick, text: z.string() })
  .strict()
// An ARRAY, because a greeted socket is handed the whole codex: one frame per record was 189
// sends per viewer inside the connection handler, on the thread that ticks the town.
// The png travels over HTTP, never the socket.
export const ServerAssets = z
  .object({ t: z.literal('assets'), records: z.array(AssetRecordSchema) })
  .strict()
// The one frame the world sends while its clock is stopped, so a viewer is never told a time
// the town is not keeping.
export const ServerPaused = z.object({ t: z.literal('paused'), paused: z.boolean() }).strict()
export const ServerMsg = z.discriminatedUnion('t', [
  ServerSnapshot,
  ServerPaused,
  ServerTick,
  ServerScrubbed,
  ServerThought,
  ServerAssets,
])
export type ServerMsg = z.infer<typeof ServerMsg>

export function momentToTick(day: number, time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m || day < 0 || !Number.isInteger(day)) return NaN
  const h = Number(m[1]),
    min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return day * MINUTES_PER_DAY + h * 60 + min
}
export function tickToMoment(t: number): { day: number; time: string } {
  const day = Math.floor(t / MINUTES_PER_DAY),
    rem = t % MINUTES_PER_DAY
  const pad = (n: number) => String(n).padStart(2, '0')
  return { day, time: `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}` }
}
