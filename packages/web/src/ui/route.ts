import { momentToTick } from '@sj/shared'

export const LENSES = ['map', 'inspector', 'chronicle', 'society', 'director', 'laws'] as const
export type Lens = typeof LENSES[number]
export type Route = {
  lens: Lens
  moment: { day: number; time: string } | null
  momentId: number | null              // a recorded day, by its narrator scene id
  agentId: string | null
}

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  const lensParam = params.get('lens')
  const agentId = params.get('agent')

  // Two moment links, told apart by their length rather than by guessing: three segments is
  // a point in time (/moment/:day/:time), two is a recorded day (/moment/:id).
  let moment: Route['moment'] = null
  let momentId: number | null = null
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 3 && segs[0] === 'moment') {
    const day = Number(/^(?:day)?(\d+)$/.exec(segs[1]!)?.[1] ?? NaN)
    const time = decodeURIComponent(segs[2]!)
    if (!Number.isNaN(momentToTick(day, time))) moment = { day, time }
  } else if (segs.length === 2 && segs[0] === 'moment' && /^[1-9]\d*$/.test(segs[1]!)) {
    momentId = Number(segs[1])
  }

  // A recorded day only plays in the Moments lens, so a hand-typed /moment/<id> opens there
  // rather than dropping the viewer on the map with a link that does nothing.
  const fallback: Lens = momentId === null ? 'map' : 'director'
  const lens: Lens = (LENSES as readonly string[]).includes(lensParam ?? '') ? lensParam as Lens : fallback
  return { lens, moment, momentId, agentId }
}

export function routeToPath(r: Route): string {
  const path =
    r.momentId !== null ? `/moment/${r.momentId}`
    : r.moment ? `/moment/${r.moment.day}/${r.moment.time}`
    : '/'
  const params = new URLSearchParams()
  if (r.lens !== 'map') params.set('lens', r.lens)
  if (r.agentId !== null) params.set('agent', r.agentId)
  const q = params.toString()
  return q === '' ? path : `${path}?${q}`
}


// ── stepping back out of a single-character view ────────────────────────────────────────
// USER BUG 2026-08-17: "there is no way to go back to the selection of townsfolk after
// picking one character to follow." The Townsfolk lens is a roster when `agentId` is null and
// one person's inspector when it is not, and nothing ever set it back. Three ways back, all
// of them the same transition, so they are one pure reducer and three thin adapters.

export const ROSTER_LENS: Lens = 'inspector'

export function isSingleAgentView(r: Route): boolean {
  return r.lens === ROSTER_LENS && r.agentId !== null
}

/** the back affordance and Escape: one person -> the roster. Everywhere else, unchanged. */
export function backToRoster(r: Route): Route {
  return isSingleAgentView(r) ? { ...r, agentId: null } : r
}

/**
 * Clicking a lens in the nav. Clicking TOWNSFOLK while already reading one person returns to
 * the roster rather than doing nothing - the nav item is the way back a viewer reaches for
 * first.
 */
export function navToLens(r: Route, lens: Lens): Route {
  if (lens === ROSTER_LENS && isSingleAgentView(r)) return { ...r, agentId: null }
  return { ...r, lens }
}
