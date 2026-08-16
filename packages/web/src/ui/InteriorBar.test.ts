import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { InteriorBarView, interiorCaption } from './InteriorBar.js'

const EMOJI = /\p{Extended_Pictographic}/u
const GAMIFICATION_BAN = /\b(progress|score|level|quest|points?|badge|streak|rank|xp)\b/i
const MACHINERY = /\b(ai|llm|model|prompt|token|agent|api)\b/i

function agent(id: string, name: string, over: Partial<WorldState['agents'][string]> = {}) {
  return {
    id, name, x: 0, y: 0, alive: true, asleep: false,
    needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    hp: 10, injuries: [], ill: false, ageDays: 7300, skills: {}, activity: null,
    collapsedSinceTick: null, zeroHungerSinceTick: null, ...over,
  }
}

function structure(id: string, kind: string, owner?: string): WorldState['structures'][string] {
  return {
    id, kind, x: 1, y: 1, w: 2, h: 2, hp: 10, maxHp: 10, flammable: true,
    stage: 'complete', progressTicks: 0, builtBy: null, burning: false, burnTicks: 0,
    ...(owner === undefined ? {} : { owner }),
  }
}

function world(): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: {
      amara: agent('amara', 'Amara', { insideId: 'hut1', asleep: true }),
      yusuf: agent('yusuf', 'Yusuf', { insideId: 'hut1' }),
      nadia: agent('nadia', 'Nadia'),
    },
    structures: {
      hut1: structure('hut1', 'hut', 'amara'),
      store1: structure('store1', 'storehouse'),
      stone: structure('stone', 'standing_stone'),
    },
    items: {}, crops: {},
  }
}

describe('interiorCaption', () => {
  it('names an owned hut after its resident and says who is in', () => {
    const c = interiorCaption(world(), 'hut1')!
    expect(c.title).toBe("Amara's hut")
    expect(c.who).toBe('Amara asleep and Yusuf are in')
  })

  it('names a public building plainly and says so when nobody is there', () => {
    const c = interiorCaption(world(), 'store1')!
    expect(c.title).toBe('The storehouse')
    expect(c.who).toBe('No one is in just now')
  })

  it('is null for a structure with no interior, no id, and no world yet', () => {
    expect(interiorCaption(world(), 'stone')).toBeNull()
    expect(interiorCaption(world(), null)).toBeNull()
    expect(interiorCaption(null, 'hut1')).toBeNull()
  })

  it('reads as observation — never a score, never machinery', () => {
    for (const id of ['hut1', 'store1']) {
      const c = interiorCaption(world(), id)!
      expect(`${c.title} ${c.who}`).not.toMatch(GAMIFICATION_BAN)
      expect(`${c.title} ${c.who}`).not.toMatch(MACHINERY)
    }
  })
})

describe('InteriorBarView', () => {
  const html = renderToStaticMarkup(createElement(InteriorBarView, {
    caption: { title: "Amara's hut", who: 'Amara asleep and Yusuf are in' },
    onBack: () => {},
  }))

  it('gives the room a spoken name and a real button out', () => {
    expect(html).toContain('aria-label="Inside Amara&#x27;s hut"')
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('Back to town')
  })

  it('shows the room and its occupants, in the town\'s own words', () => {
    expect(html).toContain("Amara&#x27;s hut")
    expect(html).toContain('Amara asleep and Yusuf are in')
  })

  it('is drawn, never typed as an emoji', () => {
    expect(html).not.toMatch(EMOJI)
  })

  it('carries no gamification and no machinery vocabulary', () => {
    const text = html.replace(/<[^>]*>/g, ' ')
    expect(text).not.toMatch(GAMIFICATION_BAN)
    expect(text).not.toMatch(MACHINERY)
  })
})
