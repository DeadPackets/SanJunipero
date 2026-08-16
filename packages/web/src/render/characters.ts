import { BitmapText, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { depthKey, facingFrom, tileToScreen, type Facing } from './iso.js'
import type { Scene } from './scene.js'
import { characterArt, smoothSource, type TextureBook } from './textures.js'
import {
  CELL, CHAR_TARGET_PX, EMOTE_KINDS, FEET_Y, HIT_AREA_H, HIT_AREA_W, NAME_TAG_ABOVE_HEAD_PX,
  SHEET_COLS, SHEET_ROWS, WALK_FRAME_MS_V4, charPose, emoteFor, interpolatePos,
  nameTagText, prunePath, type Waypoint,
} from './charAnim.js'

export const EMOTE_MS = 2000
export const EMOTE_ABOVE_HEAD_PX = 12
export const SHADOW_ALPHA = 0.25
export const GLIDE_MIN_MS = 200
export const GLIDE_MAX_MS = 4000
export const EMOTE_PX = 16

type CharArt = ReturnType<typeof characterArt>
type Sheet = { art: CharArt; texture: Texture | null }

type CharEntry = {
  sprite: Sprite
  shadow: Sprite
  emote: Sprite
  nameTag: Container
  nameTagBg: Graphics
  nameTagLabel: BitmapText
  emoteUntil: number
  facing: Facing
  path: Waypoint[]
  lastMoveArrival: number
}

export type CharacterLayer = {
  tick(nowMs: number): void
  setEmotesHidden(v: boolean): void
  getSprite(agentId: string): Sprite | null
  destroy(): void
}

// per-source cell cache: v2 placeholder lattice slices AND v4 manifest rect slices
const sliceCache = new WeakMap<Texture, Map<string, Texture>>()
function cached(sheet: Texture, key: string, make: () => Texture): Texture {
  let m = sliceCache.get(sheet)
  if (m === undefined) {
    m = new Map()
    sliceCache.set(sheet, m)
  }
  let t = m.get(key)
  if (t === undefined) {
    t = make()
    m.set(key, t)
  }
  return t
}

// v2 fallback (placeholder sheets, pre-v4 codex sheets): fixed 96px lattice
function sliceV2(sheet: Texture, row: (typeof SHEET_ROWS)[number], facing: Facing): Texture {
  return cached(sheet, `${row}:${facing}`, () => {
    const col = SHEET_COLS.indexOf(facing)
    const rowIdx = SHEET_ROWS.indexOf(row)
    return new Texture({ source: sheet.source, frame: new Rectangle(col * CELL, rowIdx * CELL, CELL, CELL) })
  })
}

// v4 hi-res atlas: manifest rects are the only slicing truth (no lattice)
function sliceV4(atlas: Texture, art: CharArt, row: (typeof SHEET_ROWS)[number], facing: Facing): Texture | null {
  const cell = art.manifest?.cells[`${row}-${facing}`]
  if (cell === undefined) return null
  return cached(atlas, `${row}-${facing}`, () =>
    new Texture({ source: atlas.source, frame: new Rectangle(cell.x, cell.y, cell.w, cell.h) }))
}

export function createCharacterLayer(
  scene: Scene,
  book: TextureBook,
  store: WorldStore,
  onSelect: (agentId: string) => void,
): CharacterLayer {
  const entries = new Map<string, CharEntry>()
  const sheets = new Map<string, Sheet>() // agentId → resolved art + loaded texture
  let lastAssetsSeq = store.assetsSeq()
  let emoteAtlas: Texture | null = null
  let emotesHidden = false
  void book.get('/assets/emotes.png').then((t) => {
    emoteAtlas = t
  })

  const loadSheet = (agentId: string, swapFrom: string | null): void => {
    const art = characterArt(store.assetRecords(), agentId)
    const sheet: Sheet = { art, texture: null }
    sheets.set(agentId, sheet)
    const p = swapFrom !== null && swapFrom !== art.url ? book.swap(swapFrom, art.url) : book.get(art.url)
    void p.then((t) => {
      if (sheets.get(agentId) !== sheet) return // superseded by a newer resolve
      sheet.texture = art.manifest !== null ? smoothSource(t) : t
    })
  }

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
    sprite.cursor = 'pointer'
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
    loadSheet(agentId, null)
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
      const last = e.path[e.path.length - 1]!
      const dx = p.x - last.x
      const dy = p.y - last.y
      if (dx !== 0 || dy !== 0) e.facing = facingFrom(dx, dy)
      const glide = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, now - e.lastMoveArrival))
      e.path.push({ x: p.x, y: p.y, atMs: Math.max(now, last.atMs) + glide })
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
    // hot swap: new codex records re-resolve every character's art in place
    const seq = store.assetsSeq()
    if (seq !== lastAssetsSeq) {
      lastAssetsSeq = seq
      for (const agentId of entries.keys()) {
        const prev = sheets.get(agentId)
        const next = characterArt(store.assetRecords(), agentId)
        if (prev === undefined || prev.art.url !== next.url) loadSheet(agentId, prev?.art.url ?? null)
      }
    }
    const live = new Set<string>()
    for (const a of Object.values(state.agents)) {
      if (!a.alive) continue // the dead leave the map; grave tone is Task 15
      live.add(a.id)
      const e = ensure(a.id, a.x, a.y)
      // scrubbed views teleport: past positions are facts, not animation
      if (!store.getMode().live) {
        e.path = [{ x: a.x, y: a.y, atMs: nowMs }]
      }
      e.path = prunePath(e.path, nowMs)
      const pos = interpolatePos(e.path, nowMs)
      const walking = e.path.length > 1 && nowMs < e.path[e.path.length - 1]!.atMs
      const sheet = sheets.get(a.id)
      const hires = sheet !== undefined && sheet.texture !== null && sheet.art.manifest !== null
      const pose = charPose(
        { asleep: a.asleep, collapsed: a.collapsedSinceTick !== null, walking, facing: e.facing, nowMs },
        hires ? WALK_FRAME_MS_V4 : undefined,
      )
      if (sheet !== undefined && sheet.texture !== null) {
        if (hires) {
          const cell = sheet.art.manifest!.cells[`${pose.row}-${pose.facing}`]
          const t = sliceV4(sheet.texture, sheet.art, pose.row, pose.facing)
          if (t !== null && cell !== undefined) {
            e.sprite.texture = t
            e.sprite.anchor.set(cell.feetX / cell.w, cell.feetY / cell.h) // feet-anchor law
            e.sprite.scale.set(CHAR_TARGET_PX / sheet.art.manifest!.figureH) // smooth downscale to world footprint
          }
        } else {
          e.sprite.texture = sliceV2(sheet.texture, pose.row, pose.facing)
          e.sprite.anchor.set(0.5, FEET_Y / CELL)
          e.sprite.scale.set(CHAR_TARGET_PX / 64)
        }
      }
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
        sheets.delete(agentId)
      }
    }
  }

  return {
    tick,
    setEmotesHidden: (v) => {
      emotesHidden = v
    },
    getSprite: (agentId) => entries.get(agentId)?.sprite ?? null,
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
