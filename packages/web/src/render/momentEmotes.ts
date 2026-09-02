import { Container, Rectangle, Sprite, Texture } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { bodiesOf } from '../ui/stageCue.js'
import { CHAR_TARGET_PX, EMOTE_KINDS, type EmoteKind } from './charAnim.js'
import { GLYPH_PX, SLOT_ABOVE_HEAD_PX, SLOT_PX } from './overhead.js'
import { artOptional, type TextureBook } from './textures.js'
import { worldTextScale } from './textFaces.js'
import { tileToScreen } from './iso.js'
import type { Scene } from './scene.js'

// ★ SOMETHING HAPPENED TO THIS PERSON. A pixel rises off the head of everybody a moment belongs
// to and is gone in under two seconds — the one mark on the stage that says a thing was achieved
// rather than a thing is being done.

/** The whole life of one rising mark. */
export const MOMENT_EMOTE_MS = 1800
/** It climbs for the first two thirds and settles, so the fade lands on a mark that has stopped. */
export const MOMENT_EMOTE_RISE_MS = 1200
export const MOMENT_EMOTE_FADE_MS = 600
export const MOMENT_EMOTE_RISE_PX = 10

/** Clear of the overhead slot's own top edge, so the rising mark and the slot's one glyph can
 *  never composite. Derived from the slot, not transcribed. */
export const MOMENT_EMOTE_ABOVE_PX = CHAR_TARGET_PX + SLOT_ABOVE_HEAD_PX + SLOT_PX + 4

/** Which pixel a moment wears. A heart for a bond gained, the crack for one lost, the lit bulb
 *  for anything the town worked out or wrote down, and the ember mark for a ruling it undid. */
export const MOMENT_EMOTE: Readonly<Record<string, EmoteKind>> = {
  co_slept: 'heart',
  partnership_formed: 'heart',
  partnership_dissolved: 'anger',
  discovery_made: 'idea',
  law_proposed: 'idea',
  law_ratified: 'idea',
  law_broken: 'exclaim',
  law_repealed: 'exclaim',
}

export function momentEmote(type: string): EmoteKind | null {
  return MOMENT_EMOTE[type] ?? null
}

/** Where a mark is and how solid, `ageMs` after it was spawned; null once it is done. */
export function emoteRise(ageMs: number): { dy: number; alpha: number } | null {
  if (ageMs < 0 || ageMs >= MOMENT_EMOTE_MS) return null
  const climb = Math.min(1, ageMs / MOMENT_EMOTE_RISE_MS)
  const eased = 1 - (1 - climb) * (1 - climb) * (1 - climb)
  const fadeFrom = MOMENT_EMOTE_MS - MOMENT_EMOTE_FADE_MS
  const fade = Math.max(0, ageMs - fadeFrom) / MOMENT_EMOTE_FADE_MS
  return { dy: -eased * MOMENT_EMOTE_RISE_PX, alpha: 1 - fade }
}

export type MomentEmoteLayer = { tick(nowMs: number): void; destroy(): void }

type Mark = { agentId: string; sprite: Sprite; bornMs: number }

/** One rising pixel per body a moment belonged to. Drawn in world space over the entities, so it
 *  scales and moves with the town the way every other mark over a head does. */
export function createMomentEmotes(
  scene: Scene,
  store: WorldStore,
  book: TextureBook,
): MomentEmoteLayer {
  const node = new Container()
  node.eventMode = 'none'
  scene.layers.overlay.addChild(node)
  const marks: Mark[] = []
  let atlas: Texture | null = null
  void book.get('/assets/emotes.png').then((t) => {
    atlas = t
  }, artOptional)

  const cellOf = (kind: EmoteKind): Texture | null => {
    const cell = EMOTE_KINDS.indexOf(kind)
    // A cell the sheet has no glyph for draws nothing, never the forge's checkerboard.
    if (cell < 0 || atlas === null) return null
    return new Texture({
      source: atlas.source,
      frame: new Rectangle(cell * GLYPH_PX, 0, GLYPH_PX, GLYPH_PX),
    })
  }

  const spawn = (ev: SimEvent, nowMs: number): void => {
    const kind = momentEmote(ev.type)
    if (kind === null) return
    const texture = cellOf(kind)
    if (texture === null) return
    for (const agentId of bodiesOf(ev)) {
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5, 1)
      sprite.width = GLYPH_PX
      sprite.height = GLYPH_PX
      sprite.eventMode = 'none'
      node.addChild(sprite)
      marks.push({ agentId, sprite, bornMs: nowMs })
    }
  }

  const offEvents = store.onEvents((evts) => {
    const nowMs = performance.now()
    for (const ev of evts) spawn(ev, nowMs)
  })

  return {
    tick: (nowMs) => {
      if (marks.length === 0) return
      const inv = worldTextScale(scene.getZoom()) * scene.textScale
      const state = store.getState()
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i]!
        const at = emoteRise(nowMs - m.bornMs)
        const a = state?.agents[m.agentId]
        if (at === null || a === undefined) {
          m.sprite.destroy()
          marks.splice(i, 1)
          continue
        }
        const anchor = scene.anchorOf?.(m.agentId) ?? null
        const { sx, sy } = anchor === null ? tileToScreen(a.x, a.y) : { sx: anchor.x, sy: anchor.y }
        m.sprite.scale.set(inv) // the reader's size, not the camera's — like every mark over a head
        m.sprite.alpha = at.alpha
        m.sprite.position.set(Math.round(sx), Math.round(sy - MOMENT_EMOTE_ABOVE_PX + at.dy))
      }
    },
    destroy: () => {
      offEvents()
      node.destroy({ children: true })
      marks.length = 0
    },
  }
}
