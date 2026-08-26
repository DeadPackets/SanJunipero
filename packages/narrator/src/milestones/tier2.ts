import { MINUTES_PER_DAY, type SimConfig, type SimEvent } from '@sj/shared'
import { partnershipOf } from '@sj/engine'
import type { WorldState } from '@sj/engine'
import type { Milestone } from '../types.js'

// Tier 2 — pattern firsts: a shape across several events. Deterministic rules only, and
// nothing this file writes reaches a mind.

const p = (ev: SimEvent): Record<string, unknown> => (ev.payload ?? {}) as Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const pairKeyOf = (a: string, b: string): string => [a, b].sort().join('|')

// Two mouths answering each other close enough to hear, inside one turn of the hour.
const CONVERSATION_TICKS = 30

export type Tier2Ctx = {
  seenKinds: Set<string>
  config: SimConfig
  // The engine's own relationship rows. Absent for a pass with no world in reach, and the
  // three detectors that need one simply do not run.
  state?: WorldState
}

type Found = { kind: string; label: string; ev: SimEvent; agentIds: string[] }

// A pair spoke, within earshot of each other, within half an hour.
function conversation(events: SimEvent[], config: SimConfig): Found | null {
  const said = events.filter((e) => e.type === 'agent_spoke')
  for (let i = 0; i < said.length; i++) {
    for (let j = i + 1; j < said.length; j++) {
      const a = said[i]!
      const b = said[j]!
      const aId = str(p(a).agentId)
      const bId = str(p(b).agentId)
      if (aId === null || bId === null || aId === bId) continue
      if (b.tick - a.tick > CONVERSATION_TICKS) break
      const dx = Number(p(a).x) - Number(p(b).x)
      const dy = Number(p(a).y) - Number(p(b).y)
      if (Math.hypot(dx, dy) > config.movement.earshotRadius) continue
      return { kind: 'first_conversation', label: 'the first time two voices answered each other', ev: b, agentIds: [aId, bId].sort() }
    }
  }
  return null
}

// A hand raised against another body, and then — later — the two of them talking again.
function quarrelAndPeace(events: SimEvent[]): Found[] {
  const out: Found[] = []
  let quarrel: { pair: string; tick: number; ids: string[] } | null = null
  for (const ev of events) {
    if (ev.type === 'agent_harmed' && p(ev).source === 'attack') {
      const hurt = str(p(ev).agentId)
      const by = str(p(ev).byId)
      if (hurt === null || by === null) continue
      if (quarrel === null) {
        quarrel = { pair: pairKeyOf(hurt, by), tick: ev.tick, ids: [hurt, by].sort() }
        out.push({ kind: 'first_quarrel', label: 'the first blow struck in anger', ev, agentIds: quarrel.ids })
      }
      continue
    }
    if (ev.type === 'agent_spoke' && quarrel !== null && ev.tick > quarrel.tick) {
      const who = str(p(ev).agentId)
      if (who !== null && quarrel.ids.includes(who) && !out.some((f) => f.kind === 'first_reconciliation')) {
        const spokeFirst = out.find((f) => f.kind === 'first_quarrel')
        if (spokeFirst !== undefined && ev.tick - quarrel.tick > CONVERSATION_TICKS) {
          out.push({ kind: 'first_reconciliation', label: 'the first peace made after a quarrel', ev, agentIds: quarrel.ids })
        }
      }
    }
  }
  return out
}

// A night kept often enough to be a partnership, counted off the nights themselves.
function partnership(events: SimEvent[], config: SimConfig): Found | null {
  const nights = new Map<string, number>()
  for (const ev of events) {
    if (ev.type !== 'co_slept') continue
    const a = str(p(ev).aId)
    const b = str(p(ev).bId)
    if (a === null || b === null) continue
    const key = pairKeyOf(a, b)
    const n = (nights.get(key) ?? 0) + 1
    nights.set(key, n)
    if (n === config.reproduction.coSleepNightsToPartner) {
      return { kind: 'first_partnership', label: 'the first two who chose each other', ev, agentIds: [a, b].sort() }
    }
  }
  return null
}

// A night kept with somebody else while a partnership stands. The engine's rows say who is
// partnered; this only reads them (`partnershipOf`, never `pairNights`).
function affair(events: SimEvent[], ctx: Tier2Ctx): Found | null {
  const state = ctx.state
  if (state === undefined) return null
  for (const ev of events) {
    if (ev.type !== 'co_slept') continue
    const a = str(p(ev).aId)
    const b = str(p(ev).bId)
    if (a === null || b === null) continue
    for (const who of [a, b]) {
      const other = who === a ? b : a
      for (const third of Object.keys(state.agents).sort()) {
        if (third === who || third === other) continue
        const row = partnershipOf(state, who, third)
        if (row?.formedTick === null || row === undefined) continue
        if (row.dissolvedTick !== null) continue
        return { kind: 'first_affair', label: 'the first night kept away from a partner', ev, agentIds: [a, b].sort() }
      }
    }
  }
  return null
}

// A partnership dissolves on a rolling window a brief separation can trip, so a breakup asks
// for more: dissolved, and no speech and no shared roof for the whole window.
function breakup(events: SimEvent[], ctx: Tier2Ctx): Found | null {
  const state = ctx.state
  if (state === undefined) return null
  const windowTicks = ctx.config.reproduction.partnerWindowDays * MINUTES_PER_DAY
  const earshot = ctx.config.movement.earshotRadius
  const ids = Object.keys(state.agents).sort()
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!
      const b = ids[j]!
      const row = partnershipOf(state, a, b)
      if (row === undefined || row.formedTick === null || row.dissolvedTick === null) continue
      const since = row.dissolvedTick - windowTicks
      const spoke = events.some((ev) => {
        if (ev.tick < since || ev.tick > row.dissolvedTick!) return false
        if (ev.type === 'co_slept') return pairKeyOf(String(p(ev).aId), String(p(ev).bId)) === pairKeyOf(a, b)
        if (ev.type !== 'agent_spoke') return false
        const who = str(p(ev).agentId)
        if (who !== a && who !== b) return false
        const heard = state.agents[who === a ? b : a]
        if (heard === undefined) return false
        return Math.hypot(Number(p(ev).x) - heard.x, Number(p(ev).y) - heard.y) <= earshot
      })
      if (spoke) continue
      const last = events.filter((ev) => ev.tick <= row.dissolvedTick!).at(-1) ?? events.at(-1)
      if (last === undefined) continue
      return { kind: 'first_breakup', label: 'the first parting', ev: last, agentIds: [a, b].sort() }
    }
  }
  return null
}

// A child with nobody left to raise it.
function orphan(events: SimEvent[], parents: Map<string, string[]>, dead: Set<string>): Found | null {
  for (const ev of events) {
    if (ev.type !== 'agent_died') continue
    const who = str(p(ev).agentId)
    if (who === null) continue
    dead.add(who)
    for (const [child, folk] of [...parents.entries()].sort()) {
      if (dead.has(child) || !folk.includes(who)) continue
      if (folk.every((f) => dead.has(f))) {
        return { kind: 'first_orphan', label: 'the first child left with nobody', ev, agentIds: [child] }
      }
    }
  }
  return null
}

// Three generations: a child whose own parent was born here to a parent of theirs.
function grandparent(events: SimEvent[], parents: Map<string, string[]>): Found | null {
  for (const ev of events) {
    if (ev.type !== 'agent_born') continue
    const child = str(p(ev).id)
    if (child === null) continue
    for (const folk of parents.get(child) ?? []) {
      const grandfolk = parents.get(folk)
      if (grandfolk !== undefined && grandfolk.length > 0) {
        return { kind: 'first_grandparent', label: 'the first to see a grandchild', ev, agentIds: grandfolk.slice().sort() }
      }
    }
  }
  return null
}

// A pupil who was taught a craft and then went on gaining in it under their own hands.
const MASTERY_GAINS = 3
function apprentice(events: SimEvent[]): Found | null {
  const taught = new Map<string, Set<string>>()
  const gains = new Map<string, number>()
  for (const ev of events) {
    if (ev.type === 'action_completed' && p(ev).verb === 'teach') {
      const results = p(ev).results as Record<string, unknown> | undefined
      const pupil = str(results?.targetId)
      const track = str(results?.track)
      if (pupil === null || track === null) continue
      const set = taught.get(pupil) ?? new Set<string>()
      set.add(track)
      taught.set(pupil, set)
      continue
    }
    if (ev.type !== 'skill_gained') continue
    const who = str(p(ev).agentId)
    const track = str(p(ev).track)
    if (who === null || track === null || !(taught.get(who)?.has(track) ?? false)) continue
    const key = `${who}:${track}`
    const n = (gains.get(key) ?? 0) + 1
    gains.set(key, n)
    if (n >= MASTERY_GAINS) {
      return { kind: 'first_apprentice', label: 'the first to master what they were taught', ev, agentIds: [who] }
    }
  }
  return null
}

// Who came from whom, read off the births in this pass. A parent the pass never saw born is
// simply not a grandparent yet, which is the truth from where the narrator stands.
function parentIndex(events: SimEvent[]): Map<string, string[]> {
  const parents = new Map<string, string[]>()
  for (const ev of events) {
    if (ev.type !== 'agent_born') continue
    const child = str(p(ev).id)
    const mother = str(p(ev).motherId)
    const father = str(p(ev).fatherId)
    if (child === null) continue
    parents.set(child, [mother, father].filter((x): x is string => x !== null))
  }
  return parents
}

export function detectTier2(events: SimEvent[], ctx: Tier2Ctx): Milestone[] {
  const parents = parentIndex(events)
  const found: Array<Found | null> = [
    conversation(events, ctx.config),
    ...quarrelAndPeace(events),
    partnership(events, ctx.config),
    affair(events, ctx),
    breakup(events, ctx),
    orphan(events, parents, new Set()),
    grandparent(events, parents),
    apprentice(events),
  ]
  const out: Milestone[] = []
  for (const f of found) {
    if (f === null || ctx.seenKinds.has(f.kind) || out.some((m) => m.kind === f.kind)) continue
    out.push({
      kind: f.kind, tier: 2, domain: 'social', label: f.label,
      eventSeq: f.ev.seq, day: Math.floor(f.ev.tick / MINUTES_PER_DAY), tick: f.ev.tick,
      agentIds: f.agentIds,
    })
  }
  return out
}
