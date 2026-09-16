import {
  DEFAULT_CONFIG,
  ORCHARD_ANCHOR,
  ORCHARD_SQUARE,
  ORCHARD_SIZE,
  ORCHARD_GARDENS,
  orchardContains,
  orchardCourtGarden,
  orchardCourts,
  orchardKey,
  orchardOverlaps,
  orchardPlots,
  orchardReserved,
  orchardStreetTiles,
  isTravelled,
  isWet,
  type OrchardPlot,
  type TownClaim,
} from '@sj/shared'
import { authoredOrigin, type WorldState } from './state.js'
import { isPassable, pathCtx } from './path.js'

export function orchardOrigin(state: WorldState): { x: number; y: number } {
  const origin = authoredOrigin(state)
  return { x: ORCHARD_ANCHOR.x - origin.x, y: ORCHARD_ANCHOR.y - origin.y }
}

export function orchardSquare(state: WorldState): { x: number; y: number } {
  const origin = orchardOrigin(state)
  return { x: origin.x + ORCHARD_SQUARE.x, y: origin.y + ORCHARD_SQUARE.y }
}

export function orchardSiteReserved(
  state: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const origin = orchardOrigin(state),
    site = { x: x - origin.x, y: y - origin.y, w, h }
  for (let yy = site.y; yy < site.y + h; yy++)
    for (let xx = site.x; xx < site.x + w; xx++) if (orchardReserved(xx, yy)) return true
  const radius = Math.ceil(Math.max(state.terrain.length, state.terrain[0]!.length) / 24) + 2
  for (const c of orchardCourts(radius)) {
    if (c.i !== 0 || c.j !== 0) {
      if (orchardOverlaps(site, orchardCourtGarden(c.i, c.j))) return true
      if (orchardStreetTiles(c.i, c.j).some((p) => orchardContains(site, p.x, p.y))) return true
    }
    if (orchardPlots(c.i, c.j).some((p) => orchardOverlaps(site, { ...p, h: p.h + 1 }, 1)))
      return true
  }
  return false
}

export function claimOrchardPlot(
  state: WorldState,
  need: { along: number; deep: number },
): TownClaim | null {
  if (need.along > 4 || need.deep > 3 || need.along < 1 || need.deep < 1) return null
  const origin = orchardOrigin(state),
    square = orchardSquare(state),
    height = state.terrain.length,
    width = state.terrain[0]!.length
  const standing = Object.values(state.structures).map((s) => ({
    ...s,
    x: s.x - origin.x,
    y: s.y - origin.y,
  }))
  const ctx = pathCtx(state, DEFAULT_CONFIG)
  const pass = (x: number, y: number) => isPassable(state, x, y, ctx)
  const reachable = new Set<string>(),
    queue = [{ x: square.x, y: square.y }]
  for (let n = 0; n < queue.length; n++) {
    const p = queue[n]!,
      k = orchardKey(p.x, p.y)
    if (reachable.has(k) || !pass(p.x, p.y)) continue
    reachable.add(k)
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ])
      if (!reachable.has(orchardKey(p.x + dx!, p.y + dy!)))
        queue.push({ x: p.x + dx!, y: p.y + dy! })
  }
  const streets = new Set<string>(),
    streetQueue = [square]
  for (let n = 0; n < streetQueue.length; n++) {
    const p = streetQueue[n]!,
      key = orchardKey(p.x, p.y),
      tile = state.terrain[p.y]?.[p.x]
    if (
      streets.has(key) ||
      tile === undefined ||
      (!isTravelled(tile) && !ctx.decks.has(p.y * width + p.x)) ||
      !pass(p.x, p.y)
    )
      continue
    streets.add(key)
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ])
      if (!streets.has(orchardKey(p.x + dx!, p.y + dy!)))
        streetQueue.push({ x: p.x + dx!, y: p.y + dy! })
  }
  const radius = Math.ceil(Math.max(width, height) / 24) + 2,
    courts = orchardCourts(radius)
  for (const court of courts)
    for (const plot of orchardPlots(court.i, court.j)) {
      if (standing.some((s) => orchardOverlaps(plot, s, 1))) continue
      const site = {
        x: plot.x + origin.x,
        y: plot.y + origin.y,
        w: plot.facing === 'se' ? need.deep : need.along,
        h: plot.facing === 'se' ? need.along : need.deep,
      }
      const door =
        plot.facing === 'se'
          ? { x: site.x + site.w, y: site.y + ((site.h - 1) >> 1) }
          : { x: site.x + ((site.w - 1) >> 1), y: site.y + site.h }
      if (!reachable.has(orchardKey(door.x, door.y))) continue
      let clear = true
      for (let y = plot.y - 1; y <= plot.y + plot.h; y++)
        for (let x = plot.x - 1; x <= plot.x + plot.w; x++) {
          const tile = state.terrain[y + origin.y]?.[x + origin.x]
          if (
            tile === undefined ||
            isWet(tile) ||
            (orchardReserved(x, y) && orchardContains(plot, x, y))
          )
            clear = false
          if (
            orchardContains(plot, x, y) &&
            tile !== undefined &&
            (isTravelled(tile) || tile === 6)
          )
            clear = false
        }
      if (!clear) continue
      const route = pathToStreet(state, origin, plot, door, courts, ctx, streets)
      if (route === null) continue
      const cleared = []
      if (court.i !== 0 || court.j !== 0) {
        const garden = orchardCourtGarden(court.i, court.j)
        let gardenClear = true
        for (let y = garden.y; y < garden.y + garden.h; y++)
          for (let x = garden.x; x < garden.x + garden.w; x++) {
            const wx = x + origin.x,
              wy = y + origin.y,
              tile = state.terrain[wy]?.[wx]
            if (tile === undefined || isWet(tile) || tile === 6 || !pass(wx, wy))
              gardenClear = false
            cleared.push({ x: wx, y: wy })
          }
        if (!gardenClear) continue
      }
      for (let y = site.y; y < site.y + site.h; y++)
        for (let x = site.x; x < site.x + site.w; x++) cleared.push({ x, y })
      return {
        site,
        door,
        facing: plot.facing,
        block: court,
        slot: plot.slot,
        rings: Math.max(1, court.i, Math.abs(court.j)),
        ground: { cleared, paved: route },
      }
    }
  return null
}

function pathToStreet(
  state: WorldState,
  origin: { x: number; y: number },
  plot: OrchardPlot,
  door: { x: number; y: number },
  courts: { i: number; j: number }[],
  ctx: ReturnType<typeof pathCtx>,
  streets: Set<string>,
): { x: number; y: number }[] | null {
  const blocked = new Set<string>()
  const reserve = (x: number, y: number) => blocked.add(orchardKey(x + origin.x, y + origin.y))
  for (const court of courts) {
    for (const p of orchardPlots(court.i, court.j))
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) reserve(x, y)
    const gardens =
      court.i === 0 && court.j === 0 ? ORCHARD_GARDENS : [orchardCourtGarden(court.i, court.j)]
    for (const g of gardens)
      for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) reserve(x, y)
  }
  blocked.delete(orchardKey(door.x, door.y))
  const queue = [door],
    prev = new Map<string, string | null>([[orchardKey(door.x, door.y), null]])
  let end: string | null = null
  for (let n = 0; n < queue.length; n++) {
    const p = queue[n]!,
      k = orchardKey(p.x, p.y)
    if (streets.has(k)) {
      end = k
      break
    }
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ]) {
      const x = p.x + dx!,
        y = p.y + dy!,
        next = orchardKey(x, y)
      if (
        prev.has(next) ||
        blocked.has(next) ||
        !isPassable(state, x, y, ctx) ||
        state.terrain[y]?.[x] === 6
      )
        continue
      prev.set(next, k)
      queue.push({ x, y })
    }
  }
  if (end === null) return null
  const result: { x: number; y: number }[] = []
  while (end !== null) {
    const [x, y] = end.split(',').map(Number)
    result.push({ x: x!, y: y! })
    end = prev.get(end)!
  }
  if (plot.court.i !== 0 || plot.court.j !== 0)
    for (const p of orchardStreetTiles(plot.court.i, plot.court.j)) {
      const x = p.x + origin.x,
        y = p.y + origin.y,
        tile = state.terrain[y]?.[x]
      if (tile === undefined || isWet(tile) || !isPassable(state, x, y, ctx) || tile === 6)
        return null
      result.push({ x, y })
    }
  return result
}

export function orchardGroundBox(state: WorldState): {
  dx0: number
  dy0: number
  dx1: number
  dy1: number
} {
  const o = orchardOrigin(state)
  const structures = Object.values(state.structures)
  return {
    dx0: Math.min(o.x + 18, ...structures.map((s) => s.x)) - 3,
    dy0: Math.min(o.y + 15, ...structures.map((s) => s.y)) - 3,
    dx1: Math.max(o.x + 65, ...structures.map((s) => s.x + s.w)) + 3,
    dy1: Math.max(o.y + ORCHARD_SIZE - 12, ...structures.map((s) => s.y + s.h)) + 3,
  }
}
