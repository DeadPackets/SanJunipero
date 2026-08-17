import { crafterStamp, RECIPE_TILE_IDS, registerVerb, shortOf, skillLevel, VERBS } from '@sj/engine'
import type { PendingEvent, Structure, VerbDef, WorldState } from '@sj/engine'
import type { SimConfig } from '@sj/shared'
import type { CodexStore } from './codex.js'
import type { ReviewStore } from './review.js'
import type { RulebookStore } from './rulebook.js'
import { recipeSanityRefusal } from './sanity.js'
import { rollOutcomeTable, skillFactor } from './verdict.js'
import type { OutcomeEffect, Recipe } from './verdict.js'

function heldStacks(state: WorldState, agentId: string, kind: string) {
  return Object.keys(state.items).sort()
    .map((id) => state.items[id]!)
    .filter((i) => i.kind === kind && i.loc.t === 'agent' && i.loc.id === agentId)
}

function heldQty(state: WorldState, agentId: string, kind: string): number {
  return heldStacks(state, agentId, kind).reduce((sum, i) => sum + i.qty, 0)
}

function anyStructureNear(state: WorldState, agentId: string, pred: (s: Structure) => boolean): boolean {
  const a = state.agents[agentId]
  for (const id of Object.keys(state.structures)) {
    const s = state.structures[id]!
    const overlaps = s.x <= a.x + 1 && s.x + s.w - 1 >= a.x - 1 && s.y <= a.y + 1 && s.y + s.h - 1 >= a.y - 1
    if (overlaps && pred(s)) return true
  }
  return false
}

function anyAdjacentTile(state: WorldState, agentId: string, tile: string): boolean {
  const a = state.agents[agentId]
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      if (state.terrain[a.y + dy]?.[a.x + dx] === RECIPE_TILE_IDS[tile]) return true
    }
  }
  return false
}

// A recipe hard enough to be worth a specialist's name on the result.
export function isExpertRecipe(recipe: Recipe, config: SimConfig): boolean {
  return recipe.skillCheck !== undefined && recipe.skillCheck.difficulty >= config.crafting.expertDifficulty
}

export function emitOutcomeEffects(
  state: WorldState, agentId: string, effects: OutcomeEffect[],
  stamp: { owner?: string; crafterMark?: string } = {},
): PendingEvent[] {
  const events: PendingEvent[] = []
  let nextId = state.counters.nextEntityId
  for (const e of effects) {
    switch (e.op) {
      case 'spawn_item':
        events.push({
          type: 'item_spawned',
          payload: {
            id: `item_${nextId++}`, kind: e.kind, qty: e.qty, loc: { t: 'agent', id: agentId }, ...stamp,
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
      case 'none':
        break
    }
  }
  return events
}

// A tool is used, not consumed: every completed codified use costs it one point of
// durability, and the point that empties it breaks it in the hand.
function wearTools(state: WorldState, config: SimConfig, agentId: string, recipe: Recipe): PendingEvent[] {
  if (!config.tools.wearEnabled) return []
  const events: PendingEvent[] = []
  for (const req of recipe.requires) {
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

export function verbFromRecipe(recipe: Recipe): VerbDef {
  return {
    kind: recipe.id,
    validate(state, _config, agentId) {
      for (const cost of recipe.costs) {
        if (heldQty(state, agentId, cost.kind) < cost.qty) return shortOf(cost.kind)
      }
      for (const req of recipe.requires) {
        switch (req.type) {
          case 'held_item': {
            if (heldQty(state, agentId, req.kind) < req.qty) return `you need ${req.qty} ${req.kind}`
            break
          }
          case 'adjacent_tile': {
            if (!anyAdjacentTile(state, agentId, req.tile)) return `you must be beside ${req.tile} ground`
            break
          }
          case 'adjacent_structure': {
            if (!anyStructureNear(state, agentId, (s) => s.kind === req.kind)) return `you must be beside a ${req.kind}`
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
    duration() { return recipe.durationTicks },
    onStart(state, _config, agentId) {
      // Mirrors the engine craft verb: re-check sufficiency at consumption time
      // so a stack that shrank since validate never yields a discounted craft.
      for (const cost of recipe.costs) {
        if (heldQty(state, agentId, cost.kind) < cost.qty) return []
      }
      const events: PendingEvent[] = []
      for (const cost of recipe.costs) {
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
    onComplete(state, config, agentId, _params, rng) {
      const skillCheck = recipe.skillCheck
      const level = skillCheck ? skillLevel(state, agentId, skillCheck.track, config) : 0
      const factor = skillCheck ? skillFactor(level, skillCheck.difficulty) : 1
      const row = rollOutcomeTable(recipe.outcomeTable, rng, factor)
      const mark = skillCheck && isExpertRecipe(recipe, config)
        ? crafterStamp(state, config, agentId, skillCheck.track)
        : {}
      return [
        ...emitOutcomeEffects(state, agentId, row.effects, {
          ...(config.ownership.enabled ? { owner: agentId } : {}),
          ...mark,
        }),
        ...wearTools(state, config, agentId, recipe),
      ]
    },
    interruptible: recipe.interruptible,
    skill: recipe.skillCheck ? { track: recipe.skillCheck.track, xp: 10 } : undefined,
    rngStream: recipe.rngStream,
  }
}

export function codify(
  recipe: Recipe,
  deps: { rulebook: RulebookStore; review: ReviewStore; codex: CodexStore; tick: number },
): { ruleId: number; verb: string } {
  // Belt and suspenders: even a caller who bypasses adjudicate must not be
  // able to codify a recipe the codex has not earned.
  if (!deps.codex.withinAdjacency(recipe.canon)) {
    throw new Error(`cannot codify ${recipe.id}: canon ${recipe.canon.join(', ')} is beyond adjacency`)
  }
  // Nor one that cannot stand as a permanent verb. The tableless checks apply to every
  // caller: a verdict word, a truncated id and an entity id are wrong on their face.
  const unsound = recipeSanityRefusal(recipe)
  if (unsound !== null) throw new Error(`cannot codify ${recipe.id}: ${unsound}`)
  const existing = deps.rulebook.byId(recipe.id)
  if (existing) {
    // Active row → idempotent no-op; reverted row → reactivate it so the
    // review queue's re-open path is reachable (UNIQUE(recipe_id) forbids a
    // second insert either way).
    if (existing.revertedAtTick !== null) {
      deps.rulebook.reactivate(recipe, deps.tick)
      if (!VERBS[recipe.id]) registerVerb(verbFromRecipe(recipe))
      deps.review.queue(existing.id, recipe.id, deps.tick)
    }
    return { ruleId: existing.id, verb: recipe.id }
  }
  const ruleId = deps.rulebook.insert(recipe, deps.tick)
  registerVerb(verbFromRecipe(recipe))
  deps.review.queue(ruleId, recipe.id, deps.tick)
  return { ruleId, verb: recipe.id }
}
