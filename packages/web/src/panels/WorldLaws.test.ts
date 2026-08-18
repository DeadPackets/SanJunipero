import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_CONFIG } from '@sj/shared'
import { WorldLawsView } from './WorldLaws.js'
import { lawRows } from './lawsModel.js'
import { LAW_COPY, LAW_GROUPS } from '../ui/lawCopy.js'

const rows = lawRows(DEFAULT_CONFIG, {}, [])
const html = renderToStaticMarkup(createElement(WorldLawsView, { rows }))

/** The visible words only — a machine path in a `class` is not a machine path on a screen. */
const visible = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('U17 — the panel a viewer reads before an operator does', () => {
  it('leads every law with its human title', () => {
    for (const copy of Object.values(LAW_COPY)) expect(visible, copy.title).toContain(copy.title)
  })

  it('says what each law does to people, in a sentence', () => {
    for (const copy of Object.values(LAW_COPY)) expect(visible).toContain(copy.sentence)
  })

  it('sorts the rules into four subjects', () => {
    for (const group of LAW_GROUPS) expect(visible).toContain(group)
  })

  it('puts the title above the machine path, in the markup as on the screen', () => {
    for (const path of Object.keys(LAW_COPY)) {
      const title = LAW_COPY[path]!.title
      expect(html.indexOf(title), path).toBeLessThan(html.indexOf(`>${path}<`))
    }
  })
})

// WHAT THE BROWSER CAUGHT: sorted by path, "the body" asked whether a night makes a child
// before it said whether children are born at all.
describe('the questions come in the order a person would ask them', () => {
  it('says whether children are born before it says how often, and how long after that', () => {
    const at = (t: string): number => visible.indexOf(t)
    expect(at(LAW_COPY['reproduction.enabled']!.title))
      .toBeLessThan(at(LAW_COPY['reproduction.gestationDays']!.title))
    expect(at(LAW_COPY['reproduction.gestationDays']!.title))
      .toBeLessThan(at(LAW_COPY['reproduction.conceptionChancePerNight']!.title))
    expect(at(LAW_COPY['spoilage.enabled']!.title)).toBeLessThan(at(LAW_COPY['spoilage.days']!.title))
  })
})

describe('audit M2 — no JSON reaches a viewer', () => {
  it('prints how long food keeps as a row per food, not as a blob', () => {
    expect(visible).not.toMatch(/\{|\}|"fish"/)
    for (const food of ['Fish', 'Berries', 'Venison', 'Bread', 'Wheat']) {
      expect(visible, food).toContain(food)
    }
    expect(visible).toContain('2 days')     // fish
    expect(visible).toContain('60 days')    // wheat
  })

  it('prints a boolean law as an answer and a ratio in words', () => {
    expect(visible).toMatch(/In this town yes/)
    expect(visible).toContain('half a catch')
    expect(visible).toContain('twice as long')
  })

  it('does not print a single stringified value anywhere', () => {
    expect(html).not.toContain('[object Object]')
    expect(visible).not.toMatch(/\bundefined\b|\bNaN\b|\btrue\b|\bfalse\b/)
  })
})

describe('a law with no value, and a town that has not spoken yet', () => {
  it('says so plainly rather than showing a dash and a gap', () => {
    const cold = renderToStaticMarkup(createElement(WorldLawsView, { rows: lawRows(null, {}, []) }))
    expect(cold).toContain('not read yet')
    expect(cold).not.toContain('undefined')
  })

  it('takes an empty rule list without collapsing the panel', () => {
    const none = renderToStaticMarkup(createElement(WorldLawsView, { rows: [] }))
    expect(none).toContain('World Laws')
    expect(none).not.toContain('law-group-name')
  })
})
