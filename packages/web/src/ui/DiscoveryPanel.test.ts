import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssetRecord, DiscoveryRecord } from '@sj/shared'
import { DiscoveryRecordView } from './DiscoveryPanel.js'
import { leavesOf } from './discoveryModel.js'
import { A, D } from './discoveryModel.test.js'
import { contrast, ruleBody, tokens } from './contrast.test.js'
import { GAMIFICATION_BAN } from './townStats.js'

const EMOJI = /\p{Extended_Pictographic}/u

const renderPanel = (
  rows: readonly DiscoveryRecord[], assets: readonly AssetRecord[] = [],
): string => renderToStaticMarkup(createElement(DiscoveryRecordView, {
  leaves: leavesOf(rows, assets), throughTick: 59_040, viewTick: null, onJump: () => {},
}))

describe('the Discovery Record reads', () => {
  it('answers all four questions on the face of one leaf', () => {
    const html = renderPanel([D()])
    expect(html).toContain('Maret')                              // who
    expect(html).toContain('Day 12')                             // when
    expect(html).toContain('carry water in a stitched hide')     // from what — the quote
    expect(html).toContain('waterskin')                          // what it unlocked
    expect(html).toContain('stitch a waterskin')                 // the town's name for it
  })

  it('quotes the mind’s own words HERE and only here', () => {
    expect(renderPanel([D()])).toContain('i want to carry water in a stitched hide')
  })

  it('says what a discovery unlocked, and says nothing when it unlocked no thing', () => {
    expect(renderPanel([D()])).toContain('anyone could make waterskin')
    expect(renderPanel([D({ kind: 'word', name: 'dance', makes: [] })]))
      .not.toContain('anyone could make')
  })

  it('speaks a kind as PROSE, never as the engine’s slug', () => {
    const html = renderPanel([D({ makes: ['cord', 'reed_bundle'] })])
    expect(html).toContain('anyone could make cord, reed bundle')
    expect(html).not.toContain('reed_bundle')
  })

  it('holds the whole run in one line at the top', () => {
    expect(renderPanel([D(), D({ seq: 2, byId: 'a2', by: 'Sena' })]))
      .toContain('In 41 days, two people worked out 2 things.')
  })

  it('says the empty state in words, not with a blank panel', () => {
    const html = renderPanel([])
    expect(html).toContain('The town has not worked anything out yet.')
    expect(html).not.toContain('<ol')
  })

  it('is reachable by keyboard: every leaf is a button with an accessible name', () => {
    const html = renderPanel([D()])
    expect(html).toMatch(/<button[^>]+class="[^"]*discovery-leaf/)
    expect(html).toMatch(/aria-label="[^"]*Maret[^"]*"/)
    expect(html).toContain('aria-label="Maret worked out stitch a waterskin, Day 12, 00:00. Go to this moment."')
  })

  it('grows one leaf per discovery, in the archive’s order', () => {
    const html = renderPanel([D(), D({ seq: 2, tick: 20_000, name: 'dance', kind: 'word', makes: [] })])
    expect(html.match(/class="discovery-leaf"/g)).toHaveLength(2)
    expect(html.indexOf('stitch a waterskin')).toBeLessThan(html.indexOf('dance'))
  })

  it('marks the art decorative — the label beside it already says what it is', () => {
    expect(renderPanel([D()], [A('waterskin')])).toMatch(/<img[^>]+alt=""/)
    expect(renderPanel([D()], [A('waterskin')])).toContain('/assets/asset_waterskin.png')
  })

  it('reads without art — a discovery is never blocked on the forge', () => {
    const html = renderPanel([D()])
    expect(html).not.toContain('<img')
    expect(html).toContain('discovery-art-none')
    expect(html).toContain('stitch a waterskin')
  })

  it('never speaks in machine words, and never draws an emoji', () => {
    const html = renderPanel([D(), D({ seq: 2, kind: 'word', name: 'dance', makes: [] })])
    const text = html.replace(/<[^>]+>/g, ' ')
    expect(text).not.toMatch(GAMIFICATION_BAN)
    expect(text).not.toMatch(/\b(ai|llm|model|prompt|token|recipe|verb|agent)\b/i)
    expect(html).not.toMatch(EMOJI)
  })
})

describe('the Discovery Record clears AA in both bands', () => {
  const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const T = tokens(CSS)
  const AA = 4.5

  const colourOf = (sel: string): string => {
    const name = /color:\s*var\(--([\w-]+)\)/.exec(ruleBody(CSS, sel))?.[1]
    expect(name, `${sel} paints no palette token`).toBeDefined()
    return T[name!]!
  }

  it('paints its body text on parchment in a token that clears AA', () => {
    expect(contrast(colourOf('.discovery-leaf p'), T['parchment']!)).toBeGreaterThanOrEqual(AA)
  })

  it('paints the leaf’s own grounds — heading and credit — clear of AA on cream', () => {
    for (const sel of ['.discovery-leaf h3', '.discovery-credit', '.discovery-makes']) {
      expect(contrast(colourOf(sel), T['cream']!), sel).toBeGreaterThanOrEqual(AA)
    }
    expect(contrast(colourOf('.discovery-summary'), T['parchment']!)).toBeGreaterThanOrEqual(AA)
  })

  it('paints the quote block’s text on deep in a token that clears AA', () => {
    expect(contrast(colourOf('.discovery-quote'), T['deep']!)).toBeGreaterThanOrEqual(AA)
  })

  it('NO token it uses clears AA on BOTH grounds — per-band is not optional here', () => {
    // The dual-band set is empty. This row exists so a later editor who "simplifies" the two
    // bands down to one colour is told, in a failing test, why that cannot work.
    const light = colourOf('.discovery-leaf h3')
    const dark = colourOf('.discovery-quote')
    expect(contrast(light, T['deep']!)).toBeLessThan(AA)
    expect(contrast(dark, T['cream']!)).toBeLessThan(AA)
  })

  it('draws the chain rule in something a viewer can actually see', () => {
    // A line is structure, held to the same 3:1 the mark glyphs are: --sand on --parchment is
    // 1.19:1.
    const name = /border-left:[^;]*var\(--([\w-]+)\)/.exec(ruleBody(CSS, '.discovery-chain'))?.[1]
    expect(name, 'the chain has no rule').toBeDefined()
    expect(contrast(T[name!]!, T['parchment']!)).toBeGreaterThanOrEqual(3)
  })

  it('NEVER thins a reading surface with opacity', () => {
    for (const sel of ['.discovery-leaf p', '.discovery-quote', '.discovery-leaf h3',
      '.discovery-summary', '.discovery-record']) {
      expect(ruleBody(CSS, sel), sel).not.toMatch(/opacity:/)
    }
  })

  it('holds the type floors and the hit target', () => {
    expect(ruleBody(CSS, '.discovery-quote')).toMatch(/font-size:\s*1[2-9]px/)
    expect(ruleBody(CSS, '.discovery-leaf p')).toMatch(/font-size:\s*1[2-9]px/)
    expect(ruleBody(CSS, '.discovery-leaf h3')).toMatch(/font-size:\s*1[4-9]px/)
    expect(ruleBody(CSS, '.discovery-leaf')).toMatch(/min-height:\s*(2[4-9]|[3-9]\d|\d{3})px/)
  })

  it('keeps its motion inside the band and honours a viewer who asked for none', () => {
    expect(ruleBody(CSS, '.discovery-leaf')).toMatch(/var\(--t-(fast|move|med|slow)\)/)
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]*discovery-leaf/)
  })
})
