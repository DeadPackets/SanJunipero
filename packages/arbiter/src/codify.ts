import { crafterStamp, RECIPE_TILE_IDS, registerVerb, shortOf, skillLevel, VERBS } from '@sj/engine'
import type { PendingEvent, Structure, VerbDef, WorldState } from '@sj/engine'
import type { DiscoveryCredit, SimConfig } from '@sj/shared'
import { charterFromAttempt, type AttemptVerdict, type VerbCharter } from './charter.js'
import type { CodexStore } from './codex.js'
import type { ReviewStore } from './review.js'
import type { RulebookStore } from './rulebook.js'
import { productsOf, recipeSanityRefusal } from './sanity.js'
import { rollOutcomeTable, skillFactor } from './verdict.js'
import type { OutcomeEffect } from './verdict.js'
import type { Codified } from './adjudicate.js'

function heldStacks(state: WorldState, agentId: string, kind: string) {
  return Object.keys(state.items)
    .sort()
    .map((id) => state.items[id]!)
    .filter((i) => i.kind === kind && i.loc.t === 'agent' && i.loc.id === agentId)
}

function heldQty(state: WorldState, agentId: string, kind: string): number {
  return heldStacks(state, agentId, kind).reduce((sum, i) => sum + i.qty, 0)
}

function anyStructureNear(
  state: WorldState,
  agentId: string,
  pred: (s: Structure) => boolean,
): boolean {
  const a = state.agents[agentId]!
  for (const id of Object.keys(state.structures)) {
    const s = state.structures[id]!
    const overlaps =
      s.x <= a.x + 1 && s.x + s.w - 1 >= a.x - 1 && s.y <= a.y + 1 && s.y + s.h - 1 >= a.y - 1
    if (overlaps && pred(s)) return true
  }
  return false
}

function anyAdjacentTile(state: WorldState, agentId: string, tile: string): boolean {
  const a = state.agents[agentId]!
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      if (state.terrain[a.y + dy]?.[a.x + dx] === RECIPE_TILE_IDS[tile]) return true
    }
  }
  return false
}

// A craft hard enough to be worth a specialist's name on the result.
export function isExpertCharter(
  charter: { skillCheck?: { difficulty: number } | undefined },
  config: SimConfig,
): boolean {
  return (
    charter.skillCheck !== undefined &&
    charter.skillCheck.difficulty >= config.crafting.expertDifficulty
  )
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// `params` are the closed keys the act named, already validated against the charter's `reads`;
// `verb` is what the chronicle calls a witnessed act.
export function emitOutcomeEffects(
  state: WorldState,
  agentId: string,
  effects: OutcomeEffect[],
  ctx: {
    stamp?: { owner?: string; crafterMark?: string }
    params?: Record<string, unknown>
    verb?: string
  } = {},
): PendingEvent[] {
  const events: PendingEvent[] = []
  const params = ctx.params ?? {}
  let nextId = state.counters.nextEntityId
  for (const e of effects) {
    switch (e.op) {
      case 'spawn_item':
        events.push({
          type: 'item_spawned',
          payload: {
            id: `item_${nextId++}`,
            kind: e.kind,
            qty: e.qty,
            loc: { t: 'agent', id: agentId },
            ...ctx.stamp,
            ...(e.durability === undefined ? {} : { durability: e.durability }),
          },
        })
        break
      case 'gain_skill':
        events.push({ type: 'skill_gained', payload: { agentId, track: e.track, xp: e.xp } })
        break
      case 'hp_delta':
        events.push({ type: 'hp_changed', payload: { agentId, delta: e.delta } })
        break
      case 'mark': {
        const id =
          e.on === 'self' ? agentId : str(params[e.on === 'target' ? 'targetId' : `${e.on}Id`])
        if (id === undefined) break
        const on = e.on === 'self' || e.on === 'target' ? 'agent' : e.on
        events.push({ type: 'marked', payload: { on, id, key: e.key, value: e.value } })
        break
      }
      case 'witness': {
        const a = state.agents[agentId]!
        events.push({
          type: 'agent_expressed',
          payload: {
            agentId,
            verb: ctx.verb ?? 'act',
            x: a.x,
            y: a.y,
            sense: e.sense,
            ...(a.insideId === undefined ? {} : { insideId: a.insideId }),
            label: e.label,
            ...(e.radius === undefined ? {} : { radius: e.radius }),
          },
        })
        break
      }
      case 'name_place': {
        const structureId = str(params.structureId)
        if (structureId === undefined) break
        events.push({
          type: 'place_named',
          payload: { structureId, name: e.text, byId: agentId },
        })
        break
      }
      case 'transfer': {
        const id = str(params.itemId)
        const owner = str(params.targetId)
        if (id === undefined || owner === undefined) break
        events.push({ type: 'item_owner_changed', payload: { id, owner } })
        break
      }
      case 'need_delta':
        events.push({
          type: 'needs_changed',
          payload: { id: agentId, changes: [{ need: e.need, delta: e.delta }] },
        })
        break
      case 'none':
        break
    }
  }
  return events
}

// What each key a charter reads must point at, judged as the tier-1 verbs judge it: a person
// at your side, a thing in your hands, a building you stand beside.
function readsRefusal(
  state: WorldState,
  agentId: string,
  reads: VerbCharter['reads'],
  params: Record<string, unknown>,
): string | null {
  const a = state.agents[agentId]!
  for (const key of reads) {
    const id = str(params[key])
    if (id === undefined)
      return `name ${key}, the ${key === 'targetId' ? 'person' : 'thing'} it is for`
    if (key === 'targetId') {
      const target = state.agents[id]
      if (id === agentId) return 'that is yourself'
      if (!target?.alive) return 'no one there'
      if (Math.max(Math.abs(target.x - a.x), Math.abs(target.y - a.y)) > 1) return 'too far away'
    } else if (key === 'itemId') {
      const loc = state.items[id]?.loc
      if (loc?.t !== 'agent' || loc.id !== agentId) return 'not in your hands'
    } else if (key === 'structureId') {
      if (!anyStructureNear(state, agentId, (near) => near.id === id))
        return 'you must be beside it'
    }
  }
  return null
}

// A tool is used, not consumed: every completed codified use costs it one point of
// durability, and the point that empties it breaks it in the hand.
function wearTools(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  charter: VerbCharter,
): PendingEvent[] {
  if (!config.tools.wearEnabled) return []
  const events: PendingEvent[] = []
  for (const req of charter.requires) {
    if (req.type !== 'held_item') continue
    let remaining = req.qty
    for (const stack of heldStacks(state, agentId, req.kind)) {
      if (remaining <= 0) break
      remaining -= stack.qty
      if (stack.durability === undefined) continue
      events.push({ type: 'item_worn', payload: { id: stack.id, delta: -config.tools.wearPerUse } })
      if (stack.durability - config.tools.wearPerUse <= 0) {
        events.push({ type: 'item_broke', payload: { id: stack.id } })
      }
    }
  }
  return events
}

export function verbFromCharter(charter: VerbCharter): VerbDef {
  return {
    kind: charter.id,
    validate(state, _config, agentId, params) {
      const unnamed = readsRefusal(state, agentId, charter.reads, params)
      if (unnamed !== null) return unnamed
      for (const cost of charter.costs) {
        if (heldQty(state, agentId, cost.kind) < cost.qty) return shortOf(cost.kind)
      }
      for (const req of charter.requires) {
        switch (req.type) {
          case 'held_item': {
            if (heldQty(state, agentId, req.kind) < req.qty)
              return `you need ${req.qty} ${req.kind}`
            break
          }
          case 'adjacent_tile': {
            if (!anyAdjacentTile(state, agentId, req.tile))
              return `you must be beside ${req.tile} ground`
            break
          }
          case 'adjacent_structure': {
            if (!anyStructureNear(state, agentId, (s) => s.kind === req.kind))
              return `you must be beside a ${req.kind}`
            break
          }
          case 'adjacent_fire': {
            if (!anyStructureNear(state, agentId, (s) => s.burning)) return 'you need a fire nearby'
            break
          }
        }
      }
      return null
    },
    duration() {
      return charter.durationTicks
    },
    onStart(state, _config, agentId) {
      // Mirrors the engine craft verb: re-check sufficiency at consumption time
      // so a stack that shrank since validate never yields a discounted craft.
      for (const cost of charter.costs) {
        if (heldQty(state, agentId, cost.kind) < cost.qty) return []
      }
      const events: PendingEvent[] = []
      for (const cost of charter.costs) {
        let remaining = cost.qty
        for (const stack of heldStacks(state, agentId, cost.kind)) {
          if (remaining <= 0) break
          const take = Math.min(stack.qty, remaining)
          events.push({ type: 'item_qty_changed', payload: { id: stack.id, delta: -take } })
          remaining -= take
        }
      }
      return events
    },
    onComplete(state, config, agentId, params, rng) {
      const skillCheck = charter.skillCheck
      const level = skillCheck ? skillLevel(state, agentId, skillCheck.track, config) : 0
      const factor = skillCheck ? skillFactor(level, skillCheck.difficulty) : 1
      const row = rollOutcomeTable(charter.outcomes, rng, factor)
      const mark =
        skillCheck && isExpertCharter(charter, config)
          ? crafterStamp(state, config, agentId, skillCheck.track)
          : {}
      return [
        ...emitOutcomeEffects(state, agentId, row.effects, {
          stamp: { ...(config.ownership.enabled ? { owner: agentId } : {}), ...mark },
          params,
          verb: charter.id,
        }),
        ...wearTools(state, config, agentId, charter),
      ]
    },
    ...(charter.skillCheck === undefined
      ? {}
      : { skill: { track: charter.skillCheck.track, xp: 10 } }),
    rngStream: charter.id,
  }
}

export function codify(
  attempt: AttemptVerdict,
  credit: DiscoveryCredit,
  deps: {
    rulebook: RulebookStore
    review: ReviewStore
    codex: CodexStore
    tick: number
    onCodified?: (d: Codified) => void
  },
): { ruleId: number; verb: string } {
  const recipe = attempt.recipe
  // Belt and suspenders: even a caller who bypasses adjudicate must not be
  // able to codify a recipe the codex has not earned.
  if (!deps.codex.withinAdjacency(recipe.canon)) {
    throw new Error(
      `cannot codify ${recipe.id}: canon ${recipe.canon.join(', ')} is beyond adjacency`,
    )
  }
  // Nor one that cannot stand as a permanent verb. The tableless checks apply to every
  // caller: a verdict word, a truncated id and an entity id are wrong on their face.
  const unsound = recipeSanityRefusal(recipe)
  if (unsound !== null) throw new Error(`cannot codify ${recipe.id}: ${unsound}`)
  const charter = charterFromAttempt(attempt, credit)
  // The ladder grows as it is climbed: the rung this craft rests on is earned, and the court's
  // proposed next rung stands one step out for the next ask.
  deps.codex.learn(charter.canon)
  if (charter.unlocks !== undefined) deps.codex.propose(charter.unlocks)
  const existing = deps.rulebook.byId(charter.id)
  if (existing) {
    // Active row is a no-op; a reverted one is reactivated so the review queue's re-open path
    // stays reachable, since UNIQUE(recipe_id) forbids a second insert either way.
    if (existing.revertedAtTick !== null) {
      deps.rulebook.reactivate(charter, deps.tick)
      if (!VERBS[charter.id]) registerVerb(verbFromCharter(charter))
      deps.review.queue(existing.id, charter.id, deps.tick)
    }
    return { ruleId: existing.id, verb: charter.id }
  }
  const ruleId = deps.rulebook.insert(charter, deps.tick)
  registerVerb(verbFromCharter(charter))
  deps.review.queue(ruleId, charter.id, deps.tick)
  // First insert only. A reactivation above is an operator re-opening a reverted rule, and the
  // admin is not its inventor — the original event is already in the log and stays there.
  deps.onCodified?.({
    recipeId: charter.id,
    name: charter.name,
    kind: 'craft',
    makes: productsOf(recipe),
    credit,
  })
  return { ruleId, verb: charter.id }
}
