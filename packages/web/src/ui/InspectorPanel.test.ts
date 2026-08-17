import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BackToRoster } from './InspectorPanel.js'

const EMOJI = /\p{Extended_Pictographic}/u

// USER BUG 2026-08-17: "there is no way to go back to the selection of townsfolk after
// picking one character to follow." This is the visible route back; the TOWNSFOLK nav item
// and Escape are the other two, both tested as reducer transitions in route.test.ts.
describe('BackToRoster', () => {
  const html = renderToStaticMarkup(createElement(BackToRoster, { onBack: () => {} }))

  it('is a real button a keyboard can reach', () => {
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
  })

  it("says where it goes, in the town's own words", () => {
    expect(html).toContain('All townsfolk')
  })

  it('keeps the arrow out of the accessibility tree — the words carry the meaning', () => {
    expect(html).toContain('aria-hidden="true"')
  })

  it('is drawn, never typed as an emoji', () => {
    expect(html).not.toMatch(EMOJI)
  })
})
