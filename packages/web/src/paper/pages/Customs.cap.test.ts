import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The customs endpoint lists oldest first and never stops growing; the page shows the newest
// dozen and says how many more there are, so a month-old town still opens on this week.
describe('★ the customs page shows the newest dozen', () => {
  const src = readFileSync(new URL('./Customs.tsx', import.meta.url), 'utf8')
  it('takes the last twelve, newest first', () => {
    expect(src).toContain('const CUSTOMS_SHOWN = 12')
    expect(src).toContain('rows.slice(-CUSTOMS_SHOWN).reverse()')
  })
  it('counts the rest in plain words', () => {
    expect(src).toContain('And {rows.length - CUSTOMS_SHOWN} more from earlier days.')
  })
})
