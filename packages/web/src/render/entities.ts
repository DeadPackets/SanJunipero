import { Graphics, Polygon, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js'
import { isRoofedKind, type SimConfig } from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { hoverPlate, type HoverKind } from '../ui/interaction.js'
import { BUILT_FORM_UNIT_PX, builtFormSpec, drawBuiltForm, footprintDiamond } from './builtForm.js'
import { structureDepthBox, tileDepthBox } from './depth.js'
import { depthKey, feetOf } from './iso.js'
import type { DepthEntry } from './layers.js'
import { HIT_MIN_PX, artPrismPolygon, extrudeDiamond, inflateToMin } from './hitShapes.js'
import { anchorForSprite } from './tooltip.js'
import type { Scene } from './scene.js'
import {
  LOAD_PRIORITY,
  TextureBook,
  artOptional,
  buildingArt,
  dressDelay,
  fadeArtIn,
  openBoot,
  textureUrlFor,
  type BuildingArt,
} from './textures.js'
import { contactShadow } from './interiors.js'
import { contactAo, GROUND_SHADOW_INK, sunCast, type GroundMark } from './groundShadow.js'
import { SHADOW_REST, type ShadowCast } from '../ui/skyModel.js'

export { BUILDING_PX_PER_TILE } from './textures.js'

export const CONSTRUCTION_TINT = 0xcfc6bc
export const WITHERED_TINT = 0x857d75
/** Two derivations that had to agree: 128 / 4 puts the deepest zoom stop at 1:1, and (1+1) half-tiles of a 32 px tile is the world span an item stands on. `drawScale.test.ts` holds both. */
export const ITEM_PX = 32
export const CROP_SCALE_BASE = 0.4
export const CROP_SCALE_PER_STAGE = 0.15
export const PIP_COUNT = 4
export const PIP_COLOR = 0xf2c879
/** The fallback denominator, for the frames before the snapshot's config has arrived. It is
 *  `DEFAULT_CONFIG.construction.houseTicks` and it is NOT the authority — see `pipsFilled`. */
export const BUILD_TICKS_FULL = 2880

/** `houseTicks` comes off the snapshot the viewer already holds, so the meter measures the build the world is actually running; a non-positive or absent figure falls back. */
export function pipsFilled(progressTicks: number, houseTicks: number | undefined): number {
  const full = houseTicks !== undefined && houseTicks > 0 ? houseTicks : BUILD_TICKS_FULL
  return Math.max(0, Math.min(PIP_COUNT, Math.floor((progressTicks / full) * PIP_COUNT)))
}

/** Ask the kind, never a roster: a roster says which names somebody remembered, and it goes wrong the moment the world grows a new one. */
export function enterableKind(config: SimConfig | null, kind: string): boolean {
  return config !== null && isRoofedKind(config, kind)
}

/** Whether clicking this building walks into it. A shell still going up has no room to walk
 *  into, and a well has no room at all — both answer with their story instead. */
export function entersOnClick(
  config: SimConfig | null,
  state: WorldState | null,
  structureId: string,
): boolean {
  const s = state?.structures[structureId]
  return s?.stage === 'complete' && enterableKind(config, s.kind)
}

export function doorTileOf(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } {
  return { x: s.x + ((s.w - 1) >> 1), y: s.y + s.h - 1 }
}

/** NOT the painter's order — depth.ts owns that; kept as the before-state its tests measure. */
export function structureZIndex(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): number {
  return depthKey(s.x + s.w - 1, s.y + s.h - 1)
}

/** NOT a hit area — the BASE of the hit prism, the shape `builtForm` cuts its plinth from. */
export function footprintHitPoints(w: number, h: number, scale = 1): number[] {
  const k = scale === 0 ? 1 : scale
  return footprintDiamond(w, h).map((v) => v / k)
}

/** The hitbox of the structure itself, in the sprite's local space — the drawn cell's footprint swept up its own height, or the built form's plinth and volume when there is no art.
 *  The 24 px floor is a SCREEN size, so the shape is re-cut when the camera scale moves. */
export function structureHitPoints(
  kind: string,
  w: number,
  h: number,
  scale: number,
  zoom = 1,
  hasArt = true,
): number[] {
  const k = scale === 0 ? 1 : scale
  const local = hasArt
    ? artPrismPolygon(w, h, k)
    : extrudeDiamond(footprintDiamond(w, h), builtFormSpec(kind, w, h).heightPx).map((v) => v / k)
  return inflateToMin(local, HIT_MIN_PX, k * (zoom > 0 ? zoom : 1))
}

/** What a structure lays on the ground: the ring where it meets the tile, and the sun's cast
 *  out of it. Cut from what is DRAWN — art is twice its plan across, the south vertex on the
 *  feet point (`artPrismPolygon`) — because a shadow is drawn art and follows the pixels. */
export function structureMarks(
  kind: string,
  w: number,
  h: number,
  hasArt: boolean,
  sun: ShadowCast,
): GroundMark[] {
  const side = (w + h) * BUILT_FORM_UNIT_PX
  const stands = hasArt
    ? [0, -side / 2, side / 2, -side / 4, 0, 0, -side / 2, -side / 4]
    : footprintDiamond(w, h)
  const heightPx = hasArt ? side / 2 : builtFormSpec(kind, w, h).heightPx
  const marks = [contactAo(stands)]
  // No direction, no cast: at noon and all night the mark is the footprint itself, which the
  // thing standing on it hides.
  if (sun.dx !== 0) marks.push(sunCast(stands, heightPx, sun))
  return marks
}

type Entry = {
  sprite: Sprite
  url: string
  pips: Graphics | null
  /** the palette-true stand-in a drawable shows while it has no art of its own */
  form: Graphics | null
  /** whether real art has ever been written to this sprite, NOT whether art exists */
  dressed: boolean
  /** the ground this thing marks: a dropped thing's contact, a structure's ring and cast */
  shadow: Graphics | null
  /** the kind and ground plan the hit prism is cut from */
  kind: string
  footprint: { w: number; h: number }
  /** the camera scale this prism was last cut for — the 24 px floor is a SCREEN size */
  hitZoom: number
  /** the ground this drawable stands on, rewritten every sync inside the one entry this
   *  drawable publishes to the frame's depth sort */
  depth: DepthEntry
  /** the scale this layer owns, and the multiplier an effect is holding over it */
  base: number
  mul: number
}

/** `entry.url` for a structure whose kind has no art at all — never a real url, so the
 *  hot-load path re-resolves it exactly once, when the art finally lands. */
const NO_ART = ''
export type WorldPick = {
  kind: 'structure' | 'item' | 'crop'
  id: string
  screenX: number
  screenY: number
}

type SyncState = {
  entries: Map<string, Entry>
  lastAssetsSeq: number
  onDoor: ((structureId: string) => void) | null
  onPick: ((pick: WorldPick) => void) | null
  /** the camera scale every structure prism was last cut for */
  hitZoom: number
  /** the sun every structure's ground mark was last cut for */
  cast: ShadowCast
}
const syncStates = new WeakMap<Scene, SyncState>()

/** Where a drawable stands relative to the shot: what it is worth to the loader, and how long
 *  its art waits before it fades up. */
type Load = { priority: number; delayMs: number }

/** A thing on the ground with no art of its own draws a palette-true chip at the size the art
 *  would be. The forge's checkerboard reads as broken. This reads as not painted yet. */
const CHIP_PX = 16

function drawItemChip(g: Graphics, kind: string): void {
  const { faces, ink } = builtFormSpec(kind, 1, 1)
  const half = CHIP_PX / 2
  g.clear()
  g.rect(-half, -CHIP_PX, CHIP_PX, CHIP_PX * 0.68)
  g.fill(faces[2].color)
  g.rect(-half, -CHIP_PX * 0.32, CHIP_PX, CHIP_PX * 0.32)
  g.fill(faces[0].color)
  g.rect(-half, -CHIP_PX, CHIP_PX, CHIP_PX)
  g.stroke({ width: 1, color: ink, alignment: 0.5 })
}

/** The stand-in every drawable wears while its art is in flight or missing. A child of the
 *  sprite, so it inherits depth, position and tint, and it goes the moment real art arrives. */
function standIn(entry: Entry, draw: (g: Graphics) => void): void {
  if (entry.form === null) {
    entry.form = new Graphics()
    entry.form.eventMode = 'none' // the volume is a picture; the sprite owns the pointer
    entry.sprite.addChild(entry.form)
  }
  draw(entry.form)
}

function clearStandIn(entry: Entry): void {
  if (entry.form === null) return
  entry.form.destroy()
  entry.form = null
}

function landItem(entry: Entry, t: Texture): void {
  entry.sprite.texture = t
  entry.dressed = true
  clearStandIn(entry)
  // A shadow is what marks the entries drawn to a common longest side: the dropped things.
  if (entry.shadow !== null) fitItem(entry, t)
}

function setTexture(book: TextureBook, entry: Entry, url: string | null, load: Load): void {
  entry.url = url ?? NO_ART
  const inHand = url === null ? null : book.peek(url)
  if (inHand !== null) {
    landItem(entry, inHand)
    return
  }
  // The same tier whether the art is missing or merely in flight: a chip the palette owns, at
  // the size the art will be, and the contact that stops it reading as a floating sticker.
  standIn(entry, (g) => {
    drawItemChip(g, entry.kind)
  })
  if (entry.shadow !== null) drawItemShadow(entry.shadow, CHIP_PX)
  if (url === null) return
  void book.get(url, load.priority).then((t) => {
    if (entry.url !== url || entry.sprite.destroyed) return
    landItem(entry, t)
    fadeArtIn(entry.sprite, load.delayMs)
  }, artOptional)
}

// v4 hi-res buildings anchor at the manifest feet point and downscale smoothly to the
// footprint diamond; v2/placeholder art keeps the bottom-center anchor at natural size.
function applyBuildingArt(
  book: TextureBook,
  entry: Entry,
  art: BuildingArt,
  swapFrom: string | null,
  footprint: { w: number; h: number },
  kind: string,
  load: Load,
): void {
  const volume = (g: Graphics): void => {
    drawBuiltForm(g, builtFormSpec(kind, footprint.w, footprint.h))
  }
  // No art in any root: the built form IS the building, not a stand-in for one.
  if (art.url === null) {
    entry.url = NO_ART
    entry.sprite.texture = Texture.EMPTY
    entry.sprite.anchor.set(0.5, 1.0)
    writeScale(entry, 1)
    cutHitPrism(entry)
    standIn(entry, volume)
    return
  }
  entry.url = art.url
  // The manifest's scale is known NOW, so the prism is cut now: a building is clickable at its
  // real shape from the frame it appears, not a texture round trip later.
  cutHitPrism(entry, entry.hitZoom, art.scale ?? 1)
  const land = (t: Texture, fade: boolean): void => {
    entry.sprite.texture = t
    entry.dressed = true
    clearStandIn(entry)
    if (art.anchor !== null) entry.sprite.anchor.set(art.anchor.x, art.anchor.y)
    else entry.sprite.anchor.set(0.5, 1.0)
    writeScale(entry, art.scale ?? 1)
    cutHitPrism(entry) // the prism is scaled with the sprite, so a new scale re-cuts it
    if (fade) fadeArtIn(entry.sprite, load.delayMs)
  }
  const inHand = book.peek(art.url)
  if (inHand !== null) {
    land(inHand, false) // already in the book: nothing arrives, so nothing fades
    return
  }
  // A building whose art has not landed draws its own volume rather than a hole. This is the
  // one tier for the whole product: a stand-in, never an empty sprite and never a checkerboard.
  if (!entry.dressed) standIn(entry, volume)
  const swapping = swapFrom !== null && swapFrom !== art.url
  const p = swapping ? book.swap(swapFrom, art.url) : book.get(art.url, load.priority)
  void p.then((t) => {
    if (entry.url !== art.url || entry.sprite.destroyed) return // superseded or torn down mid-load
    land(t, true) // finish line 8: art arrives, it does not pop in, first load included
  }, artOptional)
}

/** Items are drawn to a common LONGEST side, so a plank stays a plank: a forced 32x32 made
 *  every dropped thing the same square block. */
export function itemScaleFor(w: number, h: number): number {
  return ITEM_PX / Math.max(1, w, h)
}

function fitItem(entry: Entry, t: Texture): void {
  const k = itemScaleFor(t.width, t.height)
  writeScale(entry, k)
  if (entry.shadow !== null) drawItemShadow(entry.shadow, t.width * k)
}

function paintMarks(sync: SyncState, entry: Entry): void {
  const g = entry.shadow
  if (g === null) return
  const { w, h } = entry.footprint
  g.clear()
  for (const m of structureMarks(entry.kind, w, h, entry.url !== NO_ART, sync.cast)) {
    g.poly(m.poly)
    g.fill({ color: GROUND_SHADOW_INK, alpha: m.alpha })
  }
}

/** The sun this frame, for everything that is not a body. `characters.ts` writes the same cast
 *  onto the bodies off the same `shadowCast` and the same tick, so the two cannot disagree. */
export function setSunCast(scene: Scene, cast: ShadowCast): void {
  const sync = syncStates.get(scene)
  if (sync === undefined) return
  sync.cast = cast
  for (const [key, entry] of sync.entries) if (key.startsWith('structure:')) paintMarks(sync, entry)
}

function drawItemShadow(g: Graphics, widthPx: number): void {
  const s = contactShadow(widthPx)
  g.clear()
  g.ellipse(0, 0, s.rx, s.ry)
  g.fill({ color: 0x000000, alpha: s.alpha })
}

function writeScale(entry: Entry, base: number): void {
  entry.base = base
  entry.sprite.scale.set(base * entry.mul)
}

/** An effect publishes a multiplier and the owner applies it, so art landing mid-effect is not
 *  reverted when the effect ends. False when the subject is gone and the effect should stop. */
export function setEntityScaleMul(
  scene: Scene,
  kind: WorldPick['kind'],
  id: string,
  k: number,
): boolean {
  const entry = syncStates.get(scene)?.entries.get(`${kind}:${id}`)
  if (entry === undefined) return false
  entry.mul = k
  entry.sprite.scale.set(entry.base * k)
  return true
}

/** Re-cut the structure's hit prism: on the art's scale landing, on a footprint change and on the camera settling at a new zoom — never per frame. */
function cutHitPrism(entry: Entry, zoom = entry.hitZoom, scale = entry.sprite.scale.x || 1): void {
  entry.hitZoom = zoom
  const { w, h } = entry.footprint
  entry.sprite.hitArea = new Polygon(
    structureHitPoints(entry.kind, w, h, scale, zoom, entry.url !== NO_ART),
  )
}

function drawPips(g: Graphics, filled: number): void {
  g.clear()
  for (let i = 0; i < PIP_COUNT; i++) {
    g.rect(i * 6 - (PIP_COUNT * 6 - 2) / 2, 0, 4, 4)
    g.fill({ color: PIP_COLOR, alpha: i < filled ? 1 : 0.25 })
  }
}

export function entitySpriteOf(scene: Scene, kind: WorldPick['kind'], id: string): Sprite | null {
  return syncStates.get(scene)?.entries.get(`${kind}:${id}`)?.sprite ?? null
}

// diff-based sync, called once per store change
export function syncEntities(
  scene: Scene,
  book: TextureBook,
  store: WorldStore,
  onDoor?: (structureId: string) => void,
  onPick?: (pick: WorldPick) => void,
): void {
  const state = store.getState()
  if (state === null) return
  let sync = syncStates.get(scene)
  if (sync === undefined) {
    sync = {
      entries: new Map(),
      lastAssetsSeq: store.assetsSeq(),
      onDoor: null,
      onPick: null,
      hitZoom: scene.getZoomStop(),
      cast: SHADOW_REST,
    }
    syncStates.set(scene, sync)
    // The 24 px floor is a SCREEN size and the 0.25 overview stop makes it live, so every prism
    // is re-cut when the camera settles — not on a world tick and not per frame.
    const cut = sync
    scene.onCamera(() => {
      const z = scene.getZoomStop()
      if (z === cut.hitZoom) return
      cut.hitZoom = z
      // Items and crops are in this map too and take Pixi's own sprite bounds; only a
      // structure carries a prism.
      for (const [key, e] of cut.entries) if (key.startsWith('structure:')) cutHitPrism(e, z)
    })
    // Publish the ground every structure, item and crop stands on. One owner sorts the whole
    // frame from these; nothing here writes a depth of its own.
    const published = sync
    const out: DepthEntry[] = []
    scene.addDepthSource(() => {
      out.length = 0
      for (const e of published.entries.values()) out.push(e.depth)
      return out
    })
  }
  if (onDoor !== undefined) sync.onDoor = onDoor
  if (onPick !== undefined) sync.onPick = onPick
  const tags = scene.tags

  // Everything on the map answers to the pointer: hover names it, click tells its story.
  const nameOnHover = (sprite: Sprite, kind: HoverKind, id: string): void => {
    sprite.eventMode = 'static'
    sprite.cursor = 'pointer'
    sprite.on('pointerover', () => {
      // the anchor comes from the sprite's DRAWN size — `getLocalBounds` is the texture BEFORE
      // the sprite's own scale, so a 1.85× building's plate stranded itself beside the roof
      tags.show(
        'hover',
        hoverPlate(store.getState(), kind, id, id === scene.pickedId),
        anchorForSprite(sprite, { width: sprite.width, height: sprite.height }),
      )
    })
    sprite.on('pointerout', () => {
      tags.hide('hover')
    })
  }
  const records = store.assetRecords()
  // What art exists, before a sprite asks for a byte of it.
  openBoot(records)
  const live = new Set<string>()

  // The loader never saw the camera, so an off-screen crop raced the house in the middle of the
  // shot. It is the same rect the scene hands the tooltip layer and the ground baker.
  const view = scene.viewRect()
  const midX = view.x + view.w / 2
  const midY = view.y + view.h / 2
  const span = Math.hypot(view.w, view.h) / 2
  const loadAt = (sx: number, sy: number): Load => ({
    priority:
      sx >= view.x && sx <= view.x + view.w && sy >= view.y && sy <= view.y + view.h
        ? LOAD_PRIORITY.near
        : LOAD_PRIORITY.far,
    delayMs: dressDelay(Math.hypot(sx - midX, sy - midY), span),
  })

  for (const s of Object.values(state.structures)) {
    const key = `structure:${s.id}`
    live.add(key)
    const ground = feetOf(s.x, s.y, s.w, s.h)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0) // bottom-center pinned to the ground point (manifest law)
      const sid = s.id
      nameOnHover(sprite, 'structure', sid)
      // One target, two meanings: an enterable complete building goes in, anything else answers
      // with its story. The hover tag says which before the click is made.
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        if (entersOnClick(store.getConfig(), store.getState(), sid)) {
          sync.onDoor?.(sid)
          return
        }
        sync.onPick?.({ kind: 'structure', id: sid, screenX: e.client.x, screenY: e.client.y })
      })
      // The ground a building marks is not the building: it outlives the stand-in, so a
      // structure that gets art keeps its ring and its cast.
      const marks = new Graphics()
      marks.eventMode = 'none'
      scene.layers.shadow.addChild(marks)
      entry = {
        sprite,
        url: '',
        pips: null,
        form: null,
        dressed: false,
        shadow: marks,
        kind: s.kind,
        footprint: { w: s.w, h: s.h },
        hitZoom: sync.hitZoom,
        depth: { box: structureDepthBox(key, s), node: sprite },
        base: 1,
        mul: 1,
      }
      sync.entries.set(key, entry)
      scene.layers.entities.addChild(sprite)
      // This is what cuts the prism — both of its branches do, and there is no frame between
      // the sprite existing and the shape being right.
      applyBuildingArt(
        book,
        entry,
        buildingArt(records, s.kind, s.w, s.h, s.facing),
        null,
        s,
        s.kind,
        loadAt(ground.sx, ground.sy),
      )
      paintMarks(sync, entry)
    }
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.shadow?.position.set(ground.sx, ground.sy)
    entry.depth.box = structureDepthBox(key, s)
    if (s.stage === 'construction') {
      entry.sprite.tint = CONSTRUCTION_TINT
      if (entry.pips === null) {
        entry.pips = new Graphics()
        entry.sprite.addChild(entry.pips)
      }
      // children inherit the sprite scale — counter-scale so pips stay screen-sized under hi-res downscale
      const k = entry.sprite.scale.x || 1
      entry.pips.scale.set(1 / k)
      entry.pips.position.set(0, 6 / k)
      drawPips(entry.pips, pipsFilled(s.progressTicks, store.getConfig()?.construction.houseTicks))
    } else {
      entry.sprite.tint = 0xffffff
      if (entry.pips !== null) {
        entry.pips.destroy()
        entry.pips = null
      }
    }

    // A building that has changed shape or kind is a building whose prism is out of date.
    if (entry.footprint.w !== s.w || entry.footprint.h !== s.h || entry.kind !== s.kind) {
      entry.footprint = { w: s.w, h: s.h }
      entry.kind = s.kind
      cutHitPrism(entry, sync.hitZoom)
      paintMarks(sync, entry)
    }
  }

  for (const it of Object.values(state.items)) {
    if (it.loc.t !== 'tile') continue
    const key = `item:${it.id}`
    live.add(key)
    const ground = feetOf(it.loc.x, it.loc.y)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0)
      const iid = it.id
      nameOnHover(sprite, 'item', iid)
      // A thing on the ground needs the same contact a body gets, or it reads as floating.
      const shadow = new Graphics()
      shadow.eventMode = 'none'
      scene.layers.shadow.addChild(shadow)
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        sync.onPick?.({ kind: 'item', id: iid, screenX: e.client.x, screenY: e.client.y })
      })
      entry = {
        sprite,
        url: '',
        pips: null,
        form: null,
        dressed: false,
        shadow,
        kind: it.kind,
        footprint: { w: 1, h: 1 },
        hitZoom: 1,
        depth: { box: tileDepthBox(key, it.loc.x, it.loc.y, ITEM_PX), node: sprite },
        base: 1,
        mul: 1,
      }
      sync.entries.set(key, entry)
      scene.layers.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'item', it.kind), loadAt(ground.sx, ground.sy))
    }
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.shadow?.position.set(ground.sx, ground.sy)
    entry.depth.box = tileDepthBox(key, it.loc.x, it.loc.y, ITEM_PX)
  }

  for (const c of Object.values(state.crops)) {
    const key = `crop:${c.id}`
    live.add(key)
    const ground = feetOf(c.x, c.y)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0)
      const cid = c.id
      nameOnHover(sprite, 'crop', cid)
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        sync.onPick?.({ kind: 'crop', id: cid, screenX: e.client.x, screenY: e.client.y })
      })
      entry = {
        sprite,
        url: '',
        pips: null,
        form: null,
        dressed: false,
        shadow: null,
        kind: c.kind,
        footprint: { w: 1, h: 1 },
        hitZoom: 1,
        depth: { box: tileDepthBox(key, c.x, c.y), node: sprite },
        base: 1,
        mul: 1,
      }
      sync.entries.set(key, entry)
      scene.layers.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'crop', c.kind), loadAt(ground.sx, ground.sy))
    }
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.depth.box = tileDepthBox(key, c.x, c.y)
    writeScale(entry, CROP_SCALE_BASE + CROP_SCALE_PER_STAGE * c.stage)
    entry.sprite.tint = c.withered ? WITHERED_TINT : 0xffffff
  }

  for (const [key, entry] of sync.entries) {
    if (!live.has(key)) {
      entry.sprite.destroy({ children: true })
      entry.shadow?.destroy()
      sync.entries.delete(key)
      tags.hideAll() // a torn-down sprite never fires pointerout, so its tag would hang
    }
  }

  // THE hot-load path — on new codex records, re-resolve every url and swap in place
  const seq = store.assetsSeq()
  if (seq !== sync.lastAssetsSeq) {
    sync.lastAssetsSeq = seq
    for (const [key, entry] of sync.entries) {
      const id = key.slice(key.indexOf(':') + 1)
      if (key.startsWith('structure:')) {
        const s = state.structures[id]
        if (s === undefined) continue
        const art = buildingArt(records, s.kind, s.w, s.h, s.facing)
        if ((art.url ?? NO_ART) !== entry.url) {
          const at = loadAt(entry.sprite.position.x, entry.sprite.position.y)
          applyBuildingArt(book, entry, art, entry.url === NO_ART ? null : entry.url, s, s.kind, at)
          paintMarks(sync, entry)
        }
        continue
      }
      const kind = key.startsWith('item:') ? state.items[id]?.kind : state.crops[id]?.kind
      if (kind === undefined) continue
      const url = textureUrlFor(records, key.startsWith('item:') ? 'item' : 'crop', kind)
      if (url !== null && url !== entry.url) {
        const oldUrl = entry.url
        const at = loadAt(entry.sprite.position.x, entry.sprite.position.y)
        entry.url = url
        void book.swap(oldUrl, url).then((t) => {
          if (entry.url !== url || entry.sprite.destroyed) return
          landItem(entry, t)
          fadeArtIn(entry.sprite, at.delayMs)
        }, artOptional)
      }
    }
  }
}
