import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { RING_LABEL, RING_VERBS, SubjectRing, armFor } from './SubjectRing.js'
import type { Subject } from './anchor.js'

const AMARA: Subject = { id: 'a1', kind: 'agent', name: 'Amara' }

const markup = (subject: Subject | null): string =>
  renderToStaticMarkup(
    createElement(SubjectRing, {
      subject,
      scene: null,
      onVerb: () => {
        /* the caller's job */
      },
    }),
  )

// ★ The arms stand at 12, 3, 6 and 9 o'clock. Stepping round a flat list put ArrowDown from
// the top arm on the RIGHT one, which is not where the viewer is pointing.
describe('★ the arrows point at an arm, they do not step round a list', () => {
  const CSS = readFileSync(new URL('../ui/chrome.css', import.meta.url), 'utf8')

  it('★ names the arm the key points at, whichever arm the focus is on', () => {
    expect(armFor('ArrowUp')).toBe(0)
    expect(armFor('ArrowRight')).toBe(1)
    expect(armFor('ArrowDown')).toBe(2)
    expect(armFor('ArrowLeft')).toBe(3)
  })

  it('★ points at the arm the sheet actually draws there', () => {
    const at = (n: number): string =>
      new RegExp(`\\.stage-ring-arms button:nth-child\\(${n}\\) \\{([^}]*)\\}`).exec(CSS)![1]!
    expect(at(armFor('ArrowUp')! + 1), 'up').toContain('top: 0')
    expect(at(armFor('ArrowRight')! + 1), 'right').toContain('left: 100%')
    expect(at(armFor('ArrowDown')! + 1), 'down').toContain('top: 100%')
    expect(at(armFor('ArrowLeft')! + 1), 'left').toContain('left: 0')
  })

  it('keeps Home and End on the first and last arm', () => {
    expect(armFor('Home')).toBe(0)
    expect(armFor('End')).toBe(RING_VERBS.length - 1)
  })

  it('leaves every other key to whoever else wants it', () => {
    for (const key of ['Enter', ' ', 'Escape', 'a', 'Tab', '+', '-']) {
      expect(armFor(key), key).toBeNull()
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
