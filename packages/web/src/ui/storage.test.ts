import { describe, expect, it, vi } from 'vitest'
import { localStore, sessionStore } from './storage.js'
import { adminToken } from './lawsModel.js'
import { thoughtsSetting } from './thoughts.js'

describe('★ site data blocked', () => {
  it('★ hands back nothing instead of throwing out of the first render', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    expect(sessionStore()).toBeNull()
    // @ts-expect-error -- putting the real getter back is the whole point of the stub
    delete globalThis.sessionStorage
  })

  it('★ every reader of it takes the nothing', () => {
    expect(adminToken(null)).toBeNull()
    expect(thoughtsSetting(null)).toBe('shown')
  })

  it('★ the same guard for the preference that outlives the tab', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    expect(localStore()).toBeNull()
    // @ts-expect-error -- putting the real getter back is the whole point of the stub
    delete globalThis.localStorage
  })
})

it('holds the visit-start cursor while later snapshots update the next visit atomically', async () => {
  vi.resetModules()
  const saved = new Map<string, string>([
    ['sj:lastVisit', JSON.stringify({ runId: 'town-a', seq: 5, tick: 10 })],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  })
  try {
    const storage = await import('./storage.js')
    storage.rememberVisit({ runId: 'town-a', seq: 50, tick: 20 })
    expect(storage.lastVisitCursor()).toEqual({ runId: 'town-a', seq: 5, tick: 10 })
    expect(storage.readVisitCursor()).toEqual({ runId: 'town-a', seq: 50, tick: 20 })
    expect(storage.lastVisitTick('town-a')).toBe(10)
    expect(storage.lastVisitTick('town-b')).toBeNull()
    expect(storage.lastVisitTick(null)).toBeNull()
    storage.rememberVisit({ runId: null, seq: 100, tick: 30 })
    expect(storage.readVisitCursor()).toEqual({ runId: null, seq: null, tick: null })
  } finally {
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})
