import { MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { TIER1_DEFS } from './milestones/tier1.js'
import type { FirstCtx, Milestone } from './types.js'

// C7's detector, now reading the tier-1 catalog instead of its own short list. The signature
// is unchanged on purpose: every landed caller keeps working, and the catalog is data.
export const FIRST_DEFS = TIER1_DEFS

const p = (ev: SimEvent): Record<string, unknown> => (ev.payload ?? {}) as Record<string, unknown>

export function detectFirsts(events: SimEvent[], ctx: FirstCtx): Milestone[] {
  const seen = new Set(ctx.seenKinds)
  const out: Milestone[] = []

  // What the pass can work out for itself: the kind of anything planned while it watched, and
  // the number of souls as births and deaths land. Injected answers win where they exist.
  const kinds = new Map<string, string>()
  for (const ev of events) {
    if (ev.type !== 'structure_planned') continue
    const id = p(ev).id
    const kind = p(ev).kind
    if (typeof id === 'string' && typeof kind === 'string') kinds.set(id, kind)
  }
  const structureKind = (id: string): string | undefined => ctx.structureKind?.(id) ?? kinds.get(id)
  let population = ctx.population ?? 0

  for (const ev of events) {
    if (ev.type === 'agent_spawned' || ev.type === 'agent_born') population += 1
    if (ev.type === 'agent_died') population -= 1
    const running: FirstCtx = { ...ctx, structureKind, population }
    for (const def of FIRST_DEFS) {
      if (seen.has(def.kind) || !def.match(ev, running)) continue
      seen.add(def.kind)
      out.push({
        kind: def.kind, tier: def.tier, domain: def.domain, label: def.label,
        eventSeq: ev.seq, day: Math.floor(ev.tick / MINUTES_PER_DAY), tick: ev.tick,
        agentIds: def.agentIds?.(ev) ?? [],
      })
    }
  }

  // Arbiter codification writes rulebook, not an event (plan Deviation #4) —
  // cite the day's first event instead.
  const law = FIRST_DEFS.find((d) => d.kind === 'first_law')!
  if (ctx.rulebookCount >= 1 && !seen.has('first_law') && events.length > 0) {
    const ev = events[0]!
    out.push({
      kind: law.kind, tier: law.tier, domain: law.domain, label: law.label,
      eventSeq: ev.seq, day: Math.floor(ev.tick / MINUTES_PER_DAY), tick: ev.tick, agentIds: [],
    })
  }
  return out
}
