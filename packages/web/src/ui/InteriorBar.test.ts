import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoomCardView } from './InteriorBar.js'
import type { RoomCard } from './interiorModel.js'

const EMOJI = /\p{Extended_Pictographic}/u
const GAMIFICATION_BAN = /\b(progress|score|level|quest|points?|badge|streak|rank|xp)\b/i
const MACHINERY = /\b(ai|llm|model|prompt|token|agent|api)\b/i

const FULL: RoomCard = {
  title: 'Amara’s house',
  built: 'Raised by Yusuf, Day 3',
  lives: ['Amara'],
  holds: [
    { kind: 'wheat_sheaf', words: 'wheat sheaf', qty: 8, iconUrl: '/assets/a1.png' },
    { kind: 'bowl', words: 'bowl', qty: 1, iconUrl: null },
  ],
  more: 32,
  present: [
    { id: 'amara', name: 'Amara', state: 'Asleep' },
    { id: 'yusuf', name: 'Yusuf', state: 'Weaving' },
  ],
  empty: 'No one is in just now.',
}

const BARE: RoomCard = {
  title: 'the storehouse', built: null, lives: [], holds: [], more: 0, present: [],
  empty: 'No one is in just now.',
}

const render = (card: RoomCard): string =>
  renderToStaticMarkup(createElement(RoomCardView, { card, onBack: () => {} }))

describe('RoomCardView — a room that is somebody’s', () => {
  const html = render(FULL)

  it('gives the room a spoken name and a real button out', () => {
    expect(html).toContain('aria-label="Inside Amara’s house"')
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('Back to town')
  })

  it('shows whose it is, who raised it, who lives there and who is in', () => {
    expect(html).toContain('Amara’s house')
    expect(html).toContain('Raised by Yusuf, Day 3')
    expect(html).toContain('Home to')
    expect(html).toContain('Weaving')
    expect(html).toContain('Asleep')
  })

  it('shows what it holds, with a count, and says what it left out', () => {
    // the WORDS, never the slug the icon is looked up by (browser-caught, task 83's pass)
    expect(html).toContain('wheat sheaf')
    expect(html).not.toContain('wheat_sheaf')
    expect(html).toContain('url(&quot;/assets/a1.png&quot;)')
    expect(html).toContain('and 32 more')
    // a kind with no icon gets a drawn placeholder class, never a broken image
    expect(html).toContain('hold-icon bare')
    expect(html).not.toContain('url("null")')
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

describe('RoomCardView — the honest empty room', () => {
  const html = render(BARE)

  it('omits a line it has nothing to say in, rather than printing a blank', () => {
    expect(html).not.toContain('room-built')
    expect(html).not.toContain('room-lives')
    expect(html).not.toContain('room-holds')
    expect(html).not.toContain('null')
    expect(html).not.toContain('undefined')
  })

  it('still says the one thing that is true, and it is about NOW', () => {
    expect(html).toContain('No one is in just now.')
    expect(html.toLowerCase()).not.toContain('yet')
  })

  it('a room with holdings but no overflow says nothing about more', () => {
    const some = render({ ...BARE, holds: FULL.holds, more: 0 })
    expect(some).toContain('wheat sheaf')
    expect(some).not.toContain('more')
  })
})
