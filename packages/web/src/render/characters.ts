import { Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { depthKey, facingFrom, tileToScreen, type Facing } from './iso.js'
import type { Scene } from './scene.js'
import type { TextureBook } from './textures.js'
import { CELL, CHAR_TARGET_PX, EMOTE_KINDS, FEET_Y, SHEET_COLS, SHEET_ROWS, charPose, emoteFor, interpolatePos } from './charAnim.js'

export const EMOTE_MS = 2000
export const EMOTE_ABOVE_HEAD_PX = 12
export const SHADOW_ALPHA = 0.25
export const GLIDE_MIN_MS = 200
export const GLIDE_MAX_MS = 4000
export const EMOTE_PX = 16

type CharEntry = {
  sprite: Sprite
  shadow: Sprite
  emote: Sprite
  emoteUntil: number
  facing: Facing
  prev: { x: number; y: number; atMs: number }
  next: { x: number; y: number; atMs: number }
  lastMoveArrival: number
}

export type CharacterLayer = {
  tick(nowMs: number): void
  setEmotesHidden(v: boolean): void
  destroy(): void
}

// 24 slices per sheet, cached per source texture
const sliceCache = new WeakMap<Texture, Map<string, Texture>>()
function slice(sheet: Texture, row: (typeof SHEET_ROWS)[number], facing: Facing): Texture {
  let m = sliceCache.get(sheet)
  if (m === undefined) {
    m = new Map()
    sliceCache.set(sheet, m)
  }
  const key = `${row}:${facing}`
  let t = m.get(key)
  if (t === undefined) {
    const col = SHEET_COLS.indexOf(facing)
    const rowIdx = SHEET_ROWS.indexOf(row)
    t = new Texture({ source: sheet.source, frame: new Rectangle(col * CELL, rowIdx * CELL, CELL, CELL) })
    m.set(key, t)
  }
  return t
}

export function createCharacterLayer(
  scene: Scene,
  book: TextureBook,
  store: WorldStore,
  onSelect: (agentId: string) => void,
): CharacterLayer {
  const entries = new Map<string, CharEntry>()
  const sheets = new Map<string, Texture>() // agentId → loaded sheet
  let emoteAtlas: Texture | null = null
  let emotesHidden = false
  void book.get('/assets/emotes.png').then((t) => {
    emoteAtlas = t
  })

  // shared 20×8 blob shadow — Graphics-generated once
  const shadowG = new Graphics()
  shadowG.ellipse(10, 4, 10, 4)
  shadowG.fill(0x000000)
  const shadowTexture = scene.app.renderer.generateTexture(shadowG)
  shadowG.destroy()

  const ensure = (agentId: string, x: number, y: number): CharEntry => {
    let e = entries.get(agentId)
    if (e !== undefined) return e
    const sprite = new Sprite()
    sprite.anchor.set(0.5, FEET_Y / CELL)
    sprite.scale.set(CHAR_TARGET_PX / 64)
    sprite.eventMode = 'static'
    sprite.on('pointertap', () => onSelect(agentId))
    const shadow = new Sprite(shadowTexture)
    shadow.anchor.set(0.5, 0.5)
    shadow.alpha = SHADOW_ALPHA
    const emote = new Sprite()
    emote.anchor.set(0.5, 1)
    emote.visible = false
    scene.entities.addChild(shadow, sprite, emote)
    const now = performance.now()
    e = {
      sprite, shadow, emote, emoteUntil: 0, facing: 'sw',
      prev: { x, y, atMs: now }, next: { x, y, atMs: now }, lastMoveArrival: now,
    }
    entries.set(agentId, e)
    void book.get(`/assets/character/${agentId}.png`).then((t) => {
      sheets.set(agentId, t)
    })
    return e
  }

  const offEvents = store.onEvents((evts: SimEvent[]) => {
    const state = store.getState()
    if (state === null) return
    const now = performance.now()
    for (const ev of evts) {
      if (ev.type !== 'agent_moved') continue
      const p = ev.payload as { id: string; x: number; y: number }
      const e = entries.get(p.id)
      if (e === undefined) continue
      const cur = interpolatePos(e.prev, e.next, now)
      const glide = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, now - e.lastMoveArrival))
      const dx = p.x - e.next.x
      const dy = p.y - e.next.y
      if (dx !== 0 || dy !== 0) e.facing = facingFrom(dx, dy)
      e.prev = { x: cur.x, y: cur.y, atMs: now }
      e.next = { x: p.x, y: p.y, atMs: now + glide }
      e.lastMoveArrival = now
    }
    // emote triggers ride the same delta batches (one batch per tick)
    for (const [agentId, e] of entries) {
      const a = state.agents[agentId]
      if (a === undefined) continue
      const kind = emoteFor(a, evts)
      if (kind !== null && emoteAtlas !== null) {
        e.emote.texture = new Texture({ source: emoteAtlas.source, frame: new Rectangle(EMOTE_KINDS.indexOf(kind) * EMOTE_PX, 0, EMOTE_PX, EMOTE_PX) })
        e.emoteUntil = now + EMOTE_MS
      }
    }
  })

  const tick = (nowMs: number): void => {
    const state = store.getState()
    if (state === null) return
    const live = new Set<string>()
    for (const a of Object.values(state.agents)) {
      if (!a.alive) continue // the dead leave the map; grave tone is Task 15
      live.add(a.id)
      const e = ensure(a.id, a.x, a.y)
      // scrubbed views teleport: past positions are facts, not animation
      if (!store.getMode().live) {
        e.prev = { x: a.x, y: a.y, atMs: nowMs }
        e.next = { x: a.x, y: a.y, atMs: nowMs }
      }
      const pos = interpolatePos(e.prev, e.next, nowMs)
      const walking = nowMs < e.next.atMs && (e.next.x !== e.prev.x || e.next.y !== e.prev.y)
      const pose = charPose({ asleep: a.asleep, collapsed: a.collapsedSinceTick !== null, walking, facing: e.facing, nowMs })
      const sheet = sheets.get(a.id)
      if (sheet !== undefined) e.sprite.texture = slice(sheet, pose.row, pose.facing)
      const { sx, sy } = tileToScreen(pos.x, pos.y)
      e.sprite.position.set(sx, sy + pose.bobY)
      e.sprite.zIndex = depthKey(Math.round(pos.x), Math.round(pos.y)) + 1
      e.shadow.position.set(sx, sy)
      e.shadow.zIndex = e.sprite.zIndex - 1
      e.emote.position.set(sx, sy - CHAR_TARGET_PX - EMOTE_ABOVE_HEAD_PX)
      e.emote.zIndex = e.sprite.zIndex + 1
      e.emote.visible = !emotesHidden && nowMs < e.emoteUntil && e.emote.texture !== Texture.EMPTY
    }
    for (const [agentId, e] of entries) {
      if (!live.has(agentId)) {
        e.sprite.destroy()
        e.shadow.destroy()
        e.emote.destroy()
        entries.delete(agentId)
      }
    }
  }

  return {
    tick,
    setEmotesHidden: (v) => {
      emotesHidden = v
    },
    destroy: () => {
      offEvents()
      for (const e of entries.values()) {
        e.sprite.destroy()
        e.shadow.destroy()
        e.emote.destroy()
      }
      entries.clear()
      shadowTexture.destroy(true)
    },
  }
}
