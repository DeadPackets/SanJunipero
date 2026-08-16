import { describe, expect, it } from 'vitest'
import { parseRoute, routeToPath, type Route } from './route.js'

describe('route', () => {
  it('parses a deep link with lens and agent', () => {
    expect(parseRoute('/moment/41/14:30', '?lens=inspector&agent=farmer')).toEqual({
      lens: 'inspector', moment: { day: 41, time: '14:30' }, momentId: null, agentId: 'farmer',
    })
  })

  it('accepts the day-prefixed form', () => {
    expect(parseRoute('/moment/day41/14:30', '')).toEqual({
      lens: 'map', moment: { day: 41, time: '14:30' }, momentId: null, agentId: null,
    })
  })

  it('rejects a bad time as moment null', () => {
    expect(parseRoute('/moment/41/24:00', '').moment).toBeNull()
    expect(parseRoute('/moment/41/nonsense', '').moment).toBeNull()
  })

  it('defaults: root path, unknown lens', () => {
    expect(parseRoute('/', '')).toEqual({ lens: 'map', moment: null, momentId: null, agentId: null })
    expect(parseRoute('/', '?lens=xray').lens).toBe('map')
  })

  it('parses a recorded day by its own id, and opens the lens that can play it', () => {
    expect(parseRoute('/moment/42', '')).toEqual({
      lens: 'director', moment: null, momentId: 42, agentId: null,
    })
    expect(parseRoute('/moment/42', '?lens=chronicle').lens).toBe('chronicle')
  })

  it('tells the two moment links apart by their length, not by guessing', () => {
    expect(parseRoute('/moment/41/14:30', '').momentId).toBeNull()
    expect(parseRoute('/moment/42', '').moment).toBeNull()
  })

  it('refuses an id that is not a number, or is zero', () => {
    for (const path of ['/moment/abc', '/moment/4.2', '/moment/-3', '/moment/0', '/moment/']) {
      const r = parseRoute(path, '')
      expect(r.momentId, path).toBeNull()
      expect(r.moment, path).toBeNull()
    }
  })

  it('routeToPath round-trips', () => {
    const routes: Route[] = [
      { lens: 'map', moment: null, momentId: null, agentId: null },
      { lens: 'inspector', moment: { day: 41, time: '14:30' }, momentId: null, agentId: 'farmer' },
      { lens: 'director', moment: { day: 0, time: '00:05' }, momentId: null, agentId: null },
      { lens: 'society', moment: null, momentId: null, agentId: 'fisher' },
      { lens: 'director', moment: null, momentId: 42, agentId: null },
      { lens: 'chronicle', moment: null, momentId: 1, agentId: 'farmer' },
    ]
    for (const r of routes) {
      const full = routeToPath(r)
      const q = full.indexOf('?')
      const pathname = q === -1 ? full : full.slice(0, q)
      const search = q === -1 ? '' : full.slice(q)
      expect(parseRoute(pathname, search), full).toEqual(r)
    }
  })

  it('lets the recorded day win when both are somehow set — one address, one meaning', () => {
    expect(routeToPath({ lens: 'director', moment: { day: 3, time: '09:00' }, momentId: 8, agentId: null }))
      .toBe('/moment/8?lens=director')
  })
})
