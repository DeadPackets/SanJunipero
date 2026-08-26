import type { SimEvent } from '@sj/shared'
import type { HeatCtx, HeatScores, SceneSegment } from './types.js'

// `agent_fell_ill` and `agent_infected` keep their old weight because recorded logs carry them.
// `hp_changed` is absent: an afflicted body emits one every tick and would drown every signal.
export const CONFLICT_WEIGHT: Record<string, number> = {
  agent_injured: 1,
  agent_harmed: 1.5,
  agent_afflicted: 1,
  affliction_worsened: 1,
  agent_fell_ill: 1,
  agent_infected: 1,
  action_interrupted: 1,
  structure_damaged: 1,
  fire_ignited: 1.5,
  fire_spread: 1,
  structure_destroyed: 2,
  agent_collapsed: 1,
  agent_died: 3,
}

export const STAKES_WEIGHT: Record<string, number> = {
  agent_died: 3,
  agent_collapsed: 2,
  agent_injured: 1,
  agent_harmed: 1,
  agent_afflicted: 1,
  affliction_worsened: 1,
  // Relief is stakes resolved, and somebody kneeling to help is somebody with something to lose.
  affliction_recovered: 1,
  agent_tended: 1,
  grave_placed: 1,
  fire_ignited: 1,
  structure_destroyed: 1,
  crop_withered: 1,
  crop_harvested: 0.5,
  agent_fell_ill: 1,
  agent_recovered: 0.5,
}

// events: the day's events; only those whose seq is in scene.eventIds are scored
// (SceneSegment carries no event types — logged as a plan deviation).
export function scoreHeat(scene: SceneSegment, ctx: HeatCtx, events: SimEvent[]): HeatScores {
  const inScene = new Set(scene.eventIds)
  const evs = events.filter((e) => inScene.has(e.seq))

  let conflict = 0
  let spoke = 0
  for (const e of evs) {
    conflict += CONFLICT_WEIGHT[e.type] ?? 0
    if (e.type === 'agent_spoke') {
      spoke += 1
      if (spoke > 2) conflict += 0.25
    }
  }

  // A type absent from priorTypeCounts contributes 0 — the plan's idle fixture
  // (empty priorTypeCounts) must total 0.
  let novelty = 0
  for (const type of new Set(evs.map((e) => e.type))) {
    const prior = ctx.priorTypeCounts[type]
    if (prior !== undefined) novelty += 1 / (1 + prior)
  }

  const firsts = ctx.firstsInScene * 3
  const stakes = evs.reduce((sum, e) => sum + (STAKES_WEIGHT[e.type] ?? 0), 0)
  const dramaticIrony = ctx.privateThoughts > 0 && ctx.publicSpeech > 0 ? 1.5 : 0
  const total = Math.round((conflict + novelty + firsts + stakes + dramaticIrony) * 1000) / 1000
  return { conflict, novelty, firsts, stakes, dramaticIrony, total }
}

// sceneIndex is an index into the input scenes array, not a store id — the caller
// maps it through insertScenes' returned ids when a persisted id is needed.
export function rankScenesForDirector(
  scenes: SceneSegment[],
  heats: HeatScores[],
): { sceneIndex: number; total: number }[] {
  return scenes
    .map((_s, i) => ({ sceneIndex: i, total: heats[i]!.total }))
    .sort((a, b) => b.total - a.total || a.sceneIndex - b.sceneIndex)
}
