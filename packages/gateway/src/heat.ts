import { DEFAULT_CONFIG, type HeatWindow, type SimEvent } from '@sj/shared'

// Deterministic drama scorer. Weighted so what the town DECIDES and SAYS outranks the weather:
// scored for catastrophe alone, a healthy town came out flat and the camera fell back to a carousel.
export const HEAT_WINDOW_TICKS = 60
export const HEAT_WEIGHTS: Record<string, number> = {
  agent_died: 20,
  discovery_made: 12,
  fire_ignited: 12,
  law_ratified: 12,
  fire_spread: 10,
  law_broken: 9,
  agent_injured: 8,
  co_slept: 8,
  structure_completed: 6,
  agent_collapsed: 6,
  agent_spoke: 6,
  agent_expressed: 4,
  crop_harvested: 3,
  item_moved: 1,
}

/** Two voices in one window are what the director exists to find, so the pair must clear any
 *  single disaster the weather can raise: 6 + 8 beats `fire_ignited`. */
export const SCENE_BONUS = 8
/** Plain distance, not the engine's `hears`: heat is a hint about where to point a camera, and
 *  a wall between two voices does not make them a worse shot. */
export const SCENE_EARSHOT_TILES = DEFAULT_CONFIG.movement.earshotRadius

/** One sim-day, not the 120 ticks the only caller reads: `/api/heat` is a public contract and a
 *  legible unit survives a second reader better than a number tuned to the first. */
export const HEAT_HORIZON_TICKS = 1440

/** The windows inside the horizon, newest end anchored at `nowTick`. */
export function heatSince(windows: readonly HeatWindow[], nowTick: number): HeatWindow[] {
  const floor = nowTick - HEAT_HORIZON_TICKS
  return windows.filter((w) => w.toTick >= floor)
}

/** `${windowIndex}\n${agentId}` → score. The whole of what heat needs to remember: one number
 *  per 60-tick window an agent was in, which is the answer itself and not the events behind it. */
export type HeatScores = Map<string, number>
const heatKey = (tick: number, agentId: string): string =>
  `${Math.floor(tick / HEAT_WINDOW_TICKS)}\n${agentId}`

/** An event either names a person or scores nothing — heat is the camera's subject, and a camera
 *  cannot follow "the town". `fire_spread` scores the destination ONLY: one fire pays a person once. */
export type HeatContext = {
  /** Who raised a structure, for the events that name a place and no person. */
  builderOf(structureId: string): string | null
  /** The actor of the immediately preceding `action_completed`; `scoreEvent` maintains it. */
  prevActor: string | null
  /** The `seq` of the event before this one, so a caller that reads a FILTERED log still sees
   *  the rows it skipped as what they are: events between the completion and its result. */
  lastSeq: number
  /** The window the two fields below belong to; crossing into the next empties both, so the
   *  scene bonus remembers one window's voices and never the whole day's. */
  sceneWindow: number
  spoke: { agentId: string; x: number; y: number }[]
  /** who has already been paid the bonus for this window */
  paired: Set<string>
}

/** A context for a log with no plans in it — every structure resolves to nobody. */
export const heatContext = (
  builderOf: (id: string) => string | null = () => null,
): HeatContext => ({
  builderOf,
  prevActor: null,
  lastSeq: 0,
  sceneWindow: -1,
  spoke: [],
  paired: new Set(),
})

/** Who this event's drama belongs to, or null when the log cannot honestly name anybody. */
function dramatis(ev: SimEvent, ctx: HeatContext): string | null {
  const p = ev.payload as {
    agentId?: string
    structureId?: string
    toId?: string
    id?: string
    byId?: string
    aId?: string
    loc?: { t: string; id?: string }
  }
  if (typeof p.agentId === 'string') return p.agentId
  switch (ev.type) {
    case 'discovery_made':
      return p.byId ?? null
    // One night pays one of the pair, the way one fire pays one person: the camera can only be
    // on one face, and whichever it takes has the other standing in the same shot.
    case 'co_slept':
      return p.aId ?? null
    case 'fire_ignited':
      return p.structureId === undefined ? null : ctx.builderOf(p.structureId)
    case 'fire_spread':
      return p.toId === undefined ? null : ctx.builderOf(p.toId)
    case 'structure_completed':
      return (p.id === undefined ? null : ctx.builderOf(p.id)) ?? ctx.prevActor
    case 'crop_harvested':
      return ctx.prevActor
    case 'item_moved':
      return p.loc?.t === 'agent' ? (p.loc.id ?? null) : null
    default:
      return null
  }
}

/** Add one event's drama to a running score map. `api.ts` keeps ONE of these alive for the world
 *  and folds each event into it exactly once, so the log never has to be held to answer /api/heat. */
export function scoreEvent(scores: HeatScores, ev: SimEvent, ctx: HeatContext): void {
  // A gap in `seq` is rows the caller's SELECT filtered out, and every one of them would have
  // ended the actor's run — so the gap ends it just the same.
  if (ev.seq !== ctx.lastSeq + 1) ctx.prevActor = null
  ctx.lastSeq = ev.seq
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
  add(scores, ev.tick, agentId, weight)
  if (ev.type === 'agent_spoke') scoreScene(scores, ev, agentId, ctx)
}

const add = (scores: HeatScores, tick: number, agentId: string, n: number): void => {
  const key = heatKey(tick, agentId)
  scores.set(key, (scores.get(key) ?? 0) + n)
}

/** Pays `SCENE_BONUS` to both voices the first time this window carries two of them within
 *  earshot. Allocation-light: one array and one set, both emptied at the window seam. */
function scoreScene(
  scores: HeatScores,
  ev: SimEvent,
  agentId: string,
  ctx: HeatContext,
): void {
  const p = ev.payload as { x?: number; y?: number }
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return
  const window = Math.floor(ev.tick / HEAT_WINDOW_TICKS)
  if (window !== ctx.sceneWindow) {
    ctx.sceneWindow = window
    ctx.spoke.length = 0
    ctx.paired.clear()
  }
  const pay = (id: string): void => {
    if (ctx.paired.has(id)) return
    ctx.paired.add(id)
    add(scores, ev.tick, id, SCENE_BONUS)
  }
  for (const other of ctx.spoke) {
    if (other.agentId === agentId) continue
    if (Math.hypot(other.x - p.x, other.y - p.y) > SCENE_EARSHOT_TILES) continue
    pay(other.agentId)
    pay(agentId)
  }
  ctx.spoke.push({ agentId, x: p.x, y: p.y })
}

export function heatFromScores(scores: ReadonlyMap<string, number>): HeatWindow[] {
  return [...scores.entries()]
    .map(([key, score]) => {
      const [w, agentId] = key.split('\n') as [string, string]
      const fromTick = Number(w) * HEAT_WINDOW_TICKS
      return { fromTick, toTick: fromTick + HEAT_WINDOW_TICKS - 1, agentId, score }
    })
    .sort(
      (a, b) =>
        a.fromTick - b.fromTick || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0),
    )
}
