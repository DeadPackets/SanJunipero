// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { fold, genesisState, type TileId } from '@sj/engine'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { momentStamp } from '../paper/stamp.js'
import { DayBar, dayStart, playPause, trackTick } from '../stage/DayBar.js'
import { App, wayBack } from '../App.js'
import { ReplayScene } from '../stage/ReplayScene.js'
import { SCENE_IN_MS, SCENE_OUT_MS, SCENE_TOTAL_MS, SCENES } from './sceneTransition.js'
import { TITLE_CARD_MS, castNames, dipAlpha, pointPlay } from './replayRun.js'
import { paperDock, rememberPaperDock } from './storage.js'

// happy-dom's own `URL` resolves a bare path against localhost, so a file read has to be a path.
const src = (f: string): string => readFileSync(join(import.meta.dirname, f), 'utf8')
const CSS = src('./chrome.css')

// The canvas wants WebGL and the socket wants a server. Everything else in the tree is real.
vi.mock('../render/StageMount.js', () => ({ StageMount: () => null }))
let world: WorldStore | null = null
vi.mock('../net/socket.js', () => ({
  connectObservatory: (opts: { store: WorldStore }) => {
    world = opts.store
    return { close: () => undefined, replay: () => undefined }
  },
}))

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.stubGlobal('fetch', () => Promise.reject(new Error('no gateway in a test')))

async function mount(el: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(el)
  })
  return host
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.useRealTimers()
  // happy-dom keeps one location per file, so a route a test set outlives it otherwise.
  history.replaceState(null, '', '/')
  world = null
})

const DAY = 12 * MINUTES_PER_DAY + 9 * 60 + 40
const EDGE = 400 * MINUTES_PER_DAY
const PLAY = pointPlay(DAY, EDGE, 'Rahel died.')

const GRASS: TileId[][] = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0))
const WALKER: SimEvent = {
  seq: 1,
  tick: 1,
  type: 'agent_spawned',
  payload: { id: 'walker', name: 'Walker', x: 0, y: 0, ageDays: 8000 },
}

/** The town as the socket would hand it over: one named body, so the glass has a name to print. */
function townArrives(store: WorldStore): void {
  const state = fold(genesisState(DEFAULT_CONFIG, GRASS), WALKER, DEFAULT_CONFIG)
  store.applyServer({
    t: 'snapshot',
    tick: state.tick,
    seq: 1,
    state: JSON.parse(JSON.stringify(state)) as typeof state,
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG,
    laws: {},
    live: true,
  })
}

describe('★ the dip: the town leaves, the past arrives', () => {
  it('★ is the machine that was already there, not a second one', () => {
    expect(SCENES).toContain('replay')
    expect(SCENE_OUT_MS).toBe(120)
    expect(SCENE_IN_MS).toBe(180)
  })

  it('★ goes to black at the seam and comes all the way back', () => {
    expect(dipAlpha(0)).toBe(0)
    expect(dipAlpha(SCENE_OUT_MS)).toBe(1)
    expect(dipAlpha(SCENE_TOTAL_MS)).toBe(0)
    expect(dipAlpha(SCENE_TOTAL_MS + 500)).toBe(0)
  })

  it('rises the whole way out and falls the whole way in — no step, no plateau', () => {
    for (let t = 1; t <= SCENE_OUT_MS; t++)
      expect(dipAlpha(t), `${t}`).toBeGreaterThan(dipAlpha(t - 1))
    for (let t = SCENE_OUT_MS + 1; t <= SCENE_TOTAL_MS; t++)
      expect(dipAlpha(t), `${t}`).toBeLessThan(dipAlpha(t - 1))
  })

  it('★ under reduced motion there is no dip at all — a fade, or nothing', () => {
    for (const t of [0, 60, 120, 240, 300]) expect(dipAlpha(t, true), `${t}`).toBe(0)
  })

  it('is written to the DOM per frame, so the sheet gives it no transition to fight', async () => {
    const host = await mount(createElement(ReplayScene, { store: createWorldStore(), play: PLAY }))
    const dip = host.querySelector<HTMLElement>('.replay-dip')!
    const drawn = new Set<string>()
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((done) => setTimeout(done, 20))
      })
      drawn.add(dip.style.opacity)
    }
    expect(drawn.size, 'the curtain stood still: nothing wrote it a frame').toBeGreaterThan(1)
    expect(CSS).toMatch(/\.replay-dip \{[^}]*opacity: 0;/)
    expect(CSS.slice(CSS.indexOf('.replay-dip'), CSS.indexOf('.replay-card'))).not.toContain(
      'transition',
    )
  })
})

describe('★ the title card names the minute and gets out of the way', () => {
  it('★ stands for two seconds at the most', async () => {
    expect(TITLE_CARD_MS).toBe(2000)
    vi.useFakeTimers()
    const host = await mount(createElement(ReplayScene, { store: createWorldStore(), play: PLAY }))
    expect(host.querySelector('.replay-card-title')?.textContent).toBe('Rahel died.')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TITLE_CARD_MS)
    })
    expect(host.querySelector('.replay-card-title'), 'the card never came down').toBeNull()
  })

  it('★ goes down on the first thing that happens, so it never covers it', async () => {
    const store = createWorldStore()
    townArrives(store)
    const host = await mount(createElement(ReplayScene, { store, play: PLAY }))
    expect(host.querySelector('.replay-card-title')?.textContent).toBe('Rahel died.')
    await act(async () => {
      store.applyServer({
        t: 'tick',
        tick: 2,
        seq: 2,
        events: [{ seq: 2, tick: 2, type: 'tick_advanced', payload: {} }],
      })
    })
    expect(host.querySelector('.replay-card-title'), 'the card stood over the town').toBeNull()
  })

  it('★ is non-modal and takes no focus: a caption on the town, not a thing to dismiss', async () => {
    const host = await mount(createElement(ReplayScene, { store: createWorldStore(), play: PLAY }))
    const card = host.querySelector('.replay-card')!
    expect(card.getAttribute('aria-hidden')).toBe('true')
    expect(card.getAttribute('role')).toBeNull()
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(CSS).toMatch(/\.replay-card \{[^}]*pointer-events: none;/)
  })

  // The card had its own formatter and the sheet had another, so one minute read two ways on
  // two surfaces of one frame.
  it('carries the day, the minute and the people, in the town’s own words', async () => {
    const host = await mount(createElement(ReplayScene, { store: createWorldStore(), play: PLAY }))
    expect(host.querySelector('.replay-card-when')?.textContent).toBe(momentStamp(DAY))
    expect(momentStamp(1500)).toBe('Day 1 01:00')
    const names: Record<string, string> = { a1: 'Rahel', a2: 'Tomas', a3: 'Omar' }
    expect(castNames(['a1'], (id) => names[id])).toBe('Rahel')
    expect(castNames(['a1', 'a2'], (id) => names[id])).toBe('Rahel and Tomas')
    expect(castNames(['a1', 'a2', 'a3'], (id) => names[id])).toBe('Rahel, Tomas and Omar')
    expect(castNames(['ghost'], (id) => names[id])).toBe('')
  })

  it('never stands in the cue’s slot at the same time as the cue', () => {
    // the frame gives the card and the cue a row each, bottom up, so the two can never collide
    // and neither has to know how tall the other is
    expect(CSS.slice(CSS.indexOf('.replay-card {'))).toContain('grid-area: third')
    expect(CSS.slice(CSS.indexOf('.stage-cue {'))).toContain('grid-area: cue')
  })
})

describe('★ the grade: warm, a tenth less saturated, and NEVER sepia', () => {
  const GRADE = CSS.slice(CSS.indexOf('.replay-grade {'), CSS.indexOf('.replay-dip {'))

  it('★ takes exactly a tenth of the saturation', () => {
    expect(GRADE).toContain('saturate(0.9)')
  })

  it('★ is not a sepia wash: the past has to stay worth watching', () => {
    expect(CSS).not.toContain('sepia(')
    expect(GRADE).not.toMatch(/hue-rotate|grayscale/)
  })

  it('warms toward the sheet’s own honey and vignettes toward its own deep', () => {
    expect(GRADE).toContain('rgba(242, 200, 121') // --honey
    expect(GRADE).toContain('rgba(36, 31, 43') // --deep
  })

  it('grades on the compositor, never through a filter inside the tick budget', () => {
    expect(GRADE).toContain('backdrop-filter')
    expect(src('../render/StageMount.tsx')).not.toContain('ColorMatrixFilter')
  })
})

/** The bar a viewer watching the past is given, off the store the app hands it. */
const REPLAYING: WorldStore = {
  ...createWorldStore(),
  getTick: () => DAY,
  liveEdge: () => EDGE,
  getMode: () => ({ live: false, replaying: true, tick: DAY }),
}

const bar = (store: WorldStore): string =>
  renderToStaticMarkup(
    createElement(DayBar, {
      store,
      link: 'online' as const,
      handle: null,
      onAt: () => undefined,
      autoCut: true,
      handbackAt: () => null,
    }),
  )

describe('★ the cut is a thing in the town, and the day bar is its one control', () => {
  it('★ NO LETTERBOX: the Signpost ruling holds, and the sheet already takes 66%', () => {
    // a selector, not the word: the block's own comment says why there is none
    for (const bar of ['letterbox', 'cinema-bar', 'pillarbox'])
      expect(CSS, bar).not.toMatch(new RegExp(`\\.${bar}[\\s,{:]`))
  })

  // The strip was a second control with a second clock on it, 800px from the first. The day
  // bar's own track carries the scrub now, so pause and resume are the same two messages.
  it('★ costs the protocol nothing: pause is a scrub, resume is a replay', () => {
    const said: string[] = []
    const handle = {
      scrub: (t: number) => said.push(`scrub ${t}`),
      replay: (t: number) => said.push(`replay ${t}`),
    } as unknown as Parameters<typeof playPause>[0]
    playPause(handle, true, 1500)
    playPause(handle, false, 1500)
    expect(said).toEqual(['scrub 1500', 'replay 1500'])
    playPause(null, true, 1500)
    expect(said).toHaveLength(2)
  })

  // ★ The strip carried its own way back and the app hid its one behind it. The strip is gone,
  // so the app's exit stands for as long as the town is off its live edge.
  it('★ replaces the lone way back rather than standing a second one beside it', () => {
    expect(wayBack(false, false), 'a replay with no way out of it').toBe(true)
    expect(wayBack(true, false), 'a way back offered at the live edge').toBe(false)
    expect(wayBack(false, true), 'a stream frame has no hands').toBe(false)
    expect(wayBack(true, true)).toBe(false)
    expect(bar(REPLAYING), 'the bar grew a second way back').not.toContain('Return to now')
  })

  // ★ The same ruling, on the surface it was still broken on: the paper's day strip carried its
  // own `Return to now`, so a scrub with the sheet open put two of them on one frame.
  it('★ stands ONE way back on the whole frame, the sheet open over it and all', async () => {
    const host = await mount(createElement(App))
    const store = world!
    townArrives(store)
    await act(async () => {
      store.applyServer({ t: 'scrubbed', reqId: 1, tick: DAY, state: store.getState() })
    })
    await act(async () => {
      host.querySelector<HTMLElement>('.signpost-arm[data-arm="chronicle"]')!.click()
    })
    await act(async () => {
      host.querySelector<HTMLElement>('#paper-tab-Record')!.click()
    })
    expect(host.querySelector('.day-strip'), 'the day strip never opened').not.toBeNull()
    const back = [...host.querySelectorAll('button')].filter((b) =>
      b.textContent.includes('Return to now'),
    )
    expect(
      back.map((b) => b.className),
      'a second way back stood beside the one',
    ).toEqual(['stage-live'])
    // ★ A voice-control user says the word they can see, and the strip's pill used to be named
    // something else: no label may rename the one way back out from under the word on it.
    expect(back.map((b) => b.getAttribute('aria-label'))).toEqual([null])
  })

  // ★ NO SPEED CONTROL. `bubbleLife` is 3500 ms + 55/char and the leg timing is tuned to the
  // live cadence: above 2x a replayed conversation is unreadable, and 2x is not worth a control.
  it('★ offers no speed at all: the bubbles and the legs are tuned to the live cadence', () => {
    const html = bar(REPLAYING)
    expect(html, 'the bar has no transport at all').toContain('day-bar-play')
    expect(html.match(/<button/g), 'a second control stands beside the one').toHaveLength(1)
    const said = [
      ...[...html.matchAll(/>([^<>]+)</g)].map((m) => m[1]!),
      ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!),
    ]
    for (const words of said) expect(words, words).not.toMatch(/speed|faster|slower|\d\s*[x×]/i)
    expect(playPause, 'pause and resume carry a rate').toHaveLength(3)
  })

  // ★ THE BOUND MOVED, and this is the ruling: the strip scrubbed inside the moment it was
  // replaying, and the day bar's track replaced it, so the bound is the day the viewer is on.
  it('★ its track is bounded to the day on screen, not to the whole history', () => {
    const from = dayStart(DAY)
    const edge = 400 * MINUTES_PER_DAY
    expect(trackTick(0, DAY, edge)).toBe(from)
    expect(trackTick(1, DAY, edge)).toBe(from + MINUTES_PER_DAY - 1)
    expect(trackTick(-1, DAY, edge), 'a hand off the end asked for another day').toBe(from)
    expect(trackTick(2, DAY, edge)).toBe(from + MINUTES_PER_DAY - 1)
    // ...and never a minute the town has not lived through
    expect(trackTick(1, DAY, DAY)).toBe(DAY)
  })

  it('is never drawn into a stream frame, which has no hands', async () => {
    const town = await mount(createElement(App))
    expect(town.querySelector('.replay-grade'), 'the town lost its replay chrome').not.toBeNull()
    history.replaceState(null, '', '/?broadcast=1')
    const stream = await mount(createElement(App))
    expect(stream.querySelector('.app')?.getAttribute('data-broadcast')).toBe('on')
    expect(stream.querySelector('.replay-grade'), 'a stream frame grew hands').toBeNull()
    expect(stream.querySelector('.replay-dip')).toBeNull()
  })
})

// ★ THE GLASS IS FED BY THE WORLD. The slot printed what the App handed it and nothing checked
// that the App handed it the town's own minute: both ends were read off the source text instead.
describe('★ what the App puts on the glass, driven by the world', () => {
  it('★ the cue slot says what the town’s own events said', async () => {
    const host = await mount(createElement(App))
    const store = world!
    townArrives(store)
    await act(async () => {
      store.applyServer({
        t: 'tick',
        tick: 2,
        seq: 3,
        events: [
          { seq: 2, tick: 2, type: 'tick_advanced', payload: {} },
          { seq: 3, tick: 2, type: 'agent_died', payload: { agentId: 'walker', cause: 'age' } },
        ],
      })
    })
    const cue = host.querySelector('.stage-cue')
    expect(cue?.textContent, 'nothing the world said reached the slot').toContain('Walker')
    expect(host.querySelectorAll('.stage-cue-glyph'), 'the moment lost its mark').toHaveLength(1)
  })

  it('★ the scene the shot is on stands on the glass once, off the one hold', async () => {
    const host = await mount(createElement(App))
    const store = world!
    townArrives(store)
    await act(async () => {
      store.applyServer({
        t: 'scene',
        scene: {
          id: 'sc_1',
          kind: 'quarrel',
          participants: ['walker'],
          topic: 'At the well',
          stakes: 9,
          open: true,
        },
      })
      store.setShotScene('sc_1')
    })
    expect(host.querySelector('.stage-cue')?.textContent).toContain('At the well · Walker')
    expect(
      host.querySelectorAll('.stage-scene-stamp'),
      'a second reader of the hold struck the stamp twice',
    ).toHaveLength(1)
  })
})

// ★ The dock was a button inside the sheet, so the one thing that had to know where the Almanac
// stands — Watch, which put it away on every play — could not ask.
describe('★ the Almanac stands where App says it stands, and one key moves it', () => {
  it('★ docks on `a`, and the next visit opens where this one left it', async () => {
    const host = await mount(createElement(App))
    townArrives(world!)
    expect(host.querySelector<HTMLElement>('.paper')?.dataset.dock).toBe('off')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })
    expect(host.querySelector<HTMLElement>('.paper')?.dataset.dock).toBe('on')
    expect(host.querySelector<HTMLElement>('.town-dim[data-dock]')?.dataset.dock).toBe('on')
    expect(paperDock(localStorage)).toBe('docked')
    rememberPaperDock(localStorage, 'sheet')
  })
})
