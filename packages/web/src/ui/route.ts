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
  const lens: Lens = (LENSES as readonly string[]).includes(lensParam ?? '') ? lensParam as Lens : 'map'
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
