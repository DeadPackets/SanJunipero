import { mintId, thirstOf, type WorldState } from '../state.js'
import type { TickCtx } from '../tickCtx.js'
import type { SimConfig } from '@sj/shared'
import { perimeter } from '../interiors.js'
import { isPassable, type Point } from '../path.js'

// Dying is arithmetic here, not a roll: every affliction on a body takes its own toll every tick,
// and the tick the total reaches the floor is the tick it dies. ZERO RNG in this file.

// The wire type of `agent_died.cause` stays a free string so recorded logs still parse; emitters
// are held to this list by the type. Array order is the last tiebreak in attribution.
export const DEATH_CAUSES = [
  'injury',
  'poison',
  'illness',
  'fatigue',
  'exposure',
  'hunger',
  'thirst',
  'slain',
  'old_age',
] as const
export type DeathCause = (typeof DEATH_CAUSES)[number]

export function drainPerTick(state: WorldState, config: SimConfig, agentId: string): number {
  let total = 0
  for (const d of drains(state, config, agentId)) total += d.amount
  return total
}

type Drain = { cause: DeathCause; amount: number; sinceTick: number; byId?: string }

// Every reason this body is losing hp right now, as separate terms. The sum is the drain;
// the largest term is what killed it. One walk of the body, two questions answered.
function drains(state: WorldState, config: SimConfig, agentId: string): Drain[] {
  const a = state.agents[agentId]
  if (!a?.alive) return []
  const { mortality } = config
  if (!mortality.enabled) return []
  const out: Drain[] = []
  // The ladder is the only road the cold takes, so a fatal rung a winter night drove
  // is named for the night. Nothing else about the drain changes: same amount, same clock.
  const chilled = (a.coldTicksSinceRecovery ?? 0) > 0
  for (const x of a.afflictions ?? []) {
    // A wound with a hand behind it is not an accident, and the death says so.
    const slain = x.kind === 'injury' && x.sourceId !== undefined
    out.push({
      cause: slain ? 'slain' : x.kind === 'fatigue' && chilled ? 'exposure' : x.kind,
      amount: mortality.drainPerTick[x.kind] * x.severity,
      sinceTick: x.sinceTick,
      ...(slain ? { byId: x.sourceId } : {}),
    })
  }
  if (a.needs.hunger <= 0) {
    out.push({
      cause: 'hunger',
      amount: mortality.hungerHpDrainPerTick,
      sinceTick: a.zeroHungerSinceTick ?? state.tick,
    })
  }
  if (thirstOf(a) <= 0) {
    out.push({ cause: 'thirst', amount: mortality.thirstHpDrainPerTick, sinceTick: state.tick })
  }
  return out
}

// The single attribution: biggest drain, then the oldest of them, then the order of
// DEATH_CAUSES. A body worn down with nothing named on it died of the wounds it took.
export function deathAttribution(
  state: WorldState,
  config: SimConfig,
  agentId: string,
): { cause: DeathCause; byId?: string } {
  let best: Drain | undefined
  for (const d of drains(state, config, agentId)) {
    if (
      best === undefined ||
      d.amount > best.amount ||
      (d.amount === best.amount && d.sinceTick < best.sinceTick) ||
      (d.amount === best.amount &&
        d.sinceTick === best.sinceTick &&
        DEATH_CAUSES.indexOf(d.cause) < DEATH_CAUSES.indexOf(best.cause))
    )
      best = d
  }
  if (best === undefined) return { cause: 'injury' }
  return { cause: best.cause, ...(best.byId === undefined ? {} : { byId: best.byId }) }
}

export function dominantDrain(state: WorldState, config: SimConfig, agentId: string): DeathCause {
  return deathAttribution(state, config, agentId).cause
}

// Where the life ended, or the nearest tile that will take a stone — the same ring walk
// doorways use, so "nearest" means one thing in this codebase.
export function graveTile(state: WorldState, x: number, y: number): Point | null {
  if (isPassable(state, x, y)) return { x, y }
  const limit = Math.max(state.terrain.length, state.terrain[0]?.length ?? 0)
  for (let r = 1; r <= limit; r++) {
    for (const p of perimeter({ x: x - (r - 1), y: y - (r - 1), w: 2 * r - 1, h: 2 * r - 1 })) {
      if (isPassable(state, p.x, p.y)) return p
    }
  }
  return null
}

// Death would otherwise strand held items: drop them on the death tile first.
export function dropHeldItems(ctx: TickCtx, agentId: string): void {
  const a = ctx.state().agents[agentId]!
  for (const id of Object.keys(ctx.state().items).sort()) {
    const item = ctx.state().items[id]!
    if (item.loc.t === 'agent' && item.loc.id === agentId) {
      ctx.emit('item_moved', { id, loc: { t: 'tile', x: a.x, y: a.y } })
    }
  }
}

// Called straight after every agent_died: the body is already dead, its tile is still its own.
export function placeGrave(ctx: TickCtx, agentId: string): void {
  const { mortality } = ctx.config
  if (!mortality.enabled || !mortality.graveEnabled) return
  const a = ctx.state().agents[agentId]
  if (a === undefined) return
  const at = graveTile(ctx.state(), a.x, a.y)
  if (at === null) return
  ctx.emit('grave_placed', {
    id: mintId(ctx.state(), 'structure'),
    agentId,
    name: a.name,
    x: at.x,
    y: at.y,
  })
}

// Called straight after every agent_collapsed, when the fold has already counted the rung. Cold
// reaches death through this ladder and no other way, which keeps the cause list closed.
export function escalateFatigue(ctx: TickCtx, agentId: string): void {
  if (!ctx.config.mortality.enabled) return
  const a = ctx.state().agents[agentId]
  const rung = a?.collapsesWithoutRecovery
  if (a === undefined || rung === undefined) return
  const has = a.afflictions?.some((x) => x.kind === 'fatigue') ?? false
  // Absolute, not incremental: a body that ate its way off the ladder comes back on at one.
  ctx.emit(has ? 'affliction_worsened' : 'agent_afflicted', {
    agentId,
    kind: 'fatigue',
    severity: rung,
  })
}

export function mortalitySystem(ctx: TickCtx): void {
  if (!ctx.config.mortality.enabled) return
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const drain = drainPerTick(ctx.state(), ctx.config, id)
    if (drain > 0) ctx.emit('hp_changed', { agentId: id, delta: -drain })
  }
}
