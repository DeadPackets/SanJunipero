import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GAMIFICATION_BAN } from './townStats.js'
import { HudDock } from './HudDock.js'
import {
  DEFAULT_HUD, DOCKABLE, DOCKABLE_LABEL, DOCK_SLOTS, HUD_PEEK_PX, HUD_STORAGE_KEY,
  HUD_TOGGLE_KEY, SLOTS_FOR, SLOT_LABEL, canDock, hiddenCount, hudReducer, hudToggle,
  isFullyHidden, loadHud, saveHud,
  type DockSlot, type HudLayout,
} from './hudLayout.js'

const EMOJI = /\p{Extended_Pictographic}/u

/** the smallest Storage that behaves like one, plus one that refuses everything */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k) },
    setItem: (k, v) => { map.set(k, v) },
  }
}
const brokenStorage = (): Storage => ({
  length: 0, clear: () => {}, key: () => null, removeItem: () => {},
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
})

describe('hudReducer — moving one thing moves one thing', () => {
  it('docks one item and leaves the others exactly where they were', () => {
    const next = hudReducer(DEFAULT_HUD, { kind: 'dock', what: 'controlBar', to: 'top' })
    expect(next.controlBar).toBe('top')
    for (const k of DOCKABLE) {
      if (k !== 'controlBar') expect(next[k], k).toBe(DEFAULT_HUD[k])
    }
  })

  it('returns the SAME object when nothing moved', () => {
    expect(hudReducer(DEFAULT_HUD, { kind: 'dock', what: 'controlBar', to: 'bottom' }))
      .toBe(DEFAULT_HUD)
  })

  it('hide-all puts every dockable away, and says so', () => {
    const hidden = hudReducer(DEFAULT_HUD, { kind: 'hide-all' })
    expect(isFullyHidden(hidden)).toBe(true)
    expect(hiddenCount(hidden)).toBe(DOCKABLE.length)
    expect(hiddenCount(DEFAULT_HUD)).toBe(0)
    expect(isFullyHidden(DEFAULT_HUD)).toBe(false)
  })

  it('show-all restores exactly the defaults — a clean round trip', () => {
    expect(hudReducer(hudReducer(DEFAULT_HUD, { kind: 'hide-all' }), { kind: 'show-all' }))
      .toEqual(DEFAULT_HUD)
  })

  it('reset from ANY reachable layout equals the defaults', () => {
    for (const what of DOCKABLE) {
      for (const to of DOCK_SLOTS) {
        const odd = hudReducer(DEFAULT_HUD, { kind: 'dock', what, to })
        expect(hudReducer(odd, { kind: 'reset' })).toEqual(DEFAULT_HUD)
      }
    }
  })

  it('never invents a slot or loses a dockable, over every single move', () => {
    for (const what of DOCKABLE) {
      for (const to of DOCK_SLOTS) {
        const next = hudReducer(DEFAULT_HUD, { kind: 'dock', what, to })
        expect(Object.keys(next).sort()).toEqual([...DOCKABLE].sort())
        for (const k of DOCKABLE) expect(DOCK_SLOTS as readonly string[]).toContain(next[k])
      }
    }
  })
})

// SHIP NO DEAD OPTIONS (batch 3 concern 9, controller ruling R4.3). The reducer advertised all
// five slots for all four surfaces while only the control bar has left/right in CSS — the other
// three are honoured for `hidden` and placed where they already live otherwise.
describe('SLOTS_FOR — a surface is only offered a slot the renderer can place it in', () => {
  it('every surface can be put away and can go back where it started, and no more is claimed', () => {
    for (const what of DOCKABLE) {
      expect(SLOTS_FOR[what], what).toContain('hidden')
      expect(SLOTS_FOR[what], what).toContain(DEFAULT_HUD[what])
      for (const slot of SLOTS_FOR[what]) expect(DOCK_SLOTS as readonly string[]).toContain(slot)
    }
    // only the control bar has all five in CSS; claiming more for the others is the dead option
    expect([...SLOTS_FOR.controlBar].sort()).toEqual([...DOCK_SLOTS].sort())
    for (const what of DOCKABLE) {
      if (what !== 'controlBar') expect(SLOTS_FOR[what].length, what).toBe(2)
    }
  })

  // RED against the landed reducer: it moves the timeline to `left` and the renderer leaves it
  // along the bottom, so the menu says one thing and the stage shows another.
  it('refuses a move the renderer cannot perform, and keeps the surface where it was', () => {
    expect(canDock('timeline', 'left')).toBe(false)
    expect(canDock('controlBar', 'left')).toBe(true)
    const next = hudReducer(DEFAULT_HUD, { kind: 'dock', what: 'timeline', to: 'left' })
    expect(next.timeline).toBe(DEFAULT_HUD.timeline)
    expect(next).toBe(DEFAULT_HUD)
  })

  it('a stored layout naming an unplaceable slot loads as the default for that surface', () => {
    const l = loadHud(fakeStorage({
      [HUD_STORAGE_KEY]: '{"timeline":"left","statusStrip":"hidden","controlBar":"right"}',
    }))
    expect(l.timeline).toBe(DEFAULT_HUD.timeline)
    expect(l.statusStrip).toBe('hidden')
    expect(l.controlBar).toBe('right')
  })

  it('the reducer can never reach a slot the surface does not have', () => {
    for (const what of DOCKABLE) {
      for (const to of DOCK_SLOTS) {
        const next = hudReducer(DEFAULT_HUD, { kind: 'dock', what, to })
        expect(SLOTS_FOR[what], `${what}:${to}`).toContain(next[what])
      }
    }
  })
})

describe('loadHud / saveHud — a preference, never a requirement', () => {
  it('an empty store, an empty object and bad JSON all give the defaults', () => {
    expect(loadHud(fakeStorage())).toEqual(DEFAULT_HUD)
    expect(loadHud(fakeStorage({ [HUD_STORAGE_KEY]: '{}' }))).toEqual(DEFAULT_HUD)
    expect(loadHud(fakeStorage({ [HUD_STORAGE_KEY]: 'not json' }))).toEqual(DEFAULT_HUD)
    expect(loadHud(fakeStorage({ [HUD_STORAGE_KEY]: 'null' }))).toEqual(DEFAULT_HUD)
    expect(loadHud(fakeStorage({ [HUD_STORAGE_KEY]: '[1,2,3]' }))).toEqual(DEFAULT_HUD)
  })

  it('drops a bad slot and keeps the good ones beside it', () => {
    const l = loadHud(fakeStorage({
      [HUD_STORAGE_KEY]: '{"controlBar":"nope","timeline":"hidden","nonsense":"top"}',
    }))
    expect(l.controlBar).toBe(DEFAULT_HUD.controlBar)
    expect(l.timeline).toBe('hidden')
    expect(Object.keys(l).sort()).toEqual([...DOCKABLE].sort())
  })

  it('round-trips through a real store, and never throws on one that refuses', () => {
    const s = fakeStorage()
    const l = hudReducer(DEFAULT_HUD, { kind: 'dock', what: 'fps', to: 'hidden' })
    saveHud(s, l)
    expect(loadHud(s)).toEqual(l)
    expect(loadHud(s)).toEqual(loadHud(s))
    expect(() => saveHud(brokenStorage(), l)).not.toThrow()
    expect(loadHud(brokenStorage())).toEqual(DEFAULT_HUD)
  })
})

describe('HudDock — a viewer can never hide the way back', () => {
  const render = (layout: HudLayout, open = false): string =>
    renderToStaticMarkup(createElement(HudDock, { layout, open, onEvent: () => {}, onOpen: () => {} }))

  /** 20 sampled layouts, including the two extremes */
  function* sample(): Generator<HudLayout> {
    yield DEFAULT_HUD
    yield hudReducer(DEFAULT_HUD, { kind: 'hide-all' })
    let l = DEFAULT_HUD
    let i = 0
    for (const what of DOCKABLE) {
      for (const to of DOCK_SLOTS) {
        if (i++ >= 18) return
        l = hudReducer(l, { kind: 'dock', what, to })
        yield l
      }
    }
  }

  it('THE UN-TRAP ASSERTION: every reachable layout still renders a real way back', () => {
    for (const layout of sample()) {
      for (const open of [false, true]) {
        const html = render(layout, open)
        expect(html, JSON.stringify(layout)).toContain('<button')
        expect(html).toMatch(/aria-label="[^"]{4,}"/)
        expect(html).not.toMatch(/tabindex="-1"/)
      }
    }
  })

  it('the handle is a real button with a spoken label, and it leaves a peek', () => {
    const html = render(hudReducer(DEFAULT_HUD, { kind: 'hide-all' }))
    expect(html).toContain('class="hud-handle"')
    expect(html).toContain('type="button"')
    expect(HUD_PEEK_PX).toBeGreaterThan(0)
    expect(html).toContain(`--hud-peek:${HUD_PEEK_PX}px`)
  })

  it('offers every slot it can place, in the town’s own words, and not one it cannot', () => {
    const html = render(DEFAULT_HUD, true)
    for (const what of DOCKABLE) expect(html, what).toContain(DOCKABLE_LABEL[what])
    for (const slot of DOCK_SLOTS) expect(html, slot).toContain(SLOT_LABEL[slot])
    for (const what of DOCKABLE) {
      for (const slot of DOCK_SLOTS) {
        const offered = html.includes(`data-dock="${what}:${slot}"`)
        expect(offered, `${what}:${slot}`).toBe(SLOTS_FOR[what].includes(slot))
      }
    }
  })

  it('marks where each surface currently sits, and only there', () => {
    const layout = hudReducer(DEFAULT_HUD, { kind: 'dock', what: 'controlBar', to: 'left' })
    const html = render(layout, true)
    const pressed = [...html.matchAll(/data-dock="([^"]+)"[^>]*aria-pressed="true"/g)]
      .map((m) => m[1])
    expect(pressed.sort()).toEqual(
      DOCKABLE.map((k) => `${k}:${layout[k]}`).sort(),
    )
  })

  it('names the key that undoes any amount of hiding', () => {
    expect(HUD_TOGGLE_KEY).toBe('h')
    expect(render(DEFAULT_HUD)).toMatch(/[Hh]/)
  })

  // WHAT THE BROWSER CAUGHT: with only the bar put away, H hid the REST of the chrome
  // instead of bringing the bar back.
  it('the key brings everything back whenever ANYTHING is away', () => {
    const oneAway = hudReducer(DEFAULT_HUD, { kind: 'dock', what: 'controlBar', to: 'hidden' })
    expect(hudToggle(oneAway)).toEqual({ kind: 'show-all' })
    expect(hudReducer(oneAway, hudToggle(oneAway))).toEqual(DEFAULT_HUD)
    expect(hudToggle(hudReducer(DEFAULT_HUD, { kind: 'hide-all' }))).toEqual({ kind: 'show-all' })
    // and only from a full stage does it put things away
    expect(hudToggle(DEFAULT_HUD)).toEqual({ kind: 'hide-all' })
  })

  it('two presses from anywhere land on the defaults, never on a worse place', () => {
    for (const what of DOCKABLE) {
      for (const to of DOCK_SLOTS) {
        let l = hudReducer(DEFAULT_HUD, { kind: 'dock', what, to })
        l = hudReducer(l, hudToggle(l))
        l = hudReducer(l, hudToggle(l))
        expect(hiddenCount(l), `${what}:${to}`).toBeLessThanOrEqual(DOCKABLE.length)
        expect(hudReducer(l, { kind: 'show-all' })).toEqual(DEFAULT_HUD)
      }
    }
  })

  it('is drawn and observational — no emoji, no gamification', () => {
    for (const open of [false, true]) {
      const html = render(DEFAULT_HUD, open)
      expect(html).not.toMatch(EMOJI)
      expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(GAMIFICATION_BAN)
    }
  })
})

describe('the slots the renderer must be able to place', () => {
  it('every slot has a word, and every dockable has a name', () => {
    for (const s of DOCK_SLOTS) expect(SLOT_LABEL[s as DockSlot].length).toBeGreaterThan(4)
    for (const d of DOCKABLE) expect(DOCKABLE_LABEL[d].length).toBeGreaterThan(4)
  })
})
