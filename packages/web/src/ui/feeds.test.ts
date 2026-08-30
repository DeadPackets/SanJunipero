import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BONDS_REFETCH_MS } from './feeds.js'

const PAGES = new URL('../paper/pages/', import.meta.url)
const pages = readdirSync(PAGES).filter((f) => f.endsWith('.tsx'))

describe('one feed per endpoint', () => {
  // /api/bonds carries a Bond's whole history: two panels polling it on two clocks downloaded
  // one dataset twice a minute per viewer, and two counts that could disagree with each other.
  it('★ no page fetches the shared endpoints for itself', () => {
    for (const file of pages) {
      const src = readFileSync(new URL(file, PAGES), 'utf8')
      for (const url of ['/api/bonds', '/api/lineage']) {
        expect(src, `${file} must read ${url} through feeds.ts`).not.toContain(`fetch('${url}')`)
      }
    }
  })

  it('★ the pages that show the ties read the ONE feed', () => {
    for (const file of ['BondsGraph.tsx', 'Folk.tsx']) {
      const src = readFileSync(new URL(file, PAGES), 'utf8')
      expect(src, `${file} must subscribe to bondsFeed`).toContain('useFeed(bondsFeed)')
      expect(src, `${file} must subscribe to lineageFeed`).toContain('useFeed(lineageFeed)')
    }
  })

  it('keeps the measured beat', () => {
    expect(BONDS_REFETCH_MS).toBe(30_000)
  })
})
