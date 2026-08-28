import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RING_LABEL, RING_VERBS, SubjectRing, cycleVerb } from './SubjectRing.js'
import type { StageSubject } from './anchor.js'

const AMARA: StageSubject = { id: 'a1', kind: 'agent', name: 'Amara' }

const markup = (subject: StageSubject | null): string =>
  renderToStaticMarkup(
    createElement(SubjectRing, {
      subject,
      scene: null,
      onVerb: () => {
        /* the caller's job */
      },
    }),
  )

describe('the arrows walk the ring and it has no end', () => {
  it('moves forward on right and down, back on left and up', () => {
    expect(cycleVerb(0, 'ArrowRight')).toBe(1)
    expect(cycleVerb(0, 'ArrowDown')).toBe(1)
    expect(cycleVerb(1, 'ArrowLeft')).toBe(0)
    expect(cycleVerb(1, 'ArrowUp')).toBe(0)
  })

  it('wraps both ways — a ring has no first arm and no last', () => {
    expect(cycleVerb(RING_VERBS.length - 1, 'ArrowRight')).toBe(0)
    expect(cycleVerb(0, 'ArrowLeft')).toBe(RING_VERBS.length - 1)
  })

  it('jumps to the ends on Home and End', () => {
    expect(cycleVerb(2, 'Home')).toBe(0)
    expect(cycleVerb(0, 'End')).toBe(RING_VERBS.length - 1)
  })

  it('leaves every other key to whoever else wants it', () => {
    for (const key of ['Enter', ' ', 'Escape', 'a', 'Tab', '+', '-']) {
      expect(cycleVerb(0, key), key).toBeNull()
    }
  })
})

describe('the ring is four things to ask, reachable by keyboard', () => {
  it('is a menu named after the person it stands around', () => {
    const html = markup(AMARA)
    expect(html).toContain('role="menu"')
    expect(html).toContain('aria-label="Amara"')
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(RING_VERBS.length)
  })

  it('names every verb in the town’s own words', () => {
    const html = markup(AMARA)
    for (const v of RING_VERBS) expect(html, v).toContain(`>${RING_LABEL[v]}<`)
  })

  it('keeps ONE tab stop, so Tab leaves the ring rather than walking it', () => {
    const html = markup(AMARA)
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(RING_VERBS.length - 1)
  })

  it('draws nothing at all with nobody asked about', () => {
    expect(markup(null)).toBe('')
  })
})
