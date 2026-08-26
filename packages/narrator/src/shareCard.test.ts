import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import { renderShareCard } from './shareCard.js'
import { FORBIDDEN_FRAMING } from '@sj/shared'

describe('renderShareCard', () => {
  const svg = renderShareCard({
    day: 3,
    title: 'The First Trade',
    subtitle: 'Omar gives Yusuf a pot.',
    heat: 7.5,
  })

  it('renders a self-contained 1080x565 SVG with day, title, subtitle', () => {
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('width="1080"')
    expect(svg).toContain('height="565"')
    expect(svg).toContain('The First Trade')
    expect(svg).toContain('Day 3')
    expect(svg).toContain('Omar gives Yusuf a pot.')
    expect(svg).toContain('San Junipero')
  })

  it('draws a heat bar proportional to heat/10, clamped', () => {
    expect(svg).toContain('width="450"') // 0.75 * 600
    const cold = renderShareCard({ day: 1, title: 't', subtitle: 's', heat: -2 })
    expect(cold).toContain('width="0"')
    const scorching = renderShareCard({ day: 1, title: 't', subtitle: 's', heat: 25 })
    expect(scorching).toContain('width="600"')
  })

  it('is framing-free, deterministic, and escapes markup in inputs', () => {
    expect(FORBIDDEN_FRAMING.test(svg)).toBe(false)
    expect(
      renderShareCard({
        day: 3,
        title: 'The First Trade',
        subtitle: 'Omar gives Yusuf a pot.',
        heat: 7.5,
      }),
    ).toBe(svg)
    const sneaky = renderShareCard({ day: 1, title: '<script>"x"&', subtitle: 's', heat: 1 })
    expect(sneaky).not.toContain('<script>')
    expect(sneaky).toContain('&lt;script&gt;')
  })

  it('round-trips as a share_card publication', () => {
    const db = new Database(':memory:')
    migrateNarratorTables(db)
    const store = new NarratorStore(db)
    store.insertPublication({
      day: 3,
      kind: 'share_card',
      title: 'The First Trade',
      body: svg,
      citations: null,
    })
    const rows = store.publications('share_card')
    expect(rows.length).toBe(1)
    expect(rows[0]!.body).toBe(svg)
    expect(rows[0]!.citations).toBeNull()
  })
})
