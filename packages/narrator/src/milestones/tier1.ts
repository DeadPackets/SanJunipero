import { simTimeFromTick, type SimEvent } from '@sj/shared'
import type { FirstCtx, MilestoneDef } from '../types.js'

// Tier 1 — engine firsts, as data: a new first is a row and never a branch. No label here
// reaches a mind, and none of them names a number.

const p = (ev: SimEvent): Record<string, unknown> => (ev.payload ?? {}) as Record<string, unknown>
const verbOf = (ev: SimEvent): unknown => p(ev).verb
const one = (key: string) => (ev: SimEvent): string[] => {
  const v = p(ev)[key]
  return typeof v === 'string' ? [v] : []
}

// The closed vocabulary of ways to die, and the sentence the town would use for each. Mirrors
// the engine's DEATH_CAUSES; the guard test holds the two together.
export const DEATH_CAUSE_LABELS: Readonly<Record<string, string>> = {
  injury: 'the first death from wounds',
  poison: 'the first death from something eaten',
  illness: 'the first death from sickness',
  fatigue: 'the first death from exhaustion',
  exposure: 'the first death from the cold',
  hunger: 'the first death from hunger',
  thirst: 'the first death from thirst',
  slain: 'the first killing',
  old_age: 'the first death of old age',
}

const deathDefs: MilestoneDef[] = Object.entries(DEATH_CAUSE_LABELS).map(([cause, label]) => ({
  kind: `first_death_${cause}`,
  label,
  tier: 1,
  domain: 'engine',
  match: (ev) => ev.type === 'agent_died' && p(ev).cause === cause,
  agentIds: one('agentId'),
}))

// Kinds are `first_*` without exception, which is what lets the glass scan catch a kind it
// has never heard of the day somebody writes it.
const POPULATION_MARKS: ReadonlyArray<{ n: number; word: string }> = [
  { n: 10, word: 'ten' }, { n: 25, word: 'twenty_five' }, { n: 50, word: 'fifty' },
]

const populationDefs: MilestoneDef[] = POPULATION_MARKS.map(({ n, word }) => ({
  kind: `first_${word}_souls`,
  label: `the day there were ${word.replace('_', '-')} of them`,
  tier: 1 as const,
  domain: 'engine',
  match: (_ev: SimEvent, ctx: FirstCtx) => (ctx.population ?? 0) >= n,
}))

export const TIER1_DEFS: MilestoneDef[] = [
  // The C7 rows, unchanged in kind and label so a town's existing ledger still reads true.
  { kind: 'first_speech', label: 'the first word spoken', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_spoke', agentIds: one('agentId') },
  { kind: 'first_structure', label: 'the first thing built', tier: 1, domain: 'engine', match: (ev) => ev.type === 'structure_completed' },
  { kind: 'first_fire', label: 'the first fire', tier: 1, domain: 'engine', match: (ev) => ev.type === 'fire_ignited' },
  { kind: 'first_injury', label: 'the first wound', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_injured', agentIds: one('agentId') },
  { kind: 'first_death', label: 'the first grave', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_died', agentIds: one('agentId') },
  { kind: 'first_trade', label: 'the first trade', tier: 1, domain: 'engine', match: (ev) => ev.type === 'action_completed' && verbOf(ev) === 'give', agentIds: one('agentId') },
  { kind: 'first_harvest', label: 'the first harvest', tier: 1, domain: 'engine', match: (ev) => ev.type === 'crop_harvested' },
  // Sickness moved onto afflictions; the older event still counts so an older
  // town's ledger reads true, and a C11 town's first fever is the same first.
  { kind: 'first_infection', label: 'the first sickness', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_infected' || (ev.type === 'agent_afflicted' && p(ev).kind === 'illness'), agentIds: one('agentId') },
  { kind: 'first_recovery', label: 'the first recovery', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_recovered', agentIds: one('agentId') },
  { kind: 'first_law', label: 'the first law', tier: 1, domain: 'engine', match: () => false }, // emitted from rulebookCount

  // C11's deep world, in the same shape.
  { kind: 'first_house', label: 'the first roof of their own', tier: 1, domain: 'engine', match: (ev, ctx) => ev.type === 'structure_completed' && ctx.structureKind?.(String(p(ev).id)) === 'house' },
  { kind: 'first_bridge', label: 'the first crossing', tier: 1, domain: 'engine', match: (ev, ctx) => ev.type === 'structure_completed' && ctx.structureKind?.(String(p(ev).id)) === 'bridge' },
  { kind: 'first_meal', label: 'the first meal eaten', tier: 1, domain: 'engine', match: (ev) => ev.type === 'action_completed' && verbOf(ev) === 'eat', agentIds: one('agentId') },
  { kind: 'first_fish', label: 'the first fish taken', tier: 1, domain: 'engine', match: (ev) => ev.type === 'action_completed' && verbOf(ev) === 'fish', agentIds: one('agentId') },
  { kind: 'first_hunt', label: 'the first beast brought down', tier: 1, domain: 'engine', match: (ev) => ev.type === 'fauna_killed' && typeof p(ev).byId === 'string', agentIds: one('byId') },
  { kind: 'first_tool', label: 'the first tool made', tier: 1, domain: 'engine', match: (ev) => ev.type === 'item_spawned' && p(ev).durability !== undefined },
  { kind: 'first_expert_craft', label: 'the first work worth a maker\'s mark', tier: 1, domain: 'engine', match: (ev) => ev.type === 'item_spawned' && typeof p(ev).crafterMark === 'string', agentIds: one('crafterMark') },
  { kind: 'first_theft', label: 'the first taking that was seen', tier: 1, domain: 'engine', match: (ev) => ev.type === 'item_taken' && p(ev).takerId !== p(ev).ownerId, agentIds: one('takerId') },
  { kind: 'first_road', label: 'the first stretch of road', tier: 1, domain: 'engine', match: (ev) => ev.type === 'tile_changed' && p(ev).reason === 'paved', agentIds: one('byId') },
  { kind: 'first_channel', label: 'the first water led to the fields', tier: 1, domain: 'engine', match: (ev) => ev.type === 'tile_changed' && p(ev).reason === 'channel', agentIds: one('byId') },
  { kind: 'first_fire_out', label: 'the first fire beaten back', tier: 1, domain: 'engine', match: (ev) => ev.type === 'fire_extinguished' && p(ev).cause === 'doused', agentIds: one('agentId') },
  { kind: 'first_inscription', label: 'the first words cut into a wall', tier: 1, domain: 'engine', match: (ev) => ev.type === 'structure_inscribed', agentIds: one('agentId') },
  { kind: 'first_invention', label: 'the first craft nobody had done before', tier: 1, domain: 'engine', match: (ev) => ev.type === 'action_completed' && typeof verbOf(ev) === 'string' && String(verbOf(ev)).startsWith('recipe:'), agentIds: one('agentId') },
  { kind: 'first_expression', label: 'the first act done for its own sake', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_expressed', agentIds: one('agentId') },
  { kind: 'first_pregnancy', label: 'the first child on the way', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_conceived', agentIds: (ev) => [String(p(ev).motherId), String(p(ev).fatherId)] },
  { kind: 'first_birth', label: 'the first child born here', tier: 1, domain: 'engine', match: (ev) => ev.type === 'agent_born', agentIds: one('id') },
  { kind: 'first_grave', label: 'the first stone set for the dead', tier: 1, domain: 'engine', match: (ev) => ev.type === 'grave_placed', agentIds: one('agentId') },
  { kind: 'first_world_grown', label: 'the world is wider than it was', tier: 1, domain: 'engine', match: (ev) => ev.type === 'world_grown' },
  { kind: 'first_winter_survived', label: 'the first winter come through', tier: 1, domain: 'engine', match: (ev) => isFirstDayOfSpringAfterAWinter(ev.tick) },
  { kind: 'first_year', label: 'a whole year in this valley', tier: 1, domain: 'engine', match: (ev) => simTimeFromTick(ev.tick).year >= 1 },
  ...deathDefs,
  ...populationDefs,
]

// Spring day one of any year after the first: the town went into a winter and came out of it.
function isFirstDayOfSpringAfterAWinter(tick: number): boolean {
  const t = simTimeFromTick(tick)
  return t.year >= 1 && t.dayOfYear === 0
}
