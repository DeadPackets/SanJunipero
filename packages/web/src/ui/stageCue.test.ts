import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { CHRONICLE_GLYPH } from './importantFeed.js'
import { CUE_HOLD_MS, CUE_ICON_PX, CUE_TYPES, bodiesOf, cueFor } from './stageCue.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

// The cue reads two names and nothing else off the world, so the fixture is two names.
const town = (): WorldState =>
  ({
    agents: { amara: { id: 'amara', name: 'Amara' }, yusuf: { id: 'yusuf', name: 'Yusuf' } },
    structures: {},
  }) as unknown as WorldState

const ev = (type: string, payload: Record<string, unknown>): SimEvent => ({
  seq: 1,
  tick: 1,
  type,
  payload,
})

afterEach(() => {
  vi.useRealTimers()
})

// ★ The desk had one line of story chrome and it printed "DIRECTOR · name". Every law, custom,
// invention and bond change went straight to the paper, which is closed by default.
describe('★ the stage says what just happened', () => {
  const state = town()

  it('★ names a discovery, in the town’s own sentence and with the feed’s own glyph', () => {
    const cue = cueFor(
      ev('discovery_made', {
        recipeId: 'r1',
        name: 'smoked fish',
        kind: 'craft',
        byId: 'amara',
        intent: 'keep the catch',
        makes: ['smoked_fish'],
      }),
      state,
    )
    expect(cue?.text).toBe('Amara found the way of it — smoked fish.')
    expect(cue?.icon).toBe('key')
    expect(cue?.bodies).toEqual(['amara'])
  })

  it('★ names a bond change, and both the bodies it happened to', () => {
    const cue = cueFor(ev('co_slept', { aId: 'amara', bId: 'yusuf', day: 3 }), state)
    expect(cue?.text).toBe('Amara and Yusuf kept house together.')
    expect(cue?.icon).toBe('heart')
    expect(cue?.bodies).toEqual(['amara', 'yusuf'])
  })

  it('★ says a law in its own words, and says who broke one', () => {
    expect(cueFor(ev('law_ratified', { lawId: 'l1', text: 'No fire after dark' }), state)?.text).toBe(
      'The town made it law — No fire after dark',
    )
    expect(cueFor(ev('law_ratified', { lawId: 'l1' }), state)?.text).toBe('The town made it law.')
    const broken = cueFor(ev('law_broken', { lawId: 'l1', agentId: 'yusuf', verb: 'take' }), state)
    expect(broken?.text).toBe("Yusuf broke the town's own law.")
    expect(broken?.bodies).toEqual(['yusuf'])
  })

  it('stays quiet about everything else — the slot is for what the town decided', () => {
    for (const type of ['agent_moved', 'crop_harvested', 'item_moved', 'tick_advanced']) {
      expect(cueFor(ev(type, { agentId: 'amara' }), state), type).toBe(null)
    }
  })

  it('★ has a drawn glyph for every type it will print, never the fallback star by accident', () => {
    for (const type of CUE_TYPES) {
      const cue = cueFor(
        ev(type, {
          lawId: 'l1',
          agentId: 'amara',
          byId: 'amara',
          aId: 'amara',
          bId: 'yusuf',
          name: 'a thing',
          kind: 'craft',
          day: 1,
        }),
        state,
      )
      expect(cue, type).not.toBe(null)
      expect(CHRONICLE_GLYPH[cue!.icon], `${type} → ${cue!.icon}`).toBeDefined()
    }
  })

  it('names nobody it was not told about', () => {
    expect(bodiesOf(ev('tick_advanced', {}))).toEqual([])
  })
})

describe('★ the moment stands for six seconds, then the slot goes back to naming the shot', () => {
  it('holds for six seconds and draws a 16px pixel icon', () => {
    expect(CUE_HOLD_MS).toBe(6000)
    expect(CUE_ICON_PX).toBe(16)
  })

  it('★ lands on the frame the event arrives on, and clears on a timer of its own', () => {
    const SRC = src('./stageCue.ts')
    // set INSIDE the event callback — no polling, no wait for the next world state
    expect(SRC).toMatch(/store\.onEvents\(\(evts\) => \{[\s\S]*?setCue\(next\)/)
    expect(SRC).toMatch(/setTimeout\(\(\) => \{\s*setCue\(null\)\s*\}, CUE_HOLD_MS\)/)
    // and a second moment replaces the first rather than leaving two timers running
    expect(SRC).toContain('if (timer !== null) clearTimeout(timer)')
  })

  it('★ the cue slot draws the glyph, and the App feeds it from the world’s own events', () => {
    expect(src('../stage/DirectorCue.tsx')).toContain('CUE_ICON_PX')
    expect(src('../App.tsx')).toContain('useStageCue(store)')
  })

  it('★ the two bodies it happened to bounce, on the finished-structure curve', () => {
    const AMBIENT = src('../render/ambient.ts')
    expect(AMBIENT).toContain('bodiesOf(')
    expect(AMBIENT).toContain('BOUNCE_SCALE')
  })

  it('fades rather than blinking out, and holds still under reduced motion', () => {
    const CSS = src('./chrome.css').replace(/\s+/g, ' ')
    expect(CSS).toMatch(/\.stage-cue \{[^}]*opacity: 1/)
    const guarded =
      /@media \(prefers-reduced-motion: no-preference\) \{(?:(?!@media)[\s\S])*?\.stage-cue \{ transition: opacity/
    expect(CSS, 'every motion in the sheet lives inside the no-preference guard').toMatch(guarded)
  })
})
