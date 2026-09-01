import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { DEFAULT_CONFIG } from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import {
  PERSON_VERBS,
  RING_LABEL,
  RING_VERBS,
  SubjectRing,
  armFor,
  ringVerbsFor,
} from './SubjectRing.js'
import type { Subject } from './anchor.js'
import type { WorldStore } from '../state/worldStore.js'

const AMARA: Subject = { id: 'a1', kind: 'agent', name: 'Amara' }

const place = (id: string, kind: string, stage: Structure['stage'] = 'complete'): Structure =>
  ({ id, kind, x: 0, y: 0, w: 2, h: 2, stage }) as Structure

/** Only the four calls the ring makes; the rest of the store is not its business. */
const storeOf = (...standing: Structure[]): WorldStore =>
  ({
    subscribe: () => () => undefined,
    getConfig: () => DEFAULT_CONFIG,
    getState: () =>
      ({ structures: Object.fromEntries(standing.map((s) => [s.id, s])) }) as WorldState,
  }) as unknown as WorldStore

const markup = (subject: Subject | null, store: WorldStore = storeOf()): string =>
  renderToStaticMarkup(
    createElement(SubjectRing, {
      subject,
      scene: null,
      store,
      onVerb: () => {
        /* the caller's job */
      },
    }),
  )

// ★ The arms stand at 12, 3, 6 and 9 o'clock. Stepping round a flat list put ArrowDown from
// the top arm on the RIGHT one, which is not where the viewer is pointing.
describe('★ the arrows point at an arm, they do not step round a list', () => {
  const CSS = readFileSync(new URL('../ui/chrome.css', import.meta.url), 'utf8')

  const FOUR = PERSON_VERBS.length

  it('★ names the arm the key points at, whichever arm the focus is on', () => {
    expect(armFor('ArrowUp', FOUR)).toBe(0)
    expect(armFor('ArrowRight', FOUR)).toBe(1)
    expect(armFor('ArrowDown', FOUR)).toBe(2)
    expect(armFor('ArrowLeft', FOUR)).toBe(3)
  })

  it('★ points at the arm the sheet actually draws there', () => {
    const at = (n: number): string =>
      new RegExp(`\\.stage-ring-arms button:nth-child\\(${n}\\) \\{([^}]*)\\}`).exec(CSS)![1]!
    expect(at(armFor('ArrowUp', FOUR)! + 1), 'up').toContain('top: 0')
    expect(at(armFor('ArrowRight', FOUR)! + 1), 'right').toContain('left: 100%')
    expect(at(armFor('ArrowDown', FOUR)! + 1), 'down').toContain('top: 100%')
    expect(at(armFor('ArrowLeft', FOUR)! + 1), 'left').toContain('left: 0')
  })

  it('keeps Home and End on the first and last arm', () => {
    expect(armFor('Home', FOUR)).toBe(0)
    expect(armFor('End', FOUR)).toBe(FOUR - 1)
  })

  it('★ points at nothing where a shorter ring draws no arm', () => {
    expect(armFor('ArrowDown', 2)).toBeNull()
    expect(armFor('ArrowLeft', 2)).toBeNull()
    expect(armFor('End', 2)).toBe(1)
    expect(armFor('ArrowUp', 1)).toBe(0)
    expect(armFor('ArrowRight', 1)).toBeNull()
  })

  it('leaves every other key to whoever else wants it', () => {
    for (const key of ['Enter', ' ', 'Escape', 'a', 'Tab', '+', '-']) {
      expect(armFor(key, FOUR), key).toBeNull()
    }
  })
})

describe('the ring is what this subject can be asked, reachable by keyboard', () => {
  it('is a menu named after the person it stands around', () => {
    const html = markup(AMARA)
    expect(html).toContain('role="menu"')
    expect(html).toContain('aria-label="Amara"')
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(PERSON_VERBS.length)
  })

  it('names every verb in the town’s own words', () => {
    const html = markup(AMARA)
    for (const v of PERSON_VERBS) expect(html, v).toContain(`>${RING_LABEL[v]}<`)
  })

  it('keeps ONE tab stop, so Tab leaves the ring rather than walking it', () => {
    const html = markup(AMARA)
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(PERSON_VERBS.length - 1)
  })

  it('draws nothing at all with nobody asked about', () => {
    expect(markup(null)).toBe('')
  })
})

// ★ A well was offered Follow, Bonds and Home: three arms that did nothing a viewer could see,
// on a thing with no legs, no friends and no door.
describe('★ a building is asked what a building can answer', () => {
  const WELL: Subject = { id: 'w1', kind: 'structure', name: 'well' }
  const HOUSE: Subject = { id: 'h1', kind: 'structure', name: 'Yusuf’s house' }

  it('★ offers a person the four person verbs, and nothing else', () => {
    expect(ringVerbsFor('agent', false)).toEqual([...PERSON_VERBS])
    expect(ringVerbsFor('agent', true)).toEqual([...PERSON_VERBS])
  })

  it('★ offers a roofed building its story and its way in — and a monument only its story', () => {
    expect(ringVerbsFor('structure', true)).toEqual(['story', 'inside'])
    expect(ringVerbsFor('structure', false)).toEqual(['story'])
  })

  it('★ reads the way in off the world, so a well never gets one and a house does', () => {
    const html = markup(HOUSE, storeOf(place('h1', 'house')))
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(2)
    expect(html).toContain(`>${RING_LABEL.inside}<`)
    expect(html).not.toContain(`>${RING_LABEL.follow}<`)
    expect(markup(WELL, storeOf(place('w1', 'well')))).not.toContain(`>${RING_LABEL.inside}<`)
  })

  // ★ A ring that shrinks under the focus — a house that burns down while it is ringed — kept
  // its tab stop on an arm that is no longer drawn, and Tab could not reach the ring at all.
  it('★ keeps its one tab stop however few arms it has', () => {
    for (const html of [
      markup(HOUSE, storeOf(place('h1', 'house'))),
      markup(WELL, storeOf(place('w1', 'well'))),
    ]) {
      expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    }
  })

  it('★ takes the way in off a shell that is still going up — there is no room in it yet', () => {
    const shell = markup(HOUSE, storeOf(place('h1', 'house', 'construction')))
    expect((shell.match(/role="menuitem"/g) ?? []).length).toBe(1)
    expect(shell).toContain(`>${RING_LABEL.story}<`)
  })

  it('spends every verb it declares — no arm is unreachable and no label unused', () => {
    const asked = new Set([...ringVerbsFor('agent', true), ...ringVerbsFor('structure', true)])
    expect([...RING_VERBS].every((v) => asked.has(v))).toBe(true)
  })
})
