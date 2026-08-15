import { registerVerb } from '@sj/engine'
import type { PendingEvent, Structure, TileId, VerbDef, WorldState } from '@sj/engine'
import type { CodexStore } from './codex.js'
import type { ReviewStore } from './review.js'
import type { RulebookStore } from './rulebook.js'
import { rollOutcomeTable, skillFactor } from './verdict.js'
import type { OutcomeEffect, Recipe } from './verdict.js'

const TILE_IDS: Record<string, TileId> = {
  grass: 0, dirt: 1, water: 2, forest: 3, rock: 4, sand: 5, farmland: 6,
}

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
      if (state.terrain[a.y + dy]?.[a.x + dx] === TILE_IDS[tile]) return true
    }
  }
  return false
}

export function emitOutcomeEffects(state: WorldState, agentId: string, effects: OutcomeEffect[]): PendingEvent[] {
  const events: PendingEvent[] = []
  let nextId = state.counters.nextEntityId
  for (const e of effects) {
    switch (e.op) {
      case 'spawn_item':
        events.push({
          type: 'item_spawned',
          payload: { id: `item_${nextId++}`, kind: e.kind, qty: e.qty, loc: { t: 'agent', id: agentId } },
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

export function verbFromRecipe(recipe: Recipe): VerbDef {
  return {
    kind: recipe.id,
    validate(state, _config, agentId) {
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
      const events: PendingEvent[] = []
      for (const cost of recipe.costs) {
        const stack = heldStacks(state, agentId, cost.kind)[0]
        if (stack) events.push({ type: 'item_qty_changed', payload: { id: stack.id, delta: -cost.qty } })
      }
      return events
    },
    onComplete(state, config, agentId, _params, rng) {
      const skillCheck = recipe.skillCheck
      const level = skillCheck
        ? Math.min(
            config.skills.maxLevel,
            Math.floor(Math.sqrt((state.agents[agentId].skills[skillCheck.track] ?? 0) / config.skills.xpLevelDivisor)),
          )
        : 0
      const factor = skillCheck ? skillFactor(level, skillCheck.difficulty) : 1
      const row = rollOutcomeTable(recipe.outcomeTable, rng, factor)
      return emitOutcomeEffects(state, agentId, row.effects)
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
  const ruleId = deps.rulebook.insert(recipe, deps.tick)
  registerVerb(verbFromRecipe(recipe))
  deps.review.queue(ruleId, recipe.id, deps.tick)
  return { ruleId, verb: recipe.id }
}
