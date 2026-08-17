import { Container, Graphics, Polygon, Rectangle, Sprite, Texture } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { WORLD_TEXT_LINE_H, WORLD_TEXT_PX } from '../textFloor.js'
import { bodyDepthBox, type DepthBox } from './depth.js'
import { facingFrom, tileToScreen, type Facing } from './iso.js'
import type { DepthEntry } from './layers.js'
import type { Scene } from './scene.js'
import { HIT_MIN_PX, SHOULDER_W, bodyHitPolygon, inflateToMin } from './hitShapes.js'
import { TAG_PAD_X, TAG_PAD_Y, anchorForSprite, placeTag } from './tooltip.js'
import { characterArt, smoothSource, type TextureBook } from './textures.js'
import { WORLD_FONT_FAMILY, createWorldLabel, type WorldLabel } from './worldLabel.js'
import {
  CELL, CHAR_TARGET_PX, EMOTE_KINDS, FEET_Y, NAME_TAG_ABOVE_HEAD_PX,
  SHEET_COLS, SHEET_ROWS, WALK_FRAME_MS_V4, charPose, emoteFor, interpolatePos,
  legFacing, nameTagText, prunePath, type Waypoint,
} from './charAnim.js'

export const EMOTE_MS = 2000
export const EMOTE_ABOVE_HEAD_PX = 12
export const CHAR_TAG_FONT_PX = WORLD_TEXT_PX
export const CHAR_TAG_LINE_H = WORLD_TEXT_LINE_H
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
  nameTagLabel: WorldLabel
  hit: Polygon
  /** the sheet's own figure height, so the capsule follows the art rather than a second table */
  figureH: number
  hitScale: number
  emoteUntil: number
  facing: Facing
  path: Waypoint[]
  lastMoveArrival: number
  /** the tile the body is standing on RIGHT NOW — interpolated, never rounded (F-3c) */
  box: DepthBox
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

// Who belongs on the TOWN map. The dead leave it (grave tone is Task 15), and so does anyone
// who has gone indoors — C9 gives them an `insideId` and the interior sub-scene draws them
// there. Without this an occupant kept being drawn at the door tile they entered from, which
// is why a founder asleep in the cottage appeared to be asleep on the grass beside it.
export function rendersOnMap(a: { alive: boolean; insideId?: string }): boolean {
  return a.alive && a.insideId === undefined
}

export type CharacterCell = { texture: Texture; anchor: { x: number; y: number }; scale: number }

// One posed cell out of a loaded sheet, feet-anchored and scaled to the world footprint.
// The map layer below inlines this; the interior sub-scene borrows it rather than growing a
// second slicer that could disagree about where a body's feet are.
export function characterCell(
  sheet: Texture, art: CharArt, row: (typeof SHEET_ROWS)[number], facing: Facing,
): CharacterCell | null {
  if (art.manifest === null) {
    return { texture: sliceV2(sheet, row, facing), anchor: { x: 0.5, y: FEET_Y / CELL }, scale: CHAR_TARGET_PX / 64 }
  }
  const cell = art.manifest.cells[`${row}-${facing}`]
  const texture = sliceV4(sheet, art, row, facing)
  if (cell === undefined || texture === null) return null
  return {
    texture,
    anchor: { x: cell.feetX / cell.w, y: cell.feetY / cell.h },
    scale: CHAR_TARGET_PX / art.manifest.figureH,
  }
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

  // Publish where every body is standing. The frame's one owner sorts these against the
  // structures; a body no longer carries an opinion about who is in front of whom.
  scene.addDepthSource(() => {
    const out: DepthEntry[] = []
    for (const e of entries.values()) out.push({ box: e.box, node: e.sprite })
    return out
  })

  // shared 20×8 blob shadow — Graphics-generated once
  const shadowG = new Graphics()
  shadowG.ellipse(10, 4, 10, 4)
  shadowG.fill(0x000000)
  const shadowTexture = scene.app.renderer.generateTexture(shadowG)
  shadowG.destroy()

  // ONE Polygon per entry, its points rewritten in place whenever the applied sprite scale
  // moves. U9: the landed 52×72 rectangle was 2.77× the drawn silhouette's area — it claimed
  // the sky where the name tag sits and reached far enough sideways to steal a neighbour's
  // door. The capsule is 0.93×, and it is inflated only when the figure would otherwise be
  // under HIT_MIN_PX on screen.
  let hitZoom = 1
  const setHitScale = (e: CharEntry, scale: number, figureH: number): void => {
    if (e.hitScale === scale && e.figureH === figureH) return
    e.hitScale = scale
    e.figureH = figureH
    e.hit.points = inflateToMin(bodyHitPolygon(figureH, scale), HIT_MIN_PX, scale * hitZoom)
  }
  // The inflation floor is a SCREEN size, so a zoom change re-cuts every capsule. Cheap: it
  // fires on a camera stop, not on a frame.
  const recutOnZoom = (): void => {
    const zoom = scene.getZoom?.() ?? 1
    if (zoom === hitZoom) return
    hitZoom = zoom
    for (const e of entries.values()) {
      const scale = e.hitScale, figureH = e.figureH
      e.hitScale = 0
      setHitScale(e, scale, figureH)
    }
  }

  const ensure = (agentId: string, x: number, y: number): CharEntry => {
    let e = entries.get(agentId)
    if (e !== undefined) return e
    const sprite = new Sprite()
    sprite.anchor.set(0.5, FEET_Y / CELL)
    sprite.scale.set(CHAR_TARGET_PX / 64)
    sprite.eventMode = 'static'
    sprite.cursor = 'pointer'
    const hit = new Polygon(bodyHitPolygon(64, CHAR_TARGET_PX / 64))
    sprite.hitArea = hit
    sprite.on('pointertap', () => onSelect(agentId))
    const shadow = new Sprite(shadowTexture)
    shadow.anchor.set(0.5, 0.5)
    shadow.alpha = SHADOW_ALPHA
    shadow.eventMode = 'none'
    const emote = new Sprite()
    emote.anchor.set(0.5, 1)
    emote.visible = false
    emote.eventMode = 'none'
    const nameTag = new Container()
    nameTag.visible = false
    nameTag.eventMode = 'none'
    const nameTagBg = new Graphics()
    const nameTagLabel = createWorldLabel('', {
      fontFamily: WORLD_FONT_FAMILY, fontSize: CHAR_TAG_FONT_PX, fill: 0x43394a, lineHeight: CHAR_TAG_LINE_H,
    })
    nameTagLabel.anchor.set(0.5, 1) // match the bg slab, which is drawn centered above the origin
    nameTag.addChild(nameTagBg, nameTagLabel)
    sprite.on('pointerover', () => { nameTag.visible = true })
    sprite.on('pointerout', () => { nameTag.visible = false })
    // each companion to the layer it belongs in: a contact shadow under every body, the
    // emote and the tag over every body. None of them competes with the depth sort any more.
    scene.layers.shadow.addChild(shadow)
    scene.layers.entities.addChild(sprite)
    scene.layers.worldText.addChild(emote, nameTag)
    const now = performance.now()
    e = {
      sprite, shadow, emote, nameTag, nameTagBg, nameTagLabel, hit, figureH: 0, hitScale: 0,
      emoteUntil: 0, facing: 'sw',
      path: [{ x, y, atMs: now }], lastMoveArrival: now, box: bodyDepthBox(agentId, x, y),
    }
    setHitScale(e, CHAR_TARGET_PX / 64, 64)
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
    recutOnZoom()
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
      if (!rendersOnMap(a)) continue
      live.add(a.id)
      const e = ensure(a.id, a.x, a.y)
      // scrubbed views teleport: past positions are facts, not animation
      if (!store.getMode().live) {
        e.path = [{ x: a.x, y: a.y, atMs: nowMs }]
      }
      e.path = prunePath(e.path, nowMs)
      const pos = interpolatePos(e.path, nowMs)
      const walking = e.path.length > 1 && nowMs < e.path[e.path.length - 1]!.atMs
      // while walking, face the current leg; the event-time facing stays as the
      // idle orientation after arrival
      if (walking) e.facing = legFacing(e.path) ?? e.facing
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
            setHitScale(e, CHAR_TARGET_PX / sheet.art.manifest!.figureH, sheet.art.manifest!.figureH)
          }
        } else {
          e.sprite.texture = sliceV2(sheet.texture, pose.row, pose.facing)
          e.sprite.anchor.set(0.5, FEET_Y / CELL)
          e.sprite.scale.set(CHAR_TARGET_PX / 64)
          setHitScale(e, CHAR_TARGET_PX / 64, 64)
        }
      }
      const { sx, sy } = tileToScreen(pos.x, pos.y)
      e.sprite.position.set(sx, sy + pose.bobY)
      e.box = bodyDepthBox(a.id, pos.x, pos.y)
      e.shadow.position.set(sx, sy)
      e.emote.position.set(sx, sy - CHAR_TARGET_PX - EMOTE_ABOVE_HEAD_PX)
      e.emote.visible = !emotesHidden && nowMs < e.emoteUntil && e.emote.texture !== Texture.EMPTY
      const tag = nameTagText(a.name)
      if (e.nameTagLabel.text !== tag) {
        e.nameTagLabel.text = tag
        e.nameTagBg.clear()
        e.nameTagBg.roundRect(-e.nameTagLabel.width / 2 - 4, -e.nameTagLabel.height - 4, e.nameTagLabel.width + 8, e.nameTagLabel.height + 8, 2)
        e.nameTagBg.fill(0xfff6e9)
      }
      // ONE placement rule for every label in the product (U10): above the DRAWN figure,
      // flipped or slid to stay on screen instead of being drawn off the edge of it.
      if (e.nameTag.visible) {
        const size = { w: e.nameTagLabel.width + TAG_PAD_X * 2, h: e.nameTagLabel.height + TAG_PAD_Y * 2 }
        const head = CHAR_TARGET_PX + EMOTE_ABOVE_HEAD_PX + NAME_TAG_ABOVE_HEAD_PX
        const at = placeTag(anchorForSprite({ x: sx, y: sy }, { width: SHOULDER_W, height: head }),
          size, scene.viewRect())
        e.nameTag.position.set(Math.round(at.sx), Math.round(at.sy + size.h))
      }
    }
    for (const [agentId, e] of entries) {
      if (!live.has(agentId)) {
        e.sprite.destroy()
        e.shadow.destroy()
        e.emote.destroy()
        e.nameTag.destroy({ children: true })
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
        e.nameTag.destroy({ children: true })
      }
      entries.clear()
      shadowTexture.destroy(true)
    },
  }
}
