import { momentToTick } from '@sj/shared'
import { BROADCAST_PARAM, broadcastFromSearch } from './broadcast.js'

export type Route = {
  /** the minute being watched, `null` while the view is live */
  moment: { day: number; time: string } | null
  /** the recorded day the filmstrip has open, by the id the record gave it */
  momentId: number | null
  /** the townsperson the ring is around, from `/agent/:id` or from the `?agent=` the canvas
   *  writes when a figure is clicked */
  agentId: string | null
  /** the stream frame (`broadcast.ts`), addressed rather than detected — this is the URL an
   *  OBS browser source is pointed at, and no viewport width may ever turn it on */
  broadcast: boolean
}

const TOWN = 'San Junipero'

/** The title the shipped `index.html` carries, and the tab's name for the town itself. */
export const TOWN_TITLE = `${TOWN} — a small town, watched kindly`

/** What the tab says about where the viewer is. The gateway writes the same shape into the head
 *  a crawler reads (`staticSite.ts`); this keeps the tab true once the app has taken over. */
export function titleFor(route: Route, personName: string | null): string {
  if (route.agentId !== null && personName !== null) return `${personName} — ${TOWN}`
  if (route.moment !== null) return `Day ${route.moment.day} — ${TOWN}`
  if (route.momentId !== null) return `A recorded day — ${TOWN}`
  return TOWN_TITLE
}

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  const segs = pathname.split('/').filter(Boolean)

  // /agent/:id is the address a share card is pasted from; `?agent=` is the older form the
  // canvas wrote, still read so a link copied before this lane keeps working.
  const linked = segs[0] === 'agent' && segs.length === 2 ? decodeURIComponent(segs[1]!) : null
  const agentId = linked ?? params.get('agent')

  // /moment/:day/:time is a point in time; /moment/:id is a recorded day. Both are shareable.
  let moment: Route['moment'] = null
  let momentId: number | null = null
  if (segs[0] === 'moment' && segs.length === 3) {
    const day = Number(/^(?:day)?(\d+)$/.exec(segs[1]!)?.[1] ?? NaN)
    const time = decodeURIComponent(segs[2]!)
    if (!Number.isNaN(momentToTick(day, time))) moment = { day, time }
  } else if (segs[0] === 'moment' && segs.length === 2) {
    const id = Number(segs[1])
    if (Number.isInteger(id) && id > 0) momentId = id
  }

  // A broadcast IS the town televised, so nothing a stream has no reader for is addressable.
  if (broadcastFromSearch(search)) return { moment, momentId, agentId: null, broadcast: true }
  return { moment, momentId, agentId, broadcast: false }
}

// An open recorded day outranks the minute inside it, and both outrank the person: the player
// owns which minute is on screen, and with no minute named the person IS the address.
function pathFor(r: Route): string {
  if (r.momentId !== null) return `/moment/${r.momentId}`
  if (r.moment !== null) return `/moment/${r.moment.day}/${r.moment.time}`
  if (r.agentId !== null) return `/agent/${encodeURIComponent(r.agentId)}`
  return '/'
}

export function routeToPath(r: Route): string {
  const path = pathFor(r)
  const params = new URLSearchParams()
  // A person the path already names needs no parameter saying so again.
  if (r.agentId !== null && !path.startsWith('/agent/')) params.set('agent', r.agentId)
  // Every scrub rewrites the address bar in place. Drop the flag here and the first minute
  // that passes takes the stream frame away with it.
  if (r.broadcast) params.set(BROADCAST_PARAM, '1')
  const q = params.toString()
  return q === '' ? path : `${path}?${q}`
}
