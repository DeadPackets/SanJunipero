import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Day 0 of r32 showed the Bonds page as a key and nothing else: a page about people that named
// nobody. The words-first list says so in words when there is nobody to list.
describe('★ a bonds page with no ties still names the fact', () => {
  it('says everyone is a stranger yet instead of showing a bare key', () => {
    const src = readFileSync(new URL('./BondsGraph.tsx', import.meta.url), 'utf8')
    expect(src).toContain('Nobody is more than a stranger to anybody yet. Give it a day.')
    expect(src).toContain('api !== null && <p className="feed-empty">{STRANGERS_STILL}</p>')
  })
})
