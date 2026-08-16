import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Moment } from '@sj/shared'
import { MomentCardView, PlayerStripView } from './MomentsLens.js'
import { idlePlayer, type PlayerState } from './momentsPlayer.js'
import { GAMIFICATION_BAN } from './townStats.js'

const EMOJI = /\p{Extended_Pictographic}/u

const moment: Moment = {
  id: 4, day: 3, startTick: 4320, endTick: 4380,
  title: 'What the Fire Took', cast: ['alice', 'bob'], location: 'the riverbank',
}
const people = { alice: { name: 'Rahel', alive: true }, bob: { name: 'Tomas', alive: true } }

const card = (open: boolean): string =>
  renderToStaticMarkup(createElement(MomentCardView, { moment, people, open, onOpen: () => {} }))

const strip = (player: PlayerState): string =>
  renderToStaticMarkup(createElement(PlayerStripView, {
    moment, player, onToggle: () => {}, onSeek: () => {}, onSpeed: () => {}, onLive: () => {},
  }))

describe('MomentCardView', () => {
  const html = card(false)

  it('is a postcard: the day, its name, who was there and where', () => {
    expect(html).toContain('Day 3')
    expect(html).toContain('What the Fire Took')
    expect(html).toContain('Rahel, Tomas')
    expect(html).toContain('the riverbank')
  })

  it('says the whole postcard in one breath for a reader who cannot see it', () => {
    expect(html).toContain(
      'aria-label="What the Fire Took. Day 3, Rahel, Tomas, the riverbank. Play this day."',
    )
  })

  it('draws the place as palette pixels, never as an emoji', () => {
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).toContain('#7FB0C9')      // the riverbank motif, in water blue
    expect(html).not.toMatch(EMOJI)
  })

  it('marks the day being watched, and only then', () => {
    expect(card(true)).toContain('aria-current="true"')
    expect(card(true)).toContain('class="moment-card open"')
    expect(html).not.toContain('aria-current')
  })

  it('says somewhere in the town when the day had no place', () => {
    const nowhere = renderToStaticMarkup(createElement(MomentCardView, {
      moment: { ...moment, location: null }, people, open: false, onOpen: () => {},
    }))
    expect(nowhere).toContain('somewhere in the town')
  })
})

describe('PlayerStripView', () => {
  const html = strip(idlePlayer(moment.startTick))

  it('is a real slider over the day, with the clock spoken', () => {
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuemin="4320"')
    expect(html).toContain('aria-valuemax="4380"')
    expect(html).toContain('aria-valuenow="4320"')
    expect(html).toContain('aria-valuetext="Day 3 00:00"')
  })

  it('puts the playhead where the day has got to', () => {
    expect(html).toContain('left:0%')
    expect(strip({ status: 'paused', tick: 4350, speed: 1, accMs: 0 })).toContain('left:50%')
  })

  it('says whether it is playing, in the label and in the state', () => {
    expect(html).toContain('aria-label="Play this day"')
    expect(html).toContain('aria-pressed="false"')
    const going = strip({ status: 'playing', tick: 4330, speed: 4, accMs: 0 })
    expect(going).toContain('aria-label="Pause this day"')
    expect(going).toContain('aria-pressed="true"')
  })

  it('shows the speed and offers the way back to now', () => {
    expect(strip({ status: 'playing', tick: 4330, speed: 4, accMs: 0 })).toContain('4×')
    expect(html).toContain('aria-label="Speed 1 times. Change speed."')
    expect(html).toContain('LIVE')
  })

  it('draws its transport in the town’s own pixels, never in an emoji', () => {
    expect(html).not.toMatch(EMOJI)
    expect(strip({ status: 'playing', tick: 4330, speed: 1, accMs: 0 })).not.toMatch(EMOJI)
    expect(html).toContain('class="player-glyph"')
  })

  it('speaks of watching, never of winning', () => {
    expect(html.replace(/[<>][^<>]*[<>]/g, ' ')).not.toMatch(GAMIFICATION_BAN)
    expect(card(false).replace(/[<>][^<>]*[<>]/g, ' ')).not.toMatch(GAMIFICATION_BAN)
  })
})
