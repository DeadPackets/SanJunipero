import { simTimeFromTick } from '@sj/shared'
import { FAUNA_KINDS, type FaunaKind } from '../data/faunaDefs.js'
import { mintId, type TileId, type WorldState } from '../state.js'
import type { RngStream } from '../rng.js'
import type { TickCtx } from '../worldTick.js'

// Bodies with no minds. They wander where the ground suits them, they run from anything alive
// that comes close, and at dawn the world puts back some of what was taken — up to the caps,
// and half as generously in winter. Every roll is drawn here, at emission, and the destination
// it produced travels in the payload, so `fold` never touches the stream.

// The ground each kind will stand on. This is the whole of "home range": a deer does not leave
// the wood and the meadow beside it, a fish does not leave the water. No stored anchor, because
// a second copy of where a body belongs is a second thing that can drift (G4).
export const FAUNA_HABITAT: Readonly<Record<FaunaKind, ReadonlySet<TileId>>> = {
  deer: new Set<TileId>([0, 3]),
  rabbit: new Set<TileId>([0, 1]),
  fish: new Set<TileId>([2, 10]),
}

// Not a dial (the SimConfigSchema is closed after Task 2): how often a dawn slot actually
// fills. The caps are the ecology; this is only how fast the world walks back to them.
export const FAUNA_SPAWN_CHANCE = 0.25

// The eight ways out of a tile, in a fixed order so the roll means the same thing every run.
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
]

const chebyshev = (x1: number, y1: number, x2: number, y2: number): number =>
  Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))

function habitable(state: WorldState, kind: FaunaKind, x: number, y: number): boolean {
  const tile = state.terrain[y]?.[x]
  return tile !== undefined && FAUNA_HABITAT[kind].has(tile)
}

// The nearest living body out in the open. A hunter indoors is a hunter nothing can smell.
function nearestThreat(state: WorldState, x: number, y: number, radius: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (const id of Object.keys(state.agents).sort()) {
    const a = state.agents[id]!
    if (!a.alive || a.insideId !== undefined) continue
    const d = chebyshev(x, y, a.x, a.y)
    if (d > radius || d >= bestDist) continue
    bestDist = d
    best = { x: a.x, y: a.y }
  }
  return best
}

// Away from the threat, twice as far as a wander — and if the far tile is no place for this
// body, the near one; and if that is no place either, it stands its ground.
export function fleeTo(
  state: WorldState, kind: FaunaKind, from: { x: number; y: number }, threat: { x: number; y: number },
): { x: number; y: number } {
  const dx = Math.sign(from.x - threat.x)
  const dy = Math.sign(from.y - threat.y)
  for (const step of [2, 1]) {
    const to = { x: from.x + dx * step, y: from.y + dy * step }
    if ((to.x !== from.x || to.y !== from.y) && habitable(state, kind, to.x, to.y)) return to
  }
  return from
}

function wanderTo(
  state: WorldState, kind: FaunaKind, from: { x: number; y: number }, rng: RngStream,
): { x: number; y: number } {
  const [dx, dy] = STEPS[rng.int(STEPS.length)]!
  const to = { x: from.x + dx, y: from.y + dy }
  return habitable(state, kind, to.x, to.y) ? to : from
}

export function faunaSystem(ctx: TickCtx): void {
  const cfg = ctx.config.fauna
  if (!cfg.enabled) return
  const rng = ctx.rng.get('fauna')
  const tick = ctx.state().tick
  const time = simTimeFromTick(tick)

  if (tick % cfg.movePeriodTicks === 0) {
    const moves: Array<{ id: string; x: number; y: number }> = []
    for (const id of Object.keys(ctx.state().fauna ?? {}).sort()) {
      const f = ctx.state().fauna![id]!
      if (!f.alive) continue
      const threat = nearestThreat(ctx.state(), f.x, f.y, cfg.fleeRadius)
      const to = threat === null ? wanderTo(ctx.state(), f.kind, f, rng) : fleeTo(ctx.state(), f.kind, f, threat)
      if (to.x === f.x && to.y === f.y) continue
      moves.push({ id, x: to.x, y: to.y })
    }
    if (moves.length > 0) ctx.emit('fauna_moved', { moves })
  }

  if (time.hour !== 6 || time.minute !== 0) return
  const winter = time.season === 'winter'
  const h = ctx.state().terrain.length
  const w = ctx.state().terrain[0]?.length ?? 0
  for (const kind of FAUNA_KINDS) {
    const cap = cfg.caps[kind]
    const living = Object.values(ctx.state().fauna ?? {}).filter((f) => f.kind === kind && f.alive).length
    // Winter halves the rolls, not their odds: half as many chances at the same ground.
    const slots = Math.max(0, cap - living)
    const rolls = winter ? Math.floor(slots / 2) : slots
    for (let i = 0; i < rolls; i++) {
      if (rng.next() >= FAUNA_SPAWN_CHANCE) continue
      const x = rng.int(w)
      const y = rng.int(h)
      if (!habitable(ctx.state(), kind, x, y)) continue
      ctx.emit('fauna_spawned', {
        id: mintId(ctx.state(), 'fauna'), kind, x, y,
        ...(kind === 'fish' ? { stock: 1 } : {}),
      })
    }
  }
}
