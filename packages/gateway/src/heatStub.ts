import type { SimEvent } from '@sj/shared'

// Deterministic drama scorer — C7 replaces this reader, the /api/heat shape stays.
export const HEAT_WINDOW_TICKS = 60
export const HEAT_WEIGHTS: Record<string, number> = {
  agent_died: 20, fire_ignited: 12, fire_spread: 10, agent_injured: 8,
  structure_completed: 6, agent_collapsed: 6, crop_harvested: 3, agent_spoke: 2, item_moved: 1,
}

export type HeatWindow = { fromTick: number; toTick: number; agentId: string; score: number }

/** `${windowIndex}\n${agentId}` → score. The whole of what heat needs to remember: one number
 *  per 60-tick window an agent was in, which is the answer itself and not the events behind it. */
export type HeatScores = Map<string, number>
export const heatKey = (tick: number, agentId: string): string =>
  `${Math.floor(tick / HEAT_WINDOW_TICKS)}\n${agentId}`

/**
 * ★ WHOSE DRAMA A FIRE IS.
 *
 * Five of the nine weights used to score nothing at all. `scoreEvent` needed `payload.agentId`,
 * and `fire_ignited` `{structureId, cause}`, `fire_spread` `{fromId, toId}`,
 * `structure_completed` `{id}`, `crop_harvested` `{cropId}` and `item_moved` `{id, loc}` carry
 * no agent — so the whole of the town's fire and harvest drama was computed and dropped on
 * every event, while the table above read as if fire were the second-loudest thing after a
 * death. (The old `payload.builderId` fallback was dead for the same reason: `structure_planned`
 * is the only payload in the engine carrying one, and it is not weighted. It is gone.)
 *
 * ★ THE RULING: DRAMA BELONGS TO A PERSON, BECAUSE THE CAMERA DOES.
 *
 * `/api/heat` is keyed by agent because `directorCut.pickCut` turns it into the one question the
 * broadcast asks — who is the camera on. "The whole town" is not an answer a camera can take: a
 * synthetic subject would come back through `subjectFor` as an id no agent has, and the frame
 * would follow nobody. So an event either names a person or scores nothing, and the work is in
 * naming one HONESTLY from the log alone.
 *
 * Three resolvers, all deterministic, all bounded, none of them reading world state:
 *
 *  1. `payload.agentId` — the event names them.
 *  2. **The actor whose verb produced it.** `worldTick` emits `action_completed {agentId, verb}`
 *     and then, with nothing in between, the verb's own `onComplete` events. So a
 *     `crop_harvested` is always the row after its harvester's completion, and that adjacency is
 *     a fact about the emitter rather than a guess. One event of memory reads it.
 *  3. **The builder on the structure's plan.** `structure_planned {id, kind, builderId}` is a
 *     record the read path already keeps, one per structure.
 *
 * Per event, and each is a judgement:
 *
 *  · `fire_ignited` → the builder of `structureId`. Nobody lights these — lightning, or a
 *    carried flame — so there is no actor to find. The person the town has on record for that
 *    building is the one who raised it, and cutting to them while it burns is the right frame.
 *  · `fire_spread` → the builder of `toId` ONLY. The fire reaching somewhere new is the new
 *    place's moment; wherever it came from was already scored when it caught. Scoring both ends
 *    would let one fire pay the same person again at every link of the chain.
 *  · `structure_completed` → the plan's builder, else the actor in flight. A scripted completion
 *    with no actor still has a plan.
 *  · `crop_harvested` → the actor in flight. It is the harvest verb's own result.
 *  · `item_moved` → the agent in `loc` when the item moved into somebody's hands. A fire
 *    scattering goods onto tiles names nobody and gets nothing — the fire was already scored 12,
 *    and a burning storehouse must not out-score a death by counting its contents.
 */
export type HeatContext = {
  /** Who raised a structure, for the events that name a place and no person. */
  builderOf(structureId: string): string | null
  /** The actor of the immediately preceding `action_completed`; `scoreEvent` maintains it. */
  prevActor: string | null
}

/** A context for a log with no plans in it — every structure resolves to nobody. */
export const heatContext = (builderOf: (id: string) => string | null = () => null): HeatContext =>
  ({ builderOf, prevActor: null })

/** Who this event's drama belongs to, or null when the log cannot honestly name anybody. */
function dramatis(ev: SimEvent, ctx: HeatContext): string | null {
  const p = ev.payload as {
    agentId?: string; structureId?: string; toId?: string; id?: string
    loc?: { t: string; id?: string }
  }
  if (typeof p.agentId === 'string') return p.agentId
  switch (ev.type) {
    case 'fire_ignited': return p.structureId === undefined ? null : ctx.builderOf(p.structureId)
    case 'fire_spread': return p.toId === undefined ? null : ctx.builderOf(p.toId)
    case 'structure_completed':
      return (p.id === undefined ? null : ctx.builderOf(p.id)) ?? ctx.prevActor
    case 'crop_harvested': return ctx.prevActor
    case 'item_moved': return p.loc?.t === 'agent' ? p.loc.id ?? null : null
    default: return null
  }
}

/** Add one event's drama to a running score map. `api.ts` keeps ONE of these alive for the world
 *  and folds each event into it exactly once, so the log never has to be held to answer /api/heat. */
export function scoreEvent(scores: HeatScores, ev: SimEvent, ctx: HeatContext): void {
  // Maintained before the weight check, because `action_completed` is not itself weighted —
  // it is the row that says who the next row belongs to.
  if (ev.type === 'action_completed') {
    const actor = (ev.payload as { agentId?: string }).agentId
    ctx.prevActor = typeof actor === 'string' ? actor : null
    return
  }
  const weight = HEAT_WEIGHTS[ev.type] ?? 0
  const agentId = weight === 0 ? null : dramatis(ev, ctx)
  // A verb's results run contiguously after its completion, so the actor survives exactly as
  // long as those results do and no longer.
  if (ev.type !== 'crop_harvested' && ev.type !== 'structure_completed') ctx.prevActor = null
  if (agentId === null) return
  const key = heatKey(ev.tick, agentId)
  scores.set(key, (scores.get(key) ?? 0) + weight)
}

export function heatFromScores(scores: ReadonlyMap<string, number>): HeatWindow[] {
  return [...scores.entries()]
    .map(([key, score]) => {
      const [w, agentId] = key.split('\n') as [string, string]
      const fromTick = Number(w) * HEAT_WINDOW_TICKS
      return { fromTick, toTick: fromTick + HEAT_WINDOW_TICKS - 1, agentId, score }
    })
    .sort((a, b) => a.fromTick - b.fromTick || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))
}

// readonly: the caller's array is never retained past this call.
export function heatWindows(events: readonly SimEvent[]): HeatWindow[] {
  const scores: HeatScores = new Map()
  const plans = new Map<string, string>()
  for (const ev of events) {
    if (ev.type !== 'structure_planned') continue
    const p = ev.payload as { id?: string; builderId?: string }
    if (typeof p.id === 'string' && typeof p.builderId === 'string') plans.set(p.id, p.builderId)
  }
  const ctx = heatContext((id) => plans.get(id) ?? null)
  for (const ev of events) scoreEvent(scores, ev, ctx)
  return heatFromScores(scores)
}
