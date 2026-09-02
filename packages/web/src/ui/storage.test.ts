import { describe, expect, it } from 'vitest'
import { localStore, sessionStore } from './storage.js'
import { adminToken } from './lawsModel.js'
import { keyOpensBy, rememberKey } from './relationGraph.js'
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
    expect(keyOpensBy(null)).toBe(true)
    expect(thoughtsSetting(null)).toBe('shown')
    expect(() => {
      rememberKey(null, false)
    }).not.toThrow()
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
