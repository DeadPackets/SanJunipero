import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionStore } from './storage.js'
import { adminToken } from './lawsModel.js'
import { keyOpensBy, rememberKey } from './relationGraph.js'

describe('★ site data blocked', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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
    expect(() => {
      rememberKey(null, false)
    }).not.toThrow()
  })
})
