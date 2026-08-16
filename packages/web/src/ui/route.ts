import { momentToTick } from '@sj/shared'

export const LENSES = ['map', 'inspector', 'chronicle', 'society', 'director', 'laws'] as const
export type Lens = typeof LENSES[number]
export type Route = {
  lens: Lens
  moment: { day: number; time: string } | null
  agentId: string | null
}

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  const lensParam = params.get('lens')
  const lens: Lens = (LENSES as readonly string[]).includes(lensParam ?? '') ? lensParam as Lens : 'map'
  const agentId = params.get('agent')

  let moment: Route['moment'] = null
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 3 && segs[0] === 'moment') {
    const day = Number(/^(?:day)?(\d+)$/.exec(segs[1]!)?.[1] ?? NaN)
    const time = decodeURIComponent(segs[2]!)
    if (!Number.isNaN(momentToTick(day, time))) moment = { day, time }
  }
  return { lens, moment, agentId }
}

export function routeToPath(r: Route): string {
  const path = r.moment ? `/moment/${r.moment.day}/${r.moment.time}` : '/'
  const params = new URLSearchParams()
  if (r.lens !== 'map') params.set('lens', r.lens)
  if (r.agentId !== null) params.set('agent', r.agentId)
  const q = params.toString()
  return q === '' ? path : `${path}?${q}`
}
