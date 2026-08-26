import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LENSES } from './route.js'
import { GAMIFICATION_BAN } from './townStats.js'
import { ControlBar } from './ControlBarView.js'
import { CONTROL_BAR_H, controlItems, type ControlCtx } from './controlBar.js'

const EMOJI = /\p{Extended_Pictographic}/u

const render = (over: Partial<ControlCtx> = {}): string => {
  const ctx: ControlCtx = {
    lens: 'map',
    live: true,
    zoom: 1,
    following: null,
    insideId: null,
    hudHidden: false,
    townFits: true,
    ...over,
  }
  return renderToStaticMarkup(
    createElement(ControlBar, { items: controlItems(ctx), onAction: () => {} }),
  )
}

describe('ControlBar — one button per control, all of them spoken', () => {
  const html = render()
  const buttons = html.match(/<button/g) ?? []

  it('renders one button per item, every one with a spoken label', () => {
    expect(buttons.length).toBe(
      controlItems({
        lens: 'map',
        live: true,
        zoom: 1,
        following: null,
        insideId: null,
        hudHidden: false,
        townFits: true,
      }).length,
    )
    for (const item of controlItems({
      lens: 'map',
      live: true,
      zoom: 1,
      following: null,
      insideId: null,
      hudHidden: false,
      townFits: true,
    })) {
      expect(html, item.id).toContain(`aria-label="${item.label}"`)
    }
  })

  it('is a toolbar with ONE tab stop, walked with the arrow keys', () => {
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-orientation="horizontal"')
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(buttons.length - 1)
  })

  it('puts aria-pressed on exactly the toggles, and nowhere else', () => {
    const items = controlItems({
      lens: 'map',
      live: true,
      zoom: 1,
      following: null,
      insideId: null,
      hudHidden: false,
      townFits: true,
    })
    const toggles = items.filter((i) => i.state !== undefined).length
    expect((html.match(/aria-pressed=/g) ?? []).length).toBe(toggles)
    expect(toggles).toBeGreaterThan(0)
    expect(toggles).toBeLessThan(items.length)
  })

  it('carries every group, in the order the contract names them', () => {
    for (const g of ['time', 'camera', 'lens', 'view']) expect(html).toContain(`data-group="${g}"`)
    const order = ['time', 'camera', 'lens', 'view'].map((g) => html.indexOf(`data-group="${g}"`))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('is DRAWN — svg pixels, and no emoji anywhere in the markup', () => {
    expect(html).toContain('<svg')
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).not.toMatch(EMOJI)
  })

  it('carries no gamification vocabulary', () => {
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(GAMIFICATION_BAN)
  })

  it('reaches every lens without leaving the bar', () => {
    for (const lens of LENSES) expect(html).toContain(`data-ctl="lens-${lens}"`)
  })
})

describe('ControlBar — an honest refusal', () => {
  it('disables what it cannot do and shows the reason rather than implying it', () => {
    const wide = render({ zoom: 0.25 })
    expect(wide).toContain('data-ctl="zoom-out"')
    expect(wide).toMatch(/data-ctl="zoom-out"[^>]*disabled/)
    expect(wide).toContain('This is as wide as the camera goes.')
    expect(wide).toMatch(/aria-description="This is as wide/)
  })

  it('a disabled control is never the tab stop', () => {
    const wide = render({ zoom: 0.25 })
    const stop = /data-ctl="([^"]+)"(?:(?!<button)[\s\S])*?tabindex="0"/.exec(wide)
    expect(stop?.[1]).not.toBe('zoom-out')
    expect((wide.match(/tabindex="0"/g) ?? []).length).toBe(1)
  })

  it('grows and shrinks with what the viewer can currently do', () => {
    const plain = (render().match(/<button/g) ?? []).length
    const inside = (render({ insideId: 'house1', following: 'amara' }).match(/<button/g) ?? [])
      .length
    expect(inside).toBe(plain + 2)
  })

  it('the bar clears the touch-target floor', () => {
    expect(CONTROL_BAR_H).toBeGreaterThanOrEqual(44)
  })
})
