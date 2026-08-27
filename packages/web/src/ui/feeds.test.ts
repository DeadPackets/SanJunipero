import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BONDS_REFETCH_MS } from './feeds.js'

const DIR = new URL('.', import.meta.url)
const panels = readdirSync(DIR).filter((f) => f.endsWith('.tsx'))

describe('one feed per endpoint', () => {
  // /api/bonds carries a Bond's whole history: two panels polling it on two clocks was one
  // dataset downloaded twice a minute per viewer, and a count badge that could disagree with
  // the graph beside it.
  it('★ no panel fetches the shared endpoints for itself', () => {
    for (const file of panels) {
      const src = readFileSync(new URL(file, DIR), 'utf8')
      for (const url of ['/api/bonds', '/api/lineage']) {
        expect(src, `${file} must read ${url} through feeds.ts`).not.toContain(`fetch('${url}')`)
      }
    }
  })

  it('★ the panels that show the ties read the ONE feed', () => {
    for (const file of ['SocietyLens.tsx', 'RosterPanel.tsx']) {
      const src = readFileSync(new URL(file, DIR), 'utf8')
      expect(src, `${file} must subscribe to bondsFeed`).toContain('useFeed(bondsFeed)')
      expect(src, `${file} must subscribe to lineageFeed`).toContain('useFeed(lineageFeed)')
    }
  })

  it('keeps the measured beat', () => {
    expect(BONDS_REFETCH_MS).toBe(30_000)
  })
})
