import { afterEach, describe, expect, it, vi } from 'vitest'
import { intEnv } from './worldEnv.js'

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
