import { describe, expect, it } from 'vitest'
import { TOWN_TITLE, parseRoute, routeToPath, titleFor, type Route } from './route.js'

describe('route', () => {
  it('parses a deep link with the picked person', () => {
    expect(parseRoute('/moment/41/14:30', '?agent=farmer')).toEqual({
      moment: { day: 41, time: '14:30' },
      momentId: null,
      agentId: 'farmer',
      broadcast: false,
    })
  })

  it('accepts the day-prefixed form', () => {
    expect(parseRoute('/moment/day41/14:30', '')).toEqual({
      moment: { day: 41, time: '14:30' },
      momentId: null,
      agentId: null,
      broadcast: false,
    })
  })

  it('rejects a bad time as moment null', () => {
    expect(parseRoute('/moment/41/24:00', '').moment).toBeNull()
    expect(parseRoute('/moment/41/nonsense', '').moment).toBeNull()
  })

  it('defaults to the live town at the root path', () => {
    expect(parseRoute('/', '')).toEqual({
      moment: null,
      momentId: null,
      agentId: null,
      broadcast: false,
    })
  })

  // The canvas picks a figure by writing `?agent=` and firing popstate, and the lens words the
  // old chrome wrote beside it are not a route any more.
  it('ignores every parameter but the person and the stream flag', () => {
    expect(parseRoute('/', '?lens=inspector&open=amara&agent=amara')).toEqual({
      moment: null,
      momentId: null,
      agentId: 'amara',
      broadcast: false,
    })
  })

  it('parses /moment/:id — the recorded day a link names', () => {
    expect(parseRoute('/moment/12', '').momentId).toBe(12)
    expect(parseRoute('/moment/12', '').moment).toBeNull()
    // the day/time form is not an id, and neither is a word or a zero
    expect(parseRoute('/moment/41/14:30', '').momentId).toBeNull()
    expect(parseRoute('/moment/nonsense', '').momentId).toBeNull()
    expect(parseRoute('/moment/0', '').momentId).toBeNull()
  })

  it('writes the open recorded day rather than the minute inside it', () => {
    const r = parseRoute('/moment/12', '')
    expect(routeToPath({ ...r, moment: { day: 3, time: '06:00' } })).toBe('/moment/12')
    expect(routeToPath({ ...r, momentId: null, moment: { day: 3, time: '06:00' } })).toBe(
      '/moment/3/06:00',
    )
  })

  // The share card's own address (ruling 18). A human following it must land on the person,
  // which starts with the router reading them out of the path.
  it('parses /agent/:id — the person a share card is pasted from', () => {
    expect(parseRoute('/agent/amara', '')).toEqual({
      moment: null,
      momentId: null,
      agentId: 'amara',
      broadcast: false,
    })
    expect(parseRoute('/agent/a%20b', '').agentId).toBe('a b')
  })

  it('takes an address that is not a person as the town, and says nothing about it', () => {
    for (const path of ['/agent', '/agent/', '/agent/a/b', '/agents/amara'])
      expect(parseRoute(path, '').agentId, path).toBeNull()
    // An id the town does not have still parses: the App answers for it, the router does not.
    expect(parseRoute('/agent/__proto__', '').agentId).toBe('__proto__')
  })

  it('writes a picked person as the path, and only where no minute outranks them', () => {
    const r = parseRoute('/agent/amara', '')
    expect(routeToPath(r)).toBe('/agent/amara')
    expect(routeToPath({ ...r, agentId: 'a b' })).toBe('/agent/a%20b')
    expect(routeToPath({ ...r, moment: { day: 3, time: '06:00' } })).toBe(
      '/moment/3/06:00?agent=amara',
    )
    expect(routeToPath({ ...r, momentId: 12 })).toBe('/moment/12?agent=amara')
  })

  it('a broadcast address carries no picked person', () => {
    const r = parseRoute('/', '?broadcast=1&agent=amara')
    expect(r.broadcast).toBe(true)
    expect(r.agentId).toBeNull()
  })

  it('routeToPath round-trips', () => {
    const routes: Route[] = [
      { moment: null, momentId: null, agentId: null, broadcast: false },
      { moment: { day: 41, time: '14:30' }, momentId: null, agentId: 'farmer', broadcast: false },
      { moment: { day: 0, time: '00:05' }, momentId: null, agentId: null, broadcast: false },
      { moment: null, momentId: null, agentId: 'fisher', broadcast: false },
      { moment: { day: 41, time: '14:30' }, momentId: null, agentId: 'a b', broadcast: false },
      { moment: null, momentId: null, agentId: null, broadcast: true },
      { moment: null, momentId: 12, agentId: null, broadcast: false },
      { moment: null, momentId: 3, agentId: null, broadcast: true },
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

describe('the tab’s own name for where the viewer is', () => {
  const at = (over: Partial<Route> = {}): Route => ({
    moment: null,
    momentId: null,
    agentId: null,
    broadcast: false,
    ...over,
  })

  it('★ renames the tab when the address moves — a scrub used to leave it on the town', () => {
    expect(titleFor(at(), null)).toBe(TOWN_TITLE)
    expect(titleFor(at({ agentId: 'amara' }), 'Amara')).toBe('Amara — San Junipero')
    expect(titleFor(at({ moment: { day: 4, time: '19:31' } }), null)).toBe('Day 4 — San Junipero')
    expect(titleFor(at({ momentId: 7 }), null)).toBe('A recorded day — San Junipero')
  })

  it('★ never shows an id: a person the world cannot name is just the town', () => {
    expect(titleFor(at({ agentId: 'amara' }), null)).toBe(TOWN_TITLE)
  })
})
