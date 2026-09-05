import { z } from 'zod'
import { EventEnvelope } from './events.js'
import { AssetRecordSchema } from './assetCodex.js'
import { MINUTES_PER_DAY } from './time.js'

export const PROTOCOL_VERSION = 8 // 8: the director's cut and act ride the socket; a v7 viewer polls a heat that no longer exists

/** The close code for a hello the server does not recognise. Here rather than in the gateway
 *  because the viewer has to be able to tell it apart from a dropped connection. */
export const CLOSE_BAD_HELLO = 4400
const tick = z.number().int().nonnegative()

// `lastSeenTick` is what the viewer last drew, offered for a catch-up the gateway does not yet
// do. Optional, because a hello that leaves it out is a hello, not a version mismatch.
export const ClientHello = z
  .object({ t: z.literal('hello'), v: z.number().int(), lastSeenTick: tick.nullable().optional() })
  .strict()
export const ClientScrub = z
  .object({ t: z.literal('scrub'), tick, reqId: z.number().int().nonnegative() })
  .strict()
// A stretch of time rather than an instant: the town plays forward from `from` at the live
// cadence until it reaches now. `live` is how a viewer leaves it.
export const ClientReplay = z
  .object({ t: z.literal('replay'), from: tick, reqId: z.number().int().nonnegative() })
  .strict()
export const ClientLive = z.object({ t: z.literal('live') }).strict()
export const ClientMsg = z.discriminatedUnion('t', [
  ClientHello,
  ClientScrub,
  ClientReplay,
  ClientLive,
])
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
// The ONE fold a replay pays for. `seq` is the log head at `tick`, and the viewer adopts it: the
// recorded deltas that follow are then ordinary `tick` frames with ordinary rising seqs.
export const ServerReplaying = z
  .object({
    t: z.literal('replaying'),
    reqId: z.number().int().nonnegative(),
    tick,
    seq: z.number().int().nonnegative(),
    state: z.unknown(),
  })
  .strict()
// `importance` is the mind's own 1–10 weight for the turn. Every thought is sent and stored;
// the viewer decides which ones are worth a wisp over a head.
export const ServerThought = z
  .object({
    t: z.literal('thought'),
    agentId: z.string().min(1),
    tick,
    text: z.string(),
    importance: z.number().int().min(1).max(10),
  })
  .strict()
// An ARRAY, because a greeted socket is handed the whole codex: one frame per record was 189
// sends per viewer on the thread that ticks the town. The png travels over HTTP, never the socket.
export const ServerAssets = z
  .object({ t: z.literal('assets'), records: z.array(AssetRecordSchema) })
  .strict()
// The one frame the world sends while its clock is stopped, so a viewer is never told a time
// the town is not keeping.
export const ServerPaused = z.object({ t: z.literal('paused'), paused: z.boolean() }).strict()
export const SceneKind = z.enum([
  'talk',
  'quarrel',
  'council',
  'gathering',
  'telling',
  'invitation',
])
export type SceneKind = z.infer<typeof SceneKind>

/** What a line in a talk is doing. The first five are stances toward what was just said; the
 *  rest are how a person moves a talk along. One list: the engine's event schema and the minds'
 *  answer schema both read it, so a move the mind may say is always a move the log may hold. */
export const SCENE_MOVES = [
  'press',
  'give_way',
  'deflect',
  'tease',
  'none',
  'tell',
  'ask',
  'joke',
  'agree',
  'shift',
] as const
export const SceneMove = z.enum(SCENE_MOVES)
export type SceneMove = z.infer<typeof SceneMove>
// Scene STATE, not its lines: the lines already reach a viewer as speech. `summary` arrives on
// the closing frame only.
export const ServerScene = z
  .object({
    t: z.literal('scene'),
    scene: z
      .object({
        id: z.string().min(1),
        kind: SceneKind,
        participants: z.array(z.string().min(1)),
        topic: z.string().nullable(),
        stakes: z.number().int().min(0).max(10),
        open: z.boolean(),
        summary: z.string().optional(),
      })
      .strict(),
  })
  .strict()
export type ServerScene = z.infer<typeof ServerScene>
// What the camera is on and why. `score` is the gateway's own unbounded number and NOT the
// scene frame's 0-10 stakes: one is what the town has riding on a talk, the other is how that
// talk ranks against a death two streets away.
export const StakeScoreSchema = z
  .object({
    sceneId: z.string().min(1).nullable(),
    agentIds: z.array(z.string().min(1)).min(1),
    score: z.number().nonnegative(),
    why: z.string().min(1),
  })
  .strict()
export type StakeScore = z.infer<typeof StakeScoreSchema>
// The act mark rides here rather than on the cut, because it still reads while the quiet round
// turns and there is no cut at all.
export const ServerDirector = z
  .object({
    t: z.literal('director'),
    tick,
    /** Null: nothing is scored, and the viewer's quiet round turns. */
    cut: StakeScoreSchema.nullable(),
    /** The beat after a peak: the shot holds and nothing displaces it. */
    quiet: z.boolean(),
    act: z.enum(['I', 'II', 'III']).nullable(),
  })
  .strict()
export type ServerDirector = z.infer<typeof ServerDirector>
export const ServerMsg = z.discriminatedUnion('t', [
  ServerSnapshot,
  ServerPaused,
  ServerTick,
  ServerScrubbed,
  ServerReplaying,
  ServerThought,
  ServerAssets,
  ServerScene,
  ServerDirector,
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
