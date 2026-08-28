import { describe, expect, it } from 'vitest'
import { parseRoute, routeToPath, type Route } from './route.js'

describe('route', () => {
  it('parses a deep link with the picked person', () => {
    expect(parseRoute('/moment/41/14:30', '?agent=farmer')).toEqual({
      moment: { day: 41, time: '14:30' },
      agentId: 'farmer',
      broadcast: false,
    })
  })

  it('accepts the day-prefixed form', () => {
    expect(parseRoute('/moment/day41/14:30', '')).toEqual({
      moment: { day: 41, time: '14:30' },
      agentId: null,
      broadcast: false,
    })
  })

  it('rejects a bad time as moment null', () => {
    expect(parseRoute('/moment/41/24:00', '').moment).toBeNull()
    expect(parseRoute('/moment/41/nonsense', '').moment).toBeNull()
  })

  it('defaults to the live town at the root path', () => {
    expect(parseRoute('/', '')).toEqual({ moment: null, agentId: null, broadcast: false })
  })

  // The canvas picks a figure by writing `?agent=` and firing popstate, and the lens words the
  // old chrome wrote beside it are not a route any more.
  it('ignores every parameter but the person and the stream flag', () => {
    expect(parseRoute('/', '?lens=inspector&open=amara&agent=amara')).toEqual({
      moment: null,
      agentId: 'amara',
      broadcast: false,
    })
  })

  it('a broadcast address carries no picked person', () => {
    const r = parseRoute('/', '?broadcast=1&agent=amara')
    expect(r.broadcast).toBe(true)
    expect(r.agentId).toBeNull()
  })

  it('routeToPath round-trips', () => {
    const routes: Route[] = [
      { moment: null, agentId: null, broadcast: false },
      { moment: { day: 41, time: '14:30' }, agentId: 'farmer', broadcast: false },
      { moment: { day: 0, time: '00:05' }, agentId: null, broadcast: false },
      { moment: null, agentId: 'fisher', broadcast: false },
      { moment: null, agentId: null, broadcast: true },
    ]
    for (const r of routes) {
      const full = routeToPath(r)
      const q = full.indexOf('?')
      const pathname = q === -1 ? full : full.slice(0, q)
      const search = q === -1 ? '' : full.slice(q)
      expect(parseRoute(pathname, search), full).toEqual(r)
    }
  })
})
