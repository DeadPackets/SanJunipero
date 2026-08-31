import { structuresInSight } from '../perception.js'
import type { TickCtx } from '../tickCtx.js'

// A person knows a town by having been in it. What the eyes have reached once stays reachable
// for good: the legs can be sent back to it by name, long after the walls drop out of sight.
export function sightSystem(ctx: TickCtx): void {
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    const known = new Set(a.knownPlaces ?? [])
    const fresh = structuresInSight(ctx.state(), ctx.config, id).filter((s) => !known.has(s))
    if (fresh.length > 0) ctx.emit('places_seen', { agentId: id, structureIds: fresh })
  }
}
