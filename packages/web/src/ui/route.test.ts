import { describe, expect, it } from 'vitest'
import { parseRoute, routeToPath, type Route } from './route.js'

describe('route', () => {
  it('parses a deep link with lens and agent', () => {
    expect(parseRoute('/moment/41/14:30', '?lens=inspector&agent=farmer')).toEqual({
      lens: 'inspector', moment: { day: 41, time: '14:30' }, agentId: 'farmer',
    })
  })

  it('accepts the day-prefixed form', () => {
    expect(parseRoute('/moment/day41/14:30', '')).toEqual({
      lens: 'map', moment: { day: 41, time: '14:30' }, agentId: null,
    })
  })

  it('rejects a bad time as moment null', () => {
    expect(parseRoute('/moment/41/24:00', '').moment).toBeNull()
    expect(parseRoute('/moment/41/nonsense', '').moment).toBeNull()
  })

  it('defaults: root path, unknown lens', () => {
    expect(parseRoute('/', '')).toEqual({ lens: 'map', moment: null, agentId: null })
    expect(parseRoute('/', '?lens=xray').lens).toBe('map')
  })

  it('routeToPath round-trips', () => {
    const routes: Route[] = [
      { lens: 'map', moment: null, agentId: null },
      { lens: 'inspector', moment: { day: 41, time: '14:30' }, agentId: 'farmer' },
      { lens: 'director', moment: { day: 0, time: '00:05' }, agentId: null },
      { lens: 'society', moment: null, agentId: 'fisher' },
    ]
    for (const r of routes) {
      const full = routeToPath(r)
      const q = full.indexOf('?')
      const pathname = q === -1 ? full : full.slice(0, q)
      const search = q === -1 ? '' : full.slice(q)
      expect(parseRoute(pathname, search)).toEqual(r)
    }
  })
})
