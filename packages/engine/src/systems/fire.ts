import { simTimeFromTick } from '@sj/shared'
import type { Structure, WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

// Footprints whose nearest tiles touch, orthogonally or diagonally.
export function structuresAdjacent(a: Structure, b: Structure): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function sorted(state: WorldState): Structure[] {
  return Object.keys(state.structures).sort().map((id) => state.structures[id]!)
}

export function fireSystem(ctx: TickCtx): void {
  const cfg = ctx.config.fire
  const weather = ctx.state().weather.kind

  if (weather === 'rain') {
    for (const s of sorted(ctx.state())) {
      if (s.burning) ctx.emit('fire_extinguished', { structureId: s.id, cause: 'rain' })
    }
  }

  if (weather === 'storm' && simTimeFromTick(ctx.state().tick).minute === 0) {
    for (const s of sorted(ctx.state())) {
      if (!s.flammable || s.burning) continue
      if (ctx.rng.get('fire').next() < ctx.config.weather.stormLightningFireChance) {
        ctx.emit('fire_ignited', { structureId: s.id, cause: 'lightning' })
      }
    }
  }

  const spreadChance = cfg.spreadChancePerTickAdjacent * (weather === 'storm' ? cfg.stormSpreadMultiplier : 1)
  const sources = sorted(ctx.state()).filter((s) => s.burning).map((s) => s.id)
  for (const fromId of sources) {
    const from = ctx.state().structures[fromId]!
    for (const to of sorted(ctx.state())) {
      if (to.id === fromId || !to.flammable || to.burning || !structuresAdjacent(from, to)) continue
      if (ctx.rng.get('fire').next() < spreadChance) {
        ctx.emit('fire_spread', { fromId, toId: to.id })
      }
    }
  }

  for (const id of Object.keys(ctx.state().structures).sort()) {
    const s = ctx.state().structures[id]!
    if (!s.burning) continue
    const perTick = s.maxHp / cfg.burnTicksToDestroy
    if (s.burnTicks + 1 >= cfg.burnTicksToDestroy || s.hp <= perTick) {
      ctx.emit('fire_extinguished', { structureId: id, cause: 'burnout' })
      ctx.emit('structure_damaged', { id, amount: s.hp })
    } else {
      ctx.emit('structure_damaged', { id, amount: perTick })
    }
  }
}
