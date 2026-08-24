import { Graphics, Polygon, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js'
import { INTERIOR_KINDS, tickToMoment } from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { hoverLabel, itemCropDetail, type HoverKind } from '../ui/interaction.js'
import { builtFormSpec, drawBuiltForm, footprintDiamond } from './builtForm.js'
import { structureDepthBox, tileDepthBox, type DepthBox } from './depth.js'
import { TILE_H, depthKey, tileToScreen } from './iso.js'
import type { DepthEntry } from './layers.js'
import { DOOR_SILL_INSET, DOOR_SILL_STEP, doorLocalRect, doorSillPolygon } from './hitShapes.js'
import { LANDMARK_INK, LANDMARK_PLATE } from './legibility.js'
import { anchorForSprite } from './tooltip.js'
import type { Scene } from './scene.js'
import {
  BUILDING_PX_PER_TILE, TextureBook, buildingArt, fadeArtIn, textureUrlFor,
  type BuildingArt,
} from './textures.js'

export { BUILDING_PX_PER_TILE } from './textures.js'

export const CONSTRUCTION_TINT = 0xcfc6bc
export const WITHERED_TINT = 0x857d75
/**
 * ★ THE PRE-C-LEVEL CEILING, MOVED. `assetResolution.ts` says it moved and lists four places it
 * lived; this was a fifth it missed, and the art lane measured what it cost: the 100 item
 * records it shipped are authored at `WORLD_SPRITE_PX` = 128, and 128 / 24 is **5.333** — a
 * fractional downscale against a law that says whole numbers only. Every item in the town was
 * resampled onto a grid it was not drawn on.
 *
 * 32, and it is two derivations that had to agree: 128 / 4 puts the deepest zoom stop at 1:1,
 * exactly as `CHAR_FIGURE_PX = 52 * 4` does for a cast cell; and (1+1) half-tiles of a 32 px
 * tile is the world span of the 1×1 ground an item stands on. Either alone would be a constant
 * fitted to make a division come out. `drawScale.test.ts` holds both.
 */
export const ITEM_PX = 32
export const CROP_SCALE_BASE = 0.4
export const CROP_SCALE_PER_STAGE = 0.15
export const PIP_COUNT = 4
export const PIP_COLOR = 0xf2c879
/** The fallback denominator, for the frames before the snapshot's config has arrived. It is
 *  `DEFAULT_CONFIG.construction.houseTicks` and it is NOT the authority — see `pipsFilled`. */
export const BUILD_TICKS_FULL = 2880

/**
 * ★ HOW FULL THE PROGRESS PIPS ARE — READ OFF THE WORLD'S OWN CLOCK, NOT A COPY OF IT.
 *
 * This was `progressTicks / BUILD_TICKS_FULL`, a hardcoded 2880 transcribed from
 * `DEFAULT_CONFIG`. The dev world raises a house in 240 ticks so a viewer can watch one go up,
 * and under the transcribed denominator `floor((240 / 2880) × 4)` is **zero at completion** —
 * every house in the demo would stand under scaffolding for its whole build with not one pip
 * lit, and the guard would have been the eye of whoever happened to look.
 *
 * `houseTicks` comes off the snapshot the viewer is already holding (`store.getConfig()`, which
 * `worldStore` parses with the engine's own strict schema), so the meter measures the build the
 * world is actually running. A non-positive or absent figure falls back rather than dividing by
 * zero.
 */
export function pipsFilled(progressTicks: number, houseTicks: number | undefined): number {
  const full = houseTicks !== undefined && houseTicks > 0 ? houseTicks : BUILD_TICKS_FULL
  return Math.max(0, Math.min(PIP_COUNT, Math.floor((progressTicks / full) * PIP_COUNT)))
}

// The door a resident walks out of: south face, centre of the frontage. The same rule the
// C13 city template applies in template space (`doorTile`), read here in world tiles.
export const ENTERABLE_KINDS: ReadonlySet<string> = new Set(INTERIOR_KINDS)

// A THRESHOLD, NOT A DARK RECTANGLE (U11). The affordance is a SILL laid on the door tile —
// a warm step in front of the doorway — never a slab painted over the building's own face.
// A dark plate on the wall was exactly the artefact the user reported.
export const DOOR_SILL = 0xf2c879         // --honey, the lit step
/** @deprecated the rim is a two-tone ledge now (`DOOR_RIM_INK` / `DOOR_RIM_LIT`). Kept because
 *  `entities.test.ts` cites it as the single-line before-state. */
export const DOOR_LINTEL = 0x43394a       // --ink, its 1px rim

// ★ THE ONE AFFORDANCE FOR "YOU CAN GO IN HERE" WAS BEHIND AN OPACITY, AND THE BAR SAYS
// OPACITY IS NOT A CONTRAST STRATEGY.
//
// The sill was drawn whole and then dimmed — `door.alpha = 0.45` over the fill AND its rim —
// so the boundary, the part that has to be seen, was 45 % of itself. Measured through
// `legibility.readableRatio` against the six tones `ground.ts` can paint under a doorway
// (grass, earth, rock, sand, road, path), in BOTH light bands, worst case of the six:
//
//                                day    night
//   --ink rim at 0.45            1.74    1.35     what shipped — fails 1.4.11 in both bands
//   --ink rim at 1.00            3.71    1.83     opaque is not enough AFTER DARK
//   --honey fill at any alpha    1.05    1.02     honey and mid grass share a luminance
//
// ★ AND NO SINGLE COLOUR FIXES IT. Every candidate was measured over the same six grounds in
// both bands and the dual-band set is EMPTY, exactly as it is for the chrome's palette: the
// best dark (`--deep`) is 5.46 / 2.16 and the best light (`--cream`) is 1.34 / 1.30, because
// the night multiply compresses every pair toward the tint. A mark whose legibility is a
// function of the ground cannot clear 3:1 on ground this varied under a tint this deep.
//
// So the rim does not depend on the ground: it is the STEPPED LEDGE every floating slab in
// this town already wears, an ink line with a lit line one pixel inside it. Its contrast is
// the contrast of the two lines with EACH OTHER — `LANDMARK_INK` on `LANDMARK_PLATE`, which
// `legibility.ts` has already proved at 15.02:1 by day and 5.19:1 at night — and that number
// is the same on grass, on sand and on the road. The honey stays as the warmth of the step,
// which is all it was ever contributing.
export const DOOR_RIM_INK = LANDMARK_INK
export const DOOR_RIM_LIT = LANDMARK_PLATE
export const DOOR_SILL_FILL_ALPHA = 0.45
export const DOOR_RIM_ALPHA = 1
export const DOOR_HOVER_FILL_ALPHA = 0.85

export function doorTileOf(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } {
  return { x: s.x + ((s.w - 1) >> 1), y: s.y + s.h - 1 }
}

/** @deprecated for sorting — depth.ts owns the painter's order. Kept as the landed
 *  before-state that depth.test.ts and occlusion.test.ts measure U8 against. */
export function structureZIndex(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): number {
  return depthKey(s.x + s.w - 1, s.y + s.h - 1)
}

// A building sprite is ~1.85x wider than the ground it stands on, and Pixi hit-tests a
// sprite's full RECTANGULAR bounds — transparent margin included. So a wagon one depth row
// south of the storehouse was intercepting hits on the storehouse's door with nothing but
// its empty canopy padding, and the scaffolding was doing the same to the house.
//
// The honest target for "tell me about this building" is the ground it occupies, so the
// hit area is the footprint DIAMOND: it can never reach past the tiles the building stands
// on, and therefore can never cover a neighbour's door.
//
// Local sprite space has its origin at the sprite's position — the TOP vertex of the centre
// tile — and Pixi scales hitArea with the sprite, so the points are divided by the applied
// scale exactly as `hitRect` does for characters.
export function footprintHitPoints(w: number, h: number, scale = 1): number[] {
  const k = scale === 0 ? 1 : scale
  return footprintDiamond(w, h).map((v) => v / k)
}

type Entry = {
  sprite: Sprite; url: string; pips: Graphics | null; form: Graphics | null
  /** the look-inside threshold, a CHILD of the sprite so it shares the building's depth */
  door: Graphics | null
  /** the ground plan the door and the hit diamond are both cut from */
  footprint: { w: number; h: number }
  /** the camera scale this door's target was last cut for — the 24 px floor is a SCREEN size */
  doorZoom: number
  /** the sill's own fill strength. Lives on the entry rather than on the node because the rim
   *  must NOT follow it: a node alpha dims the boundary too, which is the thing that has to
   *  be seen. Hover brightens the step; it never brightens the outline, which is already at
   *  full strength. */
  doorFill: number
  /** the ground this drawable stands on, republished every sync for the frame's depth sort */
  box: DepthBox
}

/** `entry.url` for a structure whose kind has no art at all — never a real url, so the
 *  hot-load path re-resolves it exactly once, when the art finally lands. */
const NO_ART = ''
type SyncState = {
  entries: Map<string, Entry>; lastAssetsSeq: number
  onDoor: ((structureId: string) => void) | null
  /** the camera scale every door target was last cut for */
  doorZoom: number
}
const syncStates = new WeakMap<Scene, SyncState>()

function setTexture(book: TextureBook, entry: Entry, url: string): void {
  entry.url = url
  void book.get(url).then((t) => {
    if (entry.url === url) entry.sprite.texture = t
  })
}

// v4 hi-res buildings anchor at the manifest feet point and downscale smoothly to the
// footprint diamond; v2/placeholder art keeps the bottom-center anchor at natural size.
function applyBuildingArt(
  book: TextureBook, entry: Entry, art: BuildingArt, swapFrom: string | null,
  footprint: { w: number; h: number }, kind: string,
): void {
  // NO ART IN ANY ROOT — draw the thing rather than the forge's checkerboard. The volume is
  // a child of the sprite, so it inherits the sprite's depth, position and tint for free and
  // disappears the moment real art arrives.
  if (art.url === null) {
    entry.url = NO_ART
    entry.sprite.texture = Texture.EMPTY
    entry.sprite.anchor.set(0.5, 1.0)
    entry.sprite.scale.set(1)
    entry.sprite.hitArea = new Polygon(footprintHitPoints(footprint.w, footprint.h))
    if (entry.form === null) {
      entry.form = new Graphics()
      entry.form.eventMode = 'none' // the volume is a picture; the sprite owns the pointer
      entry.sprite.addChild(entry.form)
    }
    drawBuiltForm(entry.form, builtFormSpec(kind, footprint.w, footprint.h))
    return
  }
  if (entry.form !== null) {
    entry.form.destroy()
    entry.form = null
  }
  entry.url = art.url
  const swapping = swapFrom !== null && swapFrom !== art.url
  const p = swapping ? book.swap(swapFrom, art.url) : book.get(art.url)
  void p.then((t) => {
    if (entry.url !== art.url || entry.sprite.destroyed) return // superseded or torn down mid-load
    entry.sprite.texture = t
    if (swapping) fadeArtIn(entry.sprite)   // finish line 8: art arrives, it does not pop in
    if (art.anchor !== null) entry.sprite.anchor.set(art.anchor.x, art.anchor.y)
    else entry.sprite.anchor.set(0.5, 1.0)
    const scale = art.scale ?? 1
    entry.sprite.scale.set(scale)
    // the hit area is scaled with the sprite, so it is re-cut whenever the scale moves
    entry.sprite.hitArea = new Polygon(footprintHitPoints(footprint.w, footprint.h, scale))
    layoutDoor(entry)   // a child inherits the new scale; the threshold follows it
  })
}

/**
 * The threshold, in the parent sprite's local space: the door tile's own ground diamond, lit
 * in honey with a 1 px ink rim. It is a step you can see from any angle, and because it lies
 * on the ground it never punches a hole in the building's own art. Re-cut whenever the
 * sprite's scale moves, so it stays one size on screen at any art resolution.
 */
function layoutDoor(entry: Entry, zoom = entry.doorZoom, fillAlpha = entry.doorFill): void {
  const door = entry.door
  if (door === null) return
  entry.doorZoom = zoom
  entry.doorFill = fillAlpha
  const footprint = entry.footprint
  const scale = entry.sprite.scale.x || 1
  door.clear()
  door.poly(doorSillPolygon(footprint, scale))
  door.fill({ color: DOOR_SILL, alpha: fillAlpha })
  // The ledge, lit line first and ink line over it, both at full strength. The node is never
  // dimmed: a node alpha takes the boundary down with the fill, which is the defect the table
  // above measures.
  door.poly(doorSillPolygon(footprint, scale, DOOR_SILL_INSET + DOOR_SILL_STEP))
  door.stroke({ width: 1 / scale, color: DOOR_RIM_LIT, alignment: 0.5, alpha: DOOR_RIM_ALPHA })
  door.poly(doorSillPolygon(footprint, scale))
  door.stroke({ width: 1 / scale, color: DOOR_RIM_INK, alignment: 0.5, alpha: DOOR_RIM_ALPHA })
  door.position.set(0, 0)
  // The 24 px floor is a SCREEN size, so the target is re-cut on a zoom change, not per frame.
  const r = doorLocalRect(footprint, scale, zoom)
  door.hitArea = new Rectangle(r.x, r.y, r.w, r.h)
}

function drawPips(g: Graphics, filled: number): void {
  g.clear()
  for (let i = 0; i < PIP_COUNT; i++) {
    g.rect(i * 6 - (PIP_COUNT * 6 - 2) / 2, 0, 4, 4)
    g.fill({ color: PIP_COLOR, alpha: i < filled ? 1 : 0.25 })
  }
}

async function provenanceText(structureId: string, state: WorldState | null): Promise<string> {
  const res = await fetch(`/api/structure/${structureId}/provenance`)
  if (!res.ok) return 'No one remembers who began this.'
  const p = (await res.json()) as { kind: string; plannedTick: number; builderId: string; completedTick: number | null }
  const begun = tickToMoment(p.plannedTick)
  const name = state?.agents[p.builderId]?.name ?? p.builderId
  const finish = p.completedTick === null ? 'still rising' : `finished Day ${tickToMoment(p.completedTick).day}`
  let text = `Begun by ${name} on Day ${begun.day} ${begun.time} — ${finish}`
  // the "why" line: the builder's journal entry nearest plannedTick, omitted when the journal is empty
  const jres = await fetch(`/api/agent/${p.builderId}/journal`)
  if (jres.ok) {
    const entries = (await jres.json()) as Array<{ tick: number; text: string }>
    const nearest = entries.reduce<{ tick: number; text: string } | null>(
      (best, e) => (best === null || Math.abs(e.tick - p.plannedTick) < Math.abs(best.tick - p.plannedTick) ? e : best),
      null,
    )
    if (nearest !== null) text += `\n"${nearest.text}"`
  }
  return text
}

let popEl: HTMLDivElement | null = null
function showPopover(text: string, x: number, y: number): void {
  if (popEl === null) {
    popEl = document.createElement('div')
    popEl.className = 'provenance-pop'
    // A live region, so the detail reaches a reader who never sees the pointer; Escape
    // dismisses it, so it is not a thing only a mouse can close.
    popEl.setAttribute('role', 'status')
    document.body.appendChild(popEl)
    const hide = (): void => {
      if (popEl !== null) popEl.style.display = 'none'
    }
    document.addEventListener('pointerdown', hide)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide()
    })
  }
  popEl.textContent = text
  popEl.style.display = 'block'
  popEl.style.left = `${Math.round(x)}px`
  popEl.style.top = `${Math.round(y)}px`
}

// lookup for effect layers (placement bounce, fire glow anchoring)
export function entitySpriteOf(scene: Scene, kind: 'structure' | 'item' | 'crop', id: string): Sprite | null {
  return syncStates.get(scene)?.entries.get(`${kind}:${id}`)?.sprite ?? null
}

// diff-based sync, called once per store change
export function syncEntities(
  scene: Scene, book: TextureBook, store: WorldStore, onDoor?: (structureId: string) => void,
): void {
  const state = store.getState()
  if (state === null) return
  let sync = syncStates.get(scene)
  if (sync === undefined) {
    sync = {
      entries: new Map(), lastAssetsSeq: store.assetsSeq(), onDoor: null,
      doorZoom: scene.getZoom(),
    }
    syncStates.set(scene, sync)
    // A door's 24 px floor is a SCREEN size, and task 75's 0.5 overview stop makes that floor
    // live. Re-cut every target when the camera settles, not on a 2.5s world tick.
    const cut = sync
    scene.onCamera(() => {
      const z = scene.getZoom()
      if (z === cut.doorZoom) return
      cut.doorZoom = z
      for (const e of cut.entries.values()) {
        if (e.door !== null) layoutDoor(e, z)
      }
    })
    // Publish the ground every structure, item and crop stands on. One owner sorts the whole
    // frame from these; nothing here writes a depth of its own.
    const published = sync
    scene.addDepthSource(() => {
      const out: DepthEntry[] = []
      for (const e of published.entries.values()) out.push({ box: e.box, node: e.sprite })
      return out
    })
  }
  if (onDoor !== undefined) sync.onDoor = onDoor
  const tags = scene.tags

  // Everything on the map answers to the pointer: hover names it, click tells its story.
  const nameOnHover = (sprite: Sprite, kind: HoverKind, id: string): void => {
    sprite.eventMode = 'static'
    sprite.cursor = 'pointer'
    sprite.on('pointerover', () => {
      const text = hoverLabel(store.getState(), kind, id)
      // the anchor comes from the sprite's DRAWN bounds — for a base-anchored 1.85× building
      // `sprite.y - sprite.height` landed above the roof and off nobody's screen in particular
      if (text !== null) tags.show('hover', text, anchorForSprite(sprite, sprite.getLocalBounds()))
    })
    sprite.on('pointerout', () => tags.hide('hover'))
  }
  const records = store.assetRecords()
  const live = new Set<string>()

  for (const s of Object.values(state.structures)) {
    const key = `structure:${s.id}`
    live.add(key)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0) // bottom-center pinned to the ground point (manifest law)
      const sid = s.id
      nameOnHover(sprite, 'structure', sid)
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        void provenanceText(sid, store.getState()).then((text) => showPopover(text, e.client.x, e.client.y))
      })
      sprite.hitArea = new Polygon(footprintHitPoints(s.w, s.h))   // until the art sets its scale
      entry = {
        sprite, url: '', pips: null, form: null, door: null,
        footprint: { w: s.w, h: s.h }, doorZoom: sync.doorZoom, doorFill: DOOR_SILL_FILL_ALPHA,
        box: structureDepthBox(key, s),
      }
      sync.entries.set(key, entry)
      scene.layers.entities.addChild(sprite)
      applyBuildingArt(book, entry, buildingArt(records, s.kind, s.w, s.h, s.facing), null, s, s.kind)
    }
    const ground = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.box = structureDepthBox(key, s)
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

    // THE DOOR IS PART OF THE BUILDING (U11, P9d repealed). As a CHILD of the building
    // sprite it inherits its depth, so it can never paint over somebody standing in the
    // doorway, and Pixi hit-tests children before parents, so it wins its own click without
    // a priority table. It scales with the sprite, so it is re-cut for free when art swaps.
    const enterable = s.stage === 'complete' && ENTERABLE_KINDS.has(s.kind)
    if (enterable && entry.door === null) {
      const door = new Graphics()
      door.eventMode = 'static'
      door.cursor = 'pointer'
      const sid = s.id
      const self = entry
      const sw = s.w, sh = s.h
      door.on('pointerover', (e: FederatedPointerEvent) => {
        e.stopPropagation()   // one pointer names ONE thing: the door, not also its building
        layoutDoor(self, self.doorZoom, DOOR_HOVER_FILL_ALPHA)
        const name = hoverLabel(store.getState(), 'structure', sid)
        const k = self.sprite.scale.x || 1
        const r = doorLocalRect({ w: sw, h: sh }, k)
        if (name !== null) {
          tags.show('door', `Look inside — ${name}`, {
            sx: self.sprite.x + (r.x + r.w / 2) * k, sy: self.sprite.y + (r.y + r.h) * k,
            halfW: (r.w * k) / 2, topY: self.sprite.y + r.y * k,
          })
        }
      })
      door.on('pointerout', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        layoutDoor(self, self.doorZoom, DOOR_SILL_FILL_ALPHA)
        tags.hide('door')
      })
      door.on('pointertap', (e: FederatedPointerEvent) => {
        e.stopPropagation()   // the building's provenance popover is a different question
        sync!.onDoor?.(sid)
      })
      entry.door = door
      entry.sprite.addChild(door)
    }
    if (entry.door !== null) {
      entry.door.visible = enterable
      entry.footprint = { w: s.w, h: s.h }
      layoutDoor(entry, sync.doorZoom)
    }
  }

  for (const it of Object.values(state.items)) {
    if (it.loc.t !== 'tile') continue
    const key = `item:${it.id}`
    live.add(key)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0)
      const iid = it.id
      nameOnHover(sprite, 'item', iid)
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        const text = itemCropDetail(store.getState(), 'item', iid)
        if (text !== null) showPopover(text, e.client.x, e.client.y)
      })
      entry = {
        sprite, url: '', pips: null, form: null, door: null,
        footprint: { w: 1, h: 1 }, doorZoom: 1, doorFill: DOOR_SILL_FILL_ALPHA,
        box: tileDepthBox(key, it.loc.x, it.loc.y, ITEM_PX),
      }
      sync.entries.set(key, entry)
      scene.layers.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'item', it.kind))
      void book.get(entry.url).then(() => {
        entry!.sprite.width = ITEM_PX
        entry!.sprite.height = ITEM_PX
      })
    }
    const ground = tileToScreen(it.loc.x, it.loc.y)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.box = tileDepthBox(key, it.loc.x, it.loc.y, ITEM_PX)
  }

  for (const c of Object.values(state.crops)) {
    const key = `crop:${c.id}`
    live.add(key)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0)
      const cid = c.id
      nameOnHover(sprite, 'crop', cid)
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        const text = itemCropDetail(store.getState(), 'crop', cid)
        if (text !== null) showPopover(text, e.client.x, e.client.y)
      })
      entry = {
        sprite, url: '', pips: null, form: null, door: null,
        footprint: { w: 1, h: 1 }, doorZoom: 1, doorFill: DOOR_SILL_FILL_ALPHA,
        box: tileDepthBox(key, c.x, c.y),
      }
      sync.entries.set(key, entry)
      scene.layers.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'crop', c.kind))
    }
    const ground = tileToScreen(c.x, c.y)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.box = tileDepthBox(key, c.x, c.y)
    entry.sprite.scale.set(CROP_SCALE_BASE + CROP_SCALE_PER_STAGE * c.stage)
    entry.sprite.tint = c.withered ? WITHERED_TINT : 0xffffff
  }

  for (const [key, entry] of sync.entries) {
    if (!live.has(key)) {
      entry.sprite.destroy({ children: true })
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
          applyBuildingArt(book, entry, art, entry.url === NO_ART ? null : entry.url, s, s.kind)
        }
        continue
      }
      const kind = key.startsWith('item:') ? state.items[id]?.kind : state.crops[id]?.kind
      if (kind === undefined) continue
      const url = textureUrlFor(records, key.startsWith('item:') ? 'item' : 'crop', kind)
      if (url !== entry.url) {
        const oldUrl = entry.url
        entry.url = url
        void book.swap(oldUrl, url).then((t) => {
          if (entry.url === url) entry.sprite.texture = t
        })
      }
    }
  }
}
