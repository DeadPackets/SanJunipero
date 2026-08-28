import { momentToTick } from '@sj/shared'
import { BROADCAST_PARAM, broadcastFromSearch } from './broadcast.js'

export type Route = {
  /** the minute being watched, `null` while the view is live */
  moment: { day: number; time: string } | null
  /** the recorded day the filmstrip has open, by the id the record gave it */
  momentId: number | null
  /** the townsperson the ring is around; the canvas writes this when a figure is clicked */
  agentId: string | null
  /** the stream frame (`broadcast.ts`), addressed rather than detected — this is the URL an
   *  OBS browser source is pointed at, and no viewport width may ever turn it on */
  broadcast: boolean
}

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  const agentId = params.get('agent')

  // /moment/:day/:time is a point in time; /moment/:id is a recorded day. Both are shareable.
  let moment: Route['moment'] = null
  let momentId: number | null = null
  const segs = pathname.split('/').filter(Boolean)
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

export function routeToPath(r: Route): string {
  // An open recorded day outranks the minute inside it: the day is what a viewer is watching,
  // and the player owns which of its minutes is on screen.
  const path =
    r.momentId !== null
      ? `/moment/${r.momentId}`
      : r.moment === null
        ? '/'
        : `/moment/${r.moment.day}/${r.moment.time}`
  const params = new URLSearchParams()
  if (r.agentId !== null) params.set('agent', r.agentId)
  // Every scrub rewrites the address bar in place. Drop the flag here and the first minute
  // that passes takes the stream frame away with it.
  if (r.broadcast) params.set(BROADCAST_PARAM, '1')
  const q = params.toString()
  return q === '' ? path : `${path}?${q}`
}
