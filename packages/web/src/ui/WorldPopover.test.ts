import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { roomCard, type Provenance } from './interiorModel.js'
import { WorldPopover, provenanceLines } from './WorldPopover.js'

const STATE = {
  agents: { yusuf: { id: 'yusuf', name: 'Yusuf', asleep: false, activity: null } },
  structures: {
    'house-1': { id: 'house-1', kind: 'house', x: 2, y: 2, w: 2, h: 2, stage: 'complete' },
  },
  items: {},
  crops: {},
} as unknown as WorldState

const store = { getState: () => STATE } as unknown as WorldStore

const RISING: Provenance = {
  id: 'house-1',
  kind: 'house',
  plannedTick: 3 * 1440 + 360,
  builderId: 'yusuf',
  completedTick: null,
}

const markup = (pick: Parameters<typeof WorldPopover>[0]['pick']): string =>
  renderToStaticMarkup(createElement(WorldPopover, { store, pick }))

describe('the map and the room card say the same sentence about a building', () => {
  it('★ prints the ONE builder both surfaces read, not a second phrasing of it', () => {
    const card = roomCard(STATE, 'house-1', [], RISING)
    expect(card?.built).toBe('Begun by Yusuf, Day 3 — still rising')
    expect(provenanceLines(store, RISING, [])).toBe(card?.built)
  })

  it('adds the builder’s nearest journal line under it, and nothing when there is none', () => {
    const journal = [
      { tick: RISING.plannedTick + 5000, text: 'far' },
      { tick: RISING.plannedTick + 10, text: 'near' },
    ]
    expect(provenanceLines(store, RISING, journal)).toBe(
      'Begun by Yusuf, Day 3 — still rising\n"near"',
    )
    expect(provenanceLines(store, RISING, [])).not.toContain('"')
  })

  it('says so plainly when nobody recorded a beginning', () => {
    expect(provenanceLines(store, null, [])).toBe('No one remembers who began this.')
  })
})

describe('the popover is one live region, mounted for the life of the app', () => {
  it('★ is in the tree with nothing picked, so an announcement can actually fire', () => {
    const html = markup(null)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('display:none')
  })

  it('shows at the picked point, and never swallows a pointer', () => {
    const html = markup({ kind: 'item', id: 'nothing', screenX: 40.4, screenY: 90.6 })
    // an id the world does not carry has no detail, so the region stays silent
    expect(html).toContain('display:none')
    expect(readFileSync(new URL('./chrome.css', import.meta.url), 'utf8')).toMatch(
      /\.provenance-pop\s*\{[^}]*pointer-events:\s*none/,
    )
  })

  it('★ all three map surfaces reach it — structure, item and crop', () => {
    const src = readFileSync(new URL('../render/entities.ts', import.meta.url), 'utf8')
    for (const kind of ['structure', 'item', 'crop']) {
      expect(src, `${kind} does not emit a pick`).toContain(`sync.onPick?.({ kind: '${kind}'`)
    }
  })

  it('★ the Pixi layer builds no DOM of its own any more', () => {
    const src = readFileSync(new URL('../render/entities.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('document.createElement')
    expect(src).not.toContain('document.addEventListener')
  })
})
