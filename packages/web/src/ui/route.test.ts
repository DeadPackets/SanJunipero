import { describe, expect, it } from 'vitest'
import {
  backToRoster, isSingleAgentView, navToLens, parseRoute, routeToPath, type Route,
} from './route.js'

describe('route', () => {
  it('parses a deep link with lens and agent', () => {
    expect(parseRoute('/moment/41/14:30', '?lens=inspector&agent=farmer')).toEqual({
      lens: 'inspector', moment: { day: 41, time: '14:30' }, momentId: null, agentId: 'farmer', openId: null, broadcast: false,
    })
  })

  it('accepts the day-prefixed form', () => {
    expect(parseRoute('/moment/day41/14:30', '')).toEqual({
      lens: 'map', moment: { day: 41, time: '14:30' }, momentId: null, agentId: null, openId: null, broadcast: false,
    })
  })

  it('rejects a bad time as moment null', () => {
    expect(parseRoute('/moment/41/24:00', '').moment).toBeNull()
    expect(parseRoute('/moment/41/nonsense', '').moment).toBeNull()
  })

  it('defaults: root path, unknown lens', () => {
    expect(parseRoute('/', '')).toEqual({ lens: 'map', moment: null, momentId: null, agentId: null, openId: null, broadcast: false })
    expect(parseRoute('/', '?lens=xray').lens).toBe('map')
  })

  it('parses a recorded day by its own id, and opens the lens that can play it', () => {
    expect(parseRoute('/moment/42', '')).toEqual({
      lens: 'director', moment: null, momentId: 42, agentId: null, openId: null, broadcast: false,
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
      { lens: 'map', moment: null, momentId: null, agentId: null, openId: null, broadcast: false },
      { lens: 'inspector', moment: { day: 41, time: '14:30' }, momentId: null, agentId: 'farmer', openId: null, broadcast: false },
      { lens: 'director', moment: { day: 0, time: '00:05' }, momentId: null, agentId: null, openId: null, broadcast: false },
      { lens: 'society', moment: null, momentId: null, agentId: 'fisher', openId: null, broadcast: false },
      { lens: 'director', moment: null, momentId: 42, agentId: null, openId: null, broadcast: false },
      { lens: 'chronicle', moment: null, momentId: 1, agentId: 'farmer', openId: null, broadcast: false },
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
    expect(routeToPath({ lens: 'director', moment: { day: 3, time: '09:00' }, momentId: 8, agentId: null, openId: null, broadcast: false }))
      .toBe('/moment/8?lens=director')
  })
})


// USER BUG 2026-08-17: picking a townsperson to follow left no way back to the roster.
describe('stepping back out of a single-character view', () => {
  const roster: Route = { lens: 'inspector', moment: null, momentId: null, agentId: null, openId: null, broadcast: false }
  const following: Route = { ...roster, agentId: 'amara', openId: null, broadcast: false }

  it('knows when it is showing one person rather than the roster', () => {
    expect(isSingleAgentView(following)).toBe(true)
    expect(isSingleAgentView(roster)).toBe(false)
    expect(isSingleAgentView({ ...following, lens: 'map' })).toBe(false)
  })

  it('ROUTE 1 - the back affordance returns to the roster', () => {
    expect(backToRoster(following)).toEqual(roster)
  })

  it('ROUTE 2 - clicking TOWNSFOLK while reading one person returns to the roster', () => {
    expect(navToLens(following, 'inspector')).toEqual(roster)
  })

  it('ROUTE 3 - Escape uses the same transition as the other two', () => {
    expect(backToRoster(following)).toEqual(navToLens(following, 'inspector'))
  })

  it('is a no-op on the roster itself, so back cannot fall out of the lens', () => {
    expect(backToRoster(roster)).toBe(roster)
    expect(navToLens(roster, 'inspector')).toEqual(roster)
  })

  it('never disturbs another lens, or the moment a viewer is standing in', () => {
    const scrubbed: Route = {
      lens: 'chronicle', moment: { day: 2, time: '11:15' }, momentId: null, agentId: 'amara',
      openId: null, broadcast: false,
    }
    expect(backToRoster(scrubbed)).toBe(scrubbed)
    expect(navToLens(scrubbed, 'map')).toEqual({ ...scrubbed, lens: 'map' })
  })

  it('still switches lens normally from a single-character view', () => {
    expect(navToLens(following, 'chronicle')).toEqual({ ...following, lens: 'chronicle' })
  })

  it('leaves a route the address bar can still round-trip', () => {
    const back = backToRoster(following)
    const path = routeToPath(back)
    const [p, q] = path.split('?')
    expect(parseRoute(p!, q ?? '')).toEqual(back)
  })
})
