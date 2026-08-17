import { simTimeFromTick } from '@sj/shared'
import type { WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

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

export function illnessSystem(ctx: TickCtx): void {
  const cfg = ctx.config.illness
  if (!cfg.enabled) return
  const time = simTimeFromTick(ctx.state().tick)
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
