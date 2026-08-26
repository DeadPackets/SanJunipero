import { momentToTick } from '@sj/shared'
import { BROADCAST_PARAM, broadcastFromSearch } from './broadcast.js'

export const LENSES = ['map', 'inspector', 'chronicle', 'discoveries', 'society', 'director', 'laws'] as const
export type Lens = typeof LENSES[number]

/** THE ONE TABLE. The top nav and the control bar name one thing once — they used to keep a
 *  table each, and the two had already drifted ("Town"/"The town", "World Laws"/"World laws").
 *  Chrome copy speaks about townsfolk, never machinery (spec §5). */
export const LENS_LABELS: Readonly<Record<Lens, string>> = {
  map: 'Town', inspector: 'Townsfolk', chronicle: 'Chronicle', discoveries: 'What they made',
  society: 'Bonds', director: 'Moments', laws: 'World Laws',
}
export type Route = {
  lens: Lens
  moment: { day: number; time: string } | null
  momentId: number | null              // a recorded day, by its narrator scene id
  agentId: string | null
  /** the roster row that is open UNDER the list — a third state of the Townsfolk lens, and
   *  shareable like the other two. `?agent=` still opens the standalone page. */
  openId: string | null
  /** the stream frame (`broadcast.ts`), addressed rather than detected — this is the URL an
   *  OBS browser source is pointed at, and no viewport width may ever turn it on */
  broadcast: boolean
}

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  const lensParam = params.get('lens')
  const agentId = params.get('agent')
  const openId = params.get('open')

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

  // A broadcast IS the town televised, so the flag decides the lens rather than sitting beside it,
  // and the reading surfaces a stream has no reader for are not addressable at all.
  if (broadcastFromSearch(search)) {
    return { lens: 'director', moment, momentId: null, agentId: null, openId: null, broadcast: true }
  }
  return { lens, moment, momentId, agentId, openId, broadcast: false }
}

export function routeToPath(r: Route): string {
  const path =
    r.momentId !== null ? `/moment/${r.momentId}`
    : r.moment ? `/moment/${r.moment.day}/${r.moment.time}`
    : '/'
  const params = new URLSearchParams()
  if (r.lens !== 'map') params.set('lens', r.lens)
  if (r.agentId !== null) params.set('agent', r.agentId)
  if (r.openId !== null) params.set('open', r.openId)
  // Every scrub rewrites the address bar in place. Drop the flag here and the first minute
  // that passes takes the stream frame away with it.
  if (r.broadcast) params.set(BROADCAST_PARAM, '1')
  const q = params.toString()
  return q === '' ? path : `${path}?${q}`
}


// ── stepping back out of a single-character view ────────────────────────────────────────

export const ROSTER_LENS: Lens = 'inspector'

export function isSingleAgentView(r: Route): boolean {
  return r.lens === ROSTER_LENS && r.agentId !== null
}

/** the back affordance and Escape: one person -> the roster. Everywhere else, unchanged. */
export function backToRoster(r: Route): Route {
  return isSingleAgentView(r) ? { ...r, agentId: null } : r
}

/** Clicking a lens in the nav. Clicking TOWNSFOLK while already reading one person returns to the
 *  roster rather than doing nothing - the nav item is the way back a viewer reaches for first. */
export function navToLens(r: Route, lens: Lens): Route {
  // The stream frame has one view by construction. Its tabs are gone, but the left/right keys
  // are still live on the canvas, and a stray press must not walk a broadcast into the roster.
  if (r.broadcast) return r
  if (lens === ROSTER_LENS && isSingleAgentView(r)) return { ...r, agentId: null }
  return { ...r, lens }
}
