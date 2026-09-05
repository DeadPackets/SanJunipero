import { afterEach, describe, expect, it, vi } from 'vitest'
import { intEnv, parseWorldEnv } from './worldEnv.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

// ★ `Number('') === 0`, so a key left in `.env` with nothing after the `=` used to read as a
// number the operator never typed — an unlit town, or a ceiling deleted.
describe('★ a knob with nothing after the = is unset, never zero', () => {
  it('falls back and says so, where a bare value would have passed as 0', () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      vi.stubEnv('SJ_LAMPS', '')
      expect(intEnv('SJ_LAMPS', 8, 0)).toBe(8)
      expect(said.mock.calls.map((c) => String(c[0])).join('\n')).toContain('SJ_LAMPS')
    } finally {
      said.mockRestore()
    }
  })

  it('still reads a number that is there, and an unset knob stays quiet', () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      vi.stubEnv('SJ_LAMPS', '3')
      expect(intEnv('SJ_LAMPS', 8, 0)).toBe(3)
      vi.stubEnv('SJ_LAMPS', undefined)
      expect(intEnv('SJ_LAMPS', 8, 0)).toBe(8)
      expect(said).not.toHaveBeenCalled()
    } finally {
      said.mockRestore()
    }
  })
})

// ★ Every value but the literal '0' read as ON, silently — so an operator who wrote `false`,
// `off` or `no` got the opposite of what they asked for and no line anywhere said so.
describe('★ a switch means what an operator wrote, or says it was ignored', () => {
  it('turns a knob off for every word that means off', () => {
    for (const off of ['0', 'false', 'FALSE', 'off', 'no', ' 0 ']) {
      vi.stubEnv('SJ_INTERIORS', off)
      expect(parseWorldEnv().interiors, off).toBe(false)
    }
  })

  it('turns a knob on for every word that means on', () => {
    for (const on of ['1', 'true', 'ON', 'yes']) {
      vi.stubEnv('SJ_JOINT', on)
      expect(parseWorldEnv().jointBuild, on).toBe(true)
    }
  })

  it('keeps the default and says so for a word that means neither', () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      vi.stubEnv('SJ_BRIDGE', 'maybe')
      expect(parseWorldEnv().bridge).toBe(true)
      expect(said.mock.calls.map((c) => String(c[0])).join('\n')).toContain('SJ_BRIDGE=maybe')
    } finally {
      said.mockRestore()
    }
  })
})
