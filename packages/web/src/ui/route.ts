import { momentToTick } from '@sj/shared'
import { BROADCAST_PARAM, broadcastFromSearch } from './broadcast.js'

export type Route = {
  /** the minute being watched, `null` while the view is live */
  moment: { day: number; time: string } | null
  /** the townsperson the ring is around; the canvas writes this when a figure is clicked */
  agentId: string | null
  /** the stream frame (`broadcast.ts`), addressed rather than detected — this is the URL an
   *  OBS browser source is pointed at, and no viewport width may ever turn it on */
  broadcast: boolean
}

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  const agentId = params.get('agent')

  // /moment/:day/:time — a point in time, shareable
  let moment: Route['moment'] = null
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 3 && segs[0] === 'moment') {
    const day = Number(/^(?:day)?(\d+)$/.exec(segs[1]!)?.[1] ?? NaN)
    const time = decodeURIComponent(segs[2]!)
    if (!Number.isNaN(momentToTick(day, time))) moment = { day, time }
  }

  // A broadcast IS the town televised, so nothing a stream has no reader for is addressable.
  if (broadcastFromSearch(search)) return { moment, agentId: null, broadcast: true }
  return { moment, agentId, broadcast: false }
}

export function routeToPath(r: Route): string {
  const path = r.moment === null ? '/' : `/moment/${r.moment.day}/${r.moment.time}`
  const params = new URLSearchParams()
  if (r.agentId !== null) params.set('agent', r.agentId)
  // Every scrub rewrites the address bar in place. Drop the flag here and the first minute
  // that passes takes the stream frame away with it.
  if (r.broadcast) params.set(BROADCAST_PARAM, '1')
  const q = params.toString()
  return q === '' ? path : `${path}?${q}`
}
