import { MINUTES_PER_DAY, simTimeFromTick, T_GRASS, T_PATH, type SimConfig } from '@sj/shared'
import { fromTileKey, tileKey, type WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

// Nobody plans a desire path. Feet wear grass to dirt where the town actually goes, and grass
// takes it back where the town stopped going. Zero RNG anywhere in this law.

// A step counts only when it is a step: a body mid-walk, on a world that wears.
export function countsAsFootfall(state: WorldState, agentId: string, config: SimConfig): boolean {
  return config.desirePaths.enabled && state.agents[agentId]?.activity?.verb === 'walk'
}

export function decayTraffic(value: number, config: SimConfig): number {
  return Math.max(0, Math.floor(value * (1 - config.desirePaths.decayPerDay)))
}

// Which trails are standing empty tonight, and since when. A tile busy again loses its stamp;
// a tile that stopped being a trail — paved, overgrown, flooded — drops out entirely.
export function quietPathsAt(
  state: WorldState,
  traffic: Record<string, number>,
  day: number,
  config: SimConfig,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (let y = 0; y < state.terrain.length; y++) {
    const row = state.terrain[y]!
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== T_PATH) continue
      const key = tileKey(x, y)
      if ((traffic[key] ?? 0) >= config.desirePaths.regrowThreshold) continue
      out[key] = state.quietSince?.[key] ?? day
    }
  }
  return out
}

export function desirePathsSystem(ctx: TickCtx): void {
  const cfg = ctx.config.desirePaths
  if (!cfg.enabled) return
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 0 || time.minute !== 0) return
  const day = Math.floor(ctx.state().tick / MINUTES_PER_DAY)

  for (const key of Object.keys(ctx.state().traffic ?? {}).sort()) {
    if ((ctx.state().traffic?.[key] ?? 0) < cfg.wearThreshold) continue
    const { x, y } = fromTileKey(key)
    if (ctx.state().terrain[y]?.[x] !== T_GRASS) continue
    ctx.emit('tile_changed', { x, y, from: T_GRASS, to: T_PATH, reason: 'worn' })
  }

  for (const key of Object.keys(ctx.state().quietSince ?? {}).sort()) {
    if (day - ctx.state().quietSince![key]! < cfg.overgrowDays) continue
    const { x, y } = fromTileKey(key)
    if (ctx.state().terrain[y]?.[x] !== T_PATH) continue
    ctx.emit('tile_changed', { x, y, from: T_PATH, to: T_GRASS, reason: 'overgrown' })
  }

  ctx.emit('traffic_decayed', {})
}
