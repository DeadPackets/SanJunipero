import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ★ THE STRUCTURAL GUARD ON chrome.css. Every UI lane appends a block to this sheet and every
// merge train has resolved it by hand, counting braces in a terminal. A union merge that drops
// one side's block is invisible to tsc and to every other test in the suite — the remaining CSS
// still parses, still builds, and the surface it styled just stops being styled. Merge train 1
// caught a real off-by-one that way and asked for this file: it turns the integrator's
// arithmetic into something `pnpm test` does.

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'chrome.css'), 'utf8')
const LINES = CSS.split('\n')

/** A section banner opens every block in the sheet. Read off the file rather than transcribed,
 *  so the guard covers sections nobody thought to list. */
const BANNERS = LINES.filter((l) => /^\/\* [──══]/u.test(l))

/** The two blocks a merge train actually risks, named so a failure says whose block went. */
const LANE_BLOCKS: ReadonlyArray<readonly [lane: string, banner: string]> = [
  ['the Discovery Record', '/* ── the Discovery Record: a chain of museum labels'],
  ['THE LITTLE MAP', '/* ══ ★ THE LITTLE MAP ═'],
]

describe('★ chrome.css survives the merge trains intact', () => {
  it('opens each section exactly once', () => {
    const seen = new Map<string, number>()
    for (const b of BANNERS) seen.set(b, (seen.get(b) ?? 0) + 1)
    expect([...seen].filter(([, n]) => n > 1), 'a section banner appears twice').toEqual([])
  })

  // 22 base + 1 the Discovery Record + 1 the little map. A dropped block takes its banner with
  // it, so this is the number that notices; a lane adding one must say so here.
  it('has the 24 sections the trains left it with', () => {
    expect(BANNERS).toHaveLength(24)
  })

  it('carries each lane’s own block exactly once', () => {
    for (const [lane, banner] of LANE_BLOCKS) {
      expect(CSS.split(banner).length - 1, `${lane}: block missing or duplicated`).toBe(1)
    }
  })

  // 167 base + 5 the Discovery Record + 2 the little map — merge train 1's hand count. Half a
  // block surviving a union merge keeps its banner and still balances its braces; only the rule
  // count sees it.
  it('has the 174 top-level rules the trains counted', () => {
    expect(LINES.filter((l) => l.startsWith('}'))).toHaveLength(174)
  })

  it('is brace-balanced and carries no conflict marker', () => {
    expect(CSS.match(/{/g) ?? []).toHaveLength((CSS.match(/}/g) ?? []).length)
    expect(LINES.filter((l) => /^(<{7}|={7}|>{7}|\|{7})/.test(l)), 'conflict marker in the sheet')
      .toHaveLength(0)
  })
})
