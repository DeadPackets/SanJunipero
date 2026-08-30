import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOGGLABLE_PATHS } from '@sj/engine/laws'
import { DEFAULT_CONFIG } from '@sj/shared'
import { LAW_COPY, LAW_GROUPS, lawCopyFor, lawGroupOf } from './lawCopy.js'
import { GAMIFICATION_BAN } from './townStats.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
const PATHS = Object.keys(TOGGLABLE_PATHS)

const ruleBody = (selector: string): string => {
  const hits: string[] = []
  for (const [, sel, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((sel ?? '').split(',').some((s) => s.trim() === selector)) hits.push(body ?? '')
  }
  if (hits.length === 0) throw new Error(`no rule for ${selector}`)
  return hits.join(';')
}

const valueAt = (path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], DEFAULT_CONFIG)

describe('U17 — a law is total over the engine, or a machine path reaches a screen', () => {
  it('has copy for every law the engine lets an operator touch', () => {
    expect(PATHS.length).toBeGreaterThan(10)
    expect(Object.keys(LAW_COPY).sort()).toEqual([...PATHS].sort())
  })

  it('answers for a path it knows and null for one it does not', () => {
    expect(lawCopyFor(PATHS[0]!)?.title).toBe(LAW_COPY[PATHS[0]!]!.title)
    expect(lawCopyFor('nonsense.path')).toBeNull()
  })
})

describe('U17 — said in words a viewer can read', () => {
  it('never prints a machine path, an identifier or a number in a title', () => {
    for (const [path, copy] of Object.entries(LAW_COPY)) {
      expect(copy.title, path).not.toMatch(/[a-z][A-Z]|\.|_|\d/)
      expect(copy.title.length, path).toBeGreaterThan(6)
    }
  })

  it('never prints a machine path, an identifier or a number in a sentence', () => {
    for (const [path, copy] of Object.entries(LAW_COPY)) {
      expect(copy.sentence, path).not.toMatch(/[a-z][A-Z]|_|\d/)
    }
  })

  it('says what the law does to people, in between four and twenty-five words', () => {
    for (const [path, copy] of Object.entries(LAW_COPY)) {
      const words = copy.sentence.trim().split(/\s+/)
      expect(words.length, `${path}: ${copy.sentence}`).toBeGreaterThanOrEqual(4)
      expect(words.length, `${path}: ${copy.sentence}`).toBeLessThanOrEqual(25)
      expect(copy.sentence, path).toMatch(/[.!]$/)
    }
  })

  it('never reads as a game', () => {
    for (const [path, copy] of Object.entries(LAW_COPY)) {
      expect(copy.title, path).not.toMatch(GAMIFICATION_BAN)
      expect(copy.sentence, path).not.toMatch(GAMIFICATION_BAN)
    }
  })

  it('gives no two laws the same title', () => {
    const titles = Object.values(LAW_COPY).map((c) => c.title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})

describe('audit M2 — the object-valued law renders as its own table, never as JSON', () => {
  it('turns how long food keeps into a row per food, with no braces anywhere', () => {
    const rows = LAW_COPY['spoilage.days']!.render(valueAt('spoilage.days'))
    expect(rows.length).toBeGreaterThan(3)
    for (const r of rows) {
      expect(r.label).not.toMatch(/[{}"[\]]/)
      expect(r.value).not.toMatch(/[{}"[\]]/)
      expect(r.label[0]).toBe(r.label[0]!.toUpperCase())
      expect(r.value).toMatch(/\bdays?\b/)
    }
    expect(rows.map((r) => r.label)).toContain('Fish')
  })

  it('renders the real value of every law without a brace, a quote or a machine word', () => {
    for (const path of PATHS) {
      const rows = LAW_COPY[path]!.render(valueAt(path))
      expect(rows.length, path).toBeGreaterThan(0)
      for (const r of rows) {
        expect(r.value, path).not.toMatch(/[{}"[\]]|undefined|NaN|_/)
        expect(r.value.length, path).toBeGreaterThan(0)
      }
    }
  })

  it('says so plainly when a law has no value to show', () => {
    for (const path of PATHS) {
      const rows = LAW_COPY[path]!.render(undefined)
      expect(rows.length, path).toBeGreaterThan(0)
      for (const r of rows) expect(r.value, path).not.toMatch(/undefined|null|NaN/)
    }
  })

  it('says a boolean as an answer, not as a switch position', () => {
    const rows = LAW_COPY['spoilage.enabled']!.render(true)
    expect(rows[0]!.value).toBe('yes')
    expect(LAW_COPY['spoilage.enabled']!.render(false)[0]!.value).toBe('no')
  })

  it('says a share in words where there is a word for it', () => {
    expect(LAW_COPY['seasons.winter.fishCatchMultiplier']!.render(0.5)[0]!.value).toContain('half')
    expect(LAW_COPY['spoilage.storehouseMultiplier']!.render(2)[0]!.value).toContain('twice')
  })

  it('carries a unit only where a bare number would be a riddle', () => {
    expect(LAW_COPY['reproduction.gestationDays']!.unit).toBe('days')
    expect(LAW_COPY['spoilage.enabled']!.unit).toBeNull()
  })
})

describe('four subjects, not an alphabetical dump', () => {
  it('puts every law in a group, and no group is a group of one', () => {
    const counts = new Map(LAW_GROUPS.map((g) => [g, 0]))
    for (const path of PATHS) {
      const g = lawGroupOf(path)
      expect(LAW_GROUPS, path).toContain(g)
      counts.set(g, counts.get(g)! + 1)
    }
    for (const g of LAW_GROUPS) expect(counts.get(g), g).toBeGreaterThanOrEqual(2)
  })

  it('puts a law it has never heard of somewhere rather than nowhere', () => {
    expect(LAW_GROUPS).toContain(lawGroupOf('brand.new.law'))
  })
})

describe('audit M2, at the source: nothing in the panel is wider than its column', () => {
  it('no longer breaks the label a character at a time', () => {
    expect(ruleBody('.law-path')).not.toMatch(/word-break:\s*break-all/)
  })

  it('lets the value column shrink instead of pushing the row wide', () => {
    const body = ruleBody('.law-value')
    expect(body).toMatch(/min-width:\s*0/)
    expect(body).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('holds the human title above the machine path, and both above the floor', () => {
    // --f-4 is 16px, --f-1 the 12px stamp floor
    expect(ruleBody('.law-title')).toMatch(/font-size:\s*var\(--f-4\)/)
    expect(ruleBody('.law-path')).toMatch(/font-size:\s*var\(--f-1\)/)
  })

  // Silkscreen has no lowercase, so the pixel face renders `aging.deathOfOldAgeEnabled` as one
  // unbroken run of capitals.
  it('sets the operator path in a face that has lowercase letters', () => {
    const body = ruleBody('.law-path')
    expect(body).toMatch(/font-family:\s*var\(--font-data\)/)
    expect(body).not.toMatch(/--font-px|--font-display|text-transform:\s*uppercase/)
  })
})
