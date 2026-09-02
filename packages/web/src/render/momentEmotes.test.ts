import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Container, Texture } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import type { TextureBook } from './textures.js'
import { CUE_TYPES, bodiesOf } from '../ui/stageCue.js'
import { CHAR_TARGET_PX, EMOTE_KINDS } from './charAnim.js'
import { SLOT_ABOVE_HEAD_PX, SLOT_PX } from './overhead.js'
import {
  MOMENT_EMOTE,
  MOMENT_EMOTE_ABOVE_PX,
  MOMENT_EMOTE_FADE_MS,
  MOMENT_EMOTE_MS,
  MOMENT_EMOTE_RISE_MS,
  MOMENT_EMOTE_RISE_PX,
  createMomentEmotes,
  emoteRise,
  momentEmote,
  type MomentEmoteLayer,
} from './momentEmotes.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

const ev = (type: string, payload: Record<string, unknown>): SimEvent => ({
  seq: 1,
  tick: 1,
  type,
  payload,
})

// ★ Nothing on the stage marked an achievement. A house finishing bounced; a person working out
// how to smoke a fish, or two people becoming a pair, passed in silence.
describe('★ a pixel rises off the head of whoever it happened to', () => {
  it('★ wears the right glyph for what happened', () => {
    expect(momentEmote('co_slept')).toBe('heart')
    expect(momentEmote('partnership_dissolved')).toBe('anger') // the crack
    expect(momentEmote('discovery_made')).toBe('idea') // the lit bulb
    expect(momentEmote('law_ratified')).toBe('idea')
    expect(momentEmote('law_repealed')).toBe('exclaim') // the ember mark
    expect(momentEmote('agent_moved')).toBe(null)
  })

  it('★ asks the atlas only for cells it actually has', () => {
    for (const [type, kind] of Object.entries(MOMENT_EMOTE)) {
      expect(EMOTE_KINDS, type).toContain(kind)
    }
  })

  it('★ spawns one per involved body', () => {
    expect(bodiesOf(ev('co_slept', { aId: 'amara', bId: 'yusuf', day: 1 }))).toEqual([
      'amara',
      'yusuf',
    ])
    expect(bodiesOf(ev('discovery_made', { byId: 'omar' }))).toEqual(['omar'])
  })

  it('says something for every moment the cue slot prints, and the other way round', () => {
    for (const type of CUE_TYPES) expect(momentEmote(type), type).not.toBe(null)
  })
})

describe('★ it rises, then fades, and is gone at 1.8 s', () => {
  it('★ is gone after MOMENT_EMOTE_MS', () => {
    expect(MOMENT_EMOTE_MS).toBe(1800)
    expect(emoteRise(MOMENT_EMOTE_MS - 1)).not.toBe(null)
    expect(emoteRise(MOMENT_EMOTE_MS)).toBe(null)
    expect(emoteRise(MOMENT_EMOTE_MS + 500)).toBe(null)
    expect(emoteRise(-1)).toBe(null)
  })

  it('★ climbs on an ease-out — most of the way in the first half of the rise', () => {
    expect(emoteRise(0)?.dy).toBe(-0)
    const half = emoteRise(MOMENT_EMOTE_RISE_MS / 2)!.dy
    expect(half).toBeLessThan(-MOMENT_EMOTE_RISE_PX / 2) // past halfway at half the time
    expect(emoteRise(MOMENT_EMOTE_RISE_MS)?.dy).toBeCloseTo(-MOMENT_EMOTE_RISE_PX)
    // ...and it has settled by the time the fade starts, so nothing fades while still moving
    expect(emoteRise(MOMENT_EMOTE_MS - MOMENT_EMOTE_FADE_MS)?.dy).toBeCloseTo(
      -MOMENT_EMOTE_RISE_PX,
    )
    let last = 1
    for (let t = 0; t < MOMENT_EMOTE_MS; t += 13) {
      const dy = emoteRise(t)!.dy
      expect(dy).toBeLessThanOrEqual(last)
      last = dy
    }
  })

  it('★ fades over the last 600ms and is whole before that', () => {
    expect(MOMENT_EMOTE_FADE_MS).toBe(600)
    expect(emoteRise(0)?.alpha).toBe(1)
    expect(emoteRise(MOMENT_EMOTE_MS - MOMENT_EMOTE_FADE_MS)?.alpha).toBe(1)
    expect(emoteRise(MOMENT_EMOTE_MS - MOMENT_EMOTE_FADE_MS / 2)?.alpha).toBeCloseTo(0.5)
    expect(emoteRise(MOMENT_EMOTE_MS - 1)?.alpha).toBeCloseTo(0, 2)
  })

  it('★ starts clear of the overhead slot, so the two marks can never composite', () => {
    // the slot's own top edge, measured off the slot rather than transcribed
    expect(MOMENT_EMOTE_ABOVE_PX).toBeGreaterThan(CHAR_TARGET_PX + SLOT_ABOVE_HEAD_PX + SLOT_PX)
  })
})

// The layer, driven the way the ticker drives it. No canvas stub: this draws sprites, never text.
describe('★ the layer puts one sprite over each body, and takes them away again', () => {
  function harness(): {
    emit: (ev: SimEvent) => void
    layer: MomentEmoteLayer
    sprites: () => Container[]
  } {
    const overlay = new Container()
    let handler: (evts: SimEvent[]) => void = () => {}
    const scene = {
      layers: { overlay },
      textScale: 1,
      getZoom: () => 1,
      anchorOf: () => ({ x: 0, y: 0 }),
    } as unknown as Scene
    const store = {
      getState: () => ({ agents: { amara: { x: 0, y: 0 }, yusuf: { x: 1, y: 0 } } }),
      onEvents: (fn: (evts: SimEvent[]) => void) => {
        handler = fn
        return () => {}
      },
    } as unknown as WorldStore
    const book = { get: () => Promise.resolve(Texture.EMPTY) } as unknown as TextureBook
    const layer = createMomentEmotes(scene, store, book)
    // the layer parents its marks under one node of its own
    return { emit: (e) => { handler([e]) }, layer, sprites: () => overlay.children[0]!.children }
  }

  it('★ spawns one per involved body, and both are gone after MOMENT_EMOTE_MS', async () => {
    const h = harness()
    await Promise.resolve() // the atlas lands on a microtask
    const at = performance.now()
    h.emit(ev('co_slept', { aId: 'amara', bId: 'yusuf', day: 1 }))
    expect(h.sprites()).toHaveLength(2)

    h.layer.tick(at + MOMENT_EMOTE_MS - 1)
    expect(h.sprites(), 'still standing a millisecond short').toHaveLength(2)
    h.layer.tick(at + MOMENT_EMOTE_MS + 1)
    expect(h.sprites()).toHaveLength(0)
  })

  it('spawns nothing for a moment that wears no glyph', async () => {
    const h = harness()
    await Promise.resolve()
    h.emit(ev('agent_moved', { id: 'amara', x: 1, y: 1 }))
    expect(h.sprites()).toHaveLength(0)
  })
})

// ★ Progress belongs under the word it is about, not on an arch over the head.
describe('★ the act chip carries the progress, and the head carries none', () => {
  const OVERHEAD = src('./overhead.ts')

  it('★ no progress blocks remain in the overhead layer', () => {
    for (const gone of ['TRACK_BLOCKS', 'blockCentres', 'trackFilled', 'setTrack', 'BLOCK_PX']) {
      expect(OVERHEAD, gone).not.toContain(gone)
    }
    expect(src('./characters.ts')).not.toContain('setTrack')
  })

  it('★ the chip gains a one-pixel honey bar under its word', () => {
    const ACTS = src('./acts.ts')
    expect(ACTS).toContain('ACT_BAR_PX')
    expect(ACTS).toContain('barWidth(')
  })
})
