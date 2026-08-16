import { MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import type { FirstCtx, Milestone } from './types.js'

const verbOf = (ev: SimEvent): unknown => (ev.payload as Record<string, unknown> | null)?.verb

export const FIRST_DEFS: Array<{ kind: string; label: string; match: (ev: SimEvent) => boolean }> = [
  { kind: 'first_speech',    label: 'the first word spoken', match: (ev) => ev.type === 'agent_spoke' },
  { kind: 'first_structure', label: 'the first thing built', match: (ev) => ev.type === 'structure_completed' },
  { kind: 'first_fire',      label: 'the first fire',        match: (ev) => ev.type === 'fire_ignited' },
  { kind: 'first_injury',    label: 'the first wound',       match: (ev) => ev.type === 'agent_injured' },
  { kind: 'first_death',     label: 'the first grave',       match: (ev) => ev.type === 'agent_died' },
  { kind: 'first_trade',     label: 'the first trade',       match: (ev) => ev.type === 'action_completed' && verbOf(ev) === 'give' },
  { kind: 'first_harvest',   label: 'the first harvest',     match: (ev) => ev.type === 'crop_harvested' },
  { kind: 'first_infection', label: 'the first sickness',    match: (ev) => ev.type === 'agent_infected' },
  { kind: 'first_recovery',  label: 'the first recovery',    match: (ev) => ev.type === 'agent_recovered' },
  { kind: 'first_law',       label: 'the first law',         match: (_ev) => false }, // emitted from rulebookCount below
]

export function detectFirsts(events: SimEvent[], ctx: FirstCtx): Milestone[] {
  const seen = new Set(ctx.seenKinds)
  const out: Milestone[] = []
  const emit = (kind: string, label: string, ev: SimEvent): void => {
    seen.add(kind)
    out.push({ kind, label, eventSeq: ev.seq, day: Math.floor(ev.tick / MINUTES_PER_DAY), tick: ev.tick })
  }

  for (const ev of events) {
    for (const def of FIRST_DEFS) {
      if (!seen.has(def.kind) && def.match(ev)) emit(def.kind, def.label, ev)
    }
  }

  // Arbiter codification writes rulebook, not an event (plan Deviation #4) —
  // cite the day's first event instead.
  if (ctx.rulebookCount >= 1 && !seen.has('first_law') && events.length > 0) {
    emit('first_law', 'the first law', events[0])
  }
  return out
}
