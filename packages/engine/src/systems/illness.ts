import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

const INJURY_HEAL_DAYS = 3

// A fever is a nightly coin, not a per-tick one: the body either loses ground or gains it,
// and the same event carries both directions. C9's per-tick contagion loop is retired
// (controller ruling 3) — this file is the world's only contagion, once a night, on one stream.

const hasIllness = (state: WorldState, id: string): boolean =>
  state.agents[id]?.afflictions?.some((x) => x.kind === 'illness') ?? false

// A wall holds the air the way it holds sound: co-occupants share it whatever the distance,
// bodies in the open share it inside the radius, and across a threshold nobody does.
function breathesTheSameAir(state: WorldState, aId: string, bId: string, radius: number): boolean {
  const a = state.agents[aId]!, b = state.agents[bId]!
  if (a.insideId !== undefined || b.insideId !== undefined) return a.insideId === b.insideId
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= radius
}

// A wound is the world's other way into a fever. C9 rolled this at dawn in healthSystem and
// set a boolean nothing could lift; the roll is unchanged — same chance, same `health` stream,
// same open-wound window — but what it mints is an affliction the midnight turn above owns
// (batch-2 ruling 1). Gated with the rest of the system: an illness no night can lift is a
// life sentence, not a sickness.
function septicWounds(ctx: TickCtx): void {
  const chance = ctx.config.health.infectionChancePerInjuryPerDay
  const day = Math.floor(ctx.state().tick / MINUTES_PER_DAY)
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    for (const injury of a.injuries) {
      if (day >= injury.day + INJURY_HEAL_DAYS) continue
      const roll = ctx.rng.get('health').next()
      if (roll < chance && !hasIllness(ctx.state(), id)) {
        ctx.emit('agent_afflicted', { agentId: id, kind: 'illness', severity: 1 })
      }
    }
  }
}

export function illnessSystem(ctx: TickCtx): void {
  const cfg = ctx.config.illness
  if (!cfg.enabled) return
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour === 6 && time.minute === 0) septicWounds(ctx)
  if (time.hour !== 0 || time.minute !== 0) return
  const living = () => Object.keys(ctx.state().agents).sort().filter((id) => ctx.state().agents[id]!.alive)

  for (const id of living()) {
    const ill = ctx.state().agents[id]!.afflictions?.find((x) => x.kind === 'illness')
    if (ill === undefined) continue
    if (ctx.rng.get('illness').next() < cfg.dailyWorsenChance) {
      ctx.emit('affliction_worsened', { agentId: id, kind: 'illness', severity: ill.severity + 1 })
    } else if (ill.severity <= 1) {
      ctx.emit('affliction_recovered', { agentId: id, kind: 'illness' })
    } else {
      ctx.emit('affliction_worsened', { agentId: id, kind: 'illness', severity: ill.severity - 1 })
    }
  }

  if (!cfg.contagionEnabled) return
  // Read the carriers once, before anybody catches anything: a body infected tonight does
  // not pass it on tonight, and the order of ids never changes what the night produces.
  const carriers = living().filter((id) => hasIllness(ctx.state(), id))
  for (const src of carriers) {
    for (const target of living()) {
      if (target === src || hasIllness(ctx.state(), target)) continue
      if (!breathesTheSameAir(ctx.state(), src, target, cfg.contagionRadius)) continue
      if (ctx.rng.get('illness').next() >= cfg.contagionChance) continue
      ctx.emit('agent_afflicted', { agentId: target, kind: 'illness', severity: 1, sourceId: src })
    }
  }
}
