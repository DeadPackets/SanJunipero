import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Moment } from '@sj/shared'
import { MomentCardView, MomentsFrameView, PlayerStripView } from './MomentsLens.js'
import { idlePlayer, type PlayerState } from './momentsPlayer.js'
import { GAMIFICATION_BAN } from './townStats.js'
import { BAND_MIN_PX, STRIP_CARD_W, STRIP_GAP } from './frame.js'
import { EMPTY_COPY } from './townStats.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
const APP = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

const EMOJI = /\p{Extended_Pictographic}/u

const moment: Moment = {
  id: 4,
  day: 3,
  startTick: 4320,
  endTick: 4380,
  title: 'What the Fire Took',
  cast: ['alice', 'bob'],
  location: 'the riverbank',
}
const people = { alice: { name: 'Rahel', alive: true }, bob: { name: 'Tomas', alive: true } }

const card = (open: boolean): string =>
  renderToStaticMarkup(createElement(MomentCardView, { moment, people, open, onOpen: () => {} }))

const strip = (player: PlayerState): string =>
  renderToStaticMarkup(
    createElement(PlayerStripView, {
      moment,
      player,
      onToggle: () => {},
      onSeek: () => {},
      onSpeed: () => {},
      onLive: () => {},
    }),
  )

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
    expect(html).toContain('#7FB0C9') // the riverbank motif, in water blue
    expect(html).not.toMatch(EMOJI)
  })

  it('marks the day being watched, and only then', () => {
    expect(card(true)).toContain('aria-current="true"')
    expect(card(true)).toContain('class="moment-card open"')
    expect(html).not.toContain('aria-current')
  })

  it('says somewhere in the town when the day had no place', () => {
    const nowhere = renderToStaticMarkup(
      createElement(MomentCardView, {
        moment: { ...moment, location: null },
        people,
        open: false,
        onOpen: () => {},
      }),
    )
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

const frame = (over: Partial<Parameters<typeof MomentsFrameView>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(MomentsFrameView, {
      moments: [moment],
      people,
      momentId: null,
      letterboxed: true,
      leaving: false,
      bandW: 1200,
      onOpen: () => {},
      ...over,
    }),
  )

describe('MomentsFrameView — the rail leaves the picture alone', () => {
  const html = frame()

  it('is one tree: the band and the days it holds share a root', () => {
    expect(html).toMatch(/^<div class="moments-lens"/)
    expect(html).toContain('class="letterbox top"')
    expect(html).toContain('class="film-strip"')
  })

  it('spends the bottom band on the filmstrip instead of drawing a second dead bar', () => {
    expect(html).not.toContain('letterbox bottom')
    expect(html.slice(html.indexOf('film-strip'))).toContain('What the Fire Took')
  })

  it('hands the band the scroll stripLayout computed, so the open day is the one you see', () => {
    const many = frame({
      moments: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ ...moment, id: i, day: i })),
      momentId: 6,
    })
    const pitch = STRIP_CARD_W + STRIP_GAP
    expect(many).toContain(`data-scroll-x="${6 * pitch + STRIP_CARD_W / 2 - 600}"`)
    expect(frame({ momentId: null })).toContain('data-scroll-x="0"')
  })

  // A computed transform would have left the sixth day focusable but invisible, so the strip
  // keeps a real scroller and the layout only drives it.
  it('keeps a real scroller, so a card the keyboard reaches is a card you can see', () => {
    const list = /\.strip-list\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(list).toMatch(/overflow-x:\s*auto/)
    expect(list).not.toMatch(/translate:/)
  })

  it('drops the bands entirely when no day is playing, and still shows the strip', () => {
    const flat = frame({ letterboxed: false })
    expect(flat).not.toContain('class="letterbox')
    expect(flat).toContain('class="film-strip"')
    expect(flat).toContain('data-letterboxed="false"')
  })

  it('says so honestly when the town has kept no days yet', () => {
    const empty = frame({ moments: [] })
    expect(empty).toContain(EMPTY_COPY.moments)
    expect(empty).toContain('class="film-strip"')
  })

  it('keeps the group named for a reader who cannot see the band', () => {
    expect(html).toContain('aria-label="The days the town kept"')
  })
})

describe('the composition, in the stylesheet and in the app that mounts it', () => {
  it('makes the strip EXACTLY the bottom band, so it cannot straddle its edge', () => {
    const strip = /\.film-strip\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(strip, '.film-strip has no rule').not.toBe('')
    expect(strip).toMatch(/bottom:\s*0/)
    expect(strip).toMatch(/height:\s*var\(--letterbox-h\)/)
  })

  it('lifts every surface that used to sit over the band off it, by the same one variable', () => {
    for (const sel of ['.moment-player', '.subtitle']) {
      // every rule the sheet has for the selector, joined — `.subtitle` is declared twice
      const all = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, s]) => (s ?? '').split(',').some((one) => one.trim() === sel))
        .map(([, , body]) => body ?? '')
        .join(';')
      expect(all, `${sel} still measures the band by hand`).toMatch(/var\(--letterbox-h\)/)
    }
    expect(CSS).not.toMatch(/bottom:\s*calc\(12%/)
  })

  it('stops rendering the two views as siblings that know nothing of each other', () => {
    expect(APP, 'App.tsx still mounts DirectorMode beside the lens').not.toContain('<DirectorMode')
  })

  // The pure layout and the sheet describe the same stage or `straddlers` proves nothing.
  it('gives the sheet the same band floor and card width the layout computes with', () => {
    expect(/--film-h:\s*(\d+)px/.exec(CSS)?.[1]).toBe(String(BAND_MIN_PX))
    expect(/--strip-card:\s*(\d+)px/.exec(CSS)?.[1]).toBe(String(STRIP_CARD_W))
    expect(/\.strip-list\s*\{[^}]*gap:\s*(\d+)px/.exec(CSS)?.[1]).toBe(String(STRIP_GAP))
  })
})
