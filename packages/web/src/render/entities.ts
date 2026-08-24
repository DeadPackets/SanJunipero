import { Graphics, Polygon, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js'
import { INTERIOR_KINDS, tickToMoment } from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { hoverLabel, itemCropDetail, type HoverKind } from '../ui/interaction.js'
import { builtFormSpec, drawBuiltForm, footprintDiamond } from './builtForm.js'
import { structureDepthBox, tileDepthBox, type DepthBox } from './depth.js'
import { TILE_H, depthKey, tileToScreen } from './iso.js'
import type { DepthEntry } from './layers.js'
import { HIT_MIN_PX, artPrismPolygon, extrudeDiamond, inflateToMin } from './hitShapes.js'
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
// C13 city template applies in template space (`doorTile`), read here in world tiles. Read by
// `interiorScene`, which needs to know where a room's occupants came in.
export const ENTERABLE_KINDS: ReadonlySet<string> = new Set(INTERIOR_KINDS)

// ★ THE "CLICK TO ENTER" SQUARE IS RETIRED, AND SO IS THE SLAB THAT DREW IT.
//
// THE RULING: *"the 'click to inspect or enter building' squares [must] be retired and instead
// replaced with accurate hitboxes of the actual structures themselves."*
//
// There were TWO squares on a building and both were on the GROUND rather than on the thing:
//
//  · INSPECT — `footprintHitPoints`, the flat ground diamond. Measured against every codex
//    root's decoded alpha, it contained 0.0 % – 0.8 % of the building's DRAWN pixels. Clicking
//    a roof, a wall or a doorway did nothing; the house answered only on the grass it touches.
//
//  · ENTER — a `Rectangle` hitArea over the door tile, floored to 24 px, under a honey sill
//    drawn flat on that tile. An axis-aligned screen rectangle over a diamond, and the sill it
//    marked reads in the running product as a paving slab lying in the yard: the art is fitted
//    to a `(w + h) · 32` square whose lowest row sits at the sprite's own anchor, so the DRAWN
//    house stands about a footprint's half-height north of the ground plan the sill is cut
//    from. The affordance and the door in the picture were not in the same place.
//
// ★ AND ONE HITBOX REPLACES BOTH, WHICH IS WHAT THE RULING ASKS FOR. A building is one object,
// so it takes one pointer: the prism of what is drawn. What the click MEANS is then a property
// of the building rather than of where inside it you landed —
//
//   enterable and complete → go in.      anything else → its provenance popover.
//
// Nothing is lost by dropping the popover on the nine enterable buildings: `InteriorBar` puts
// the same `/api/structure/:id/provenance` line at the top of the room you have just walked
// into. The hover tag says which of the two a click will do, before you make it.

/** Whether clicking this building walks into it. A shell still going up has no room to walk
 *  into, and a well has no room at all — both answer with their story instead. */
export function entersOnClick(state: WorldState | null, structureId: string): boolean {
  const s = state?.structures[structureId]
  return s !== undefined && s.stage === 'complete' && ENTERABLE_KINDS.has(s.kind)
}

/**
 * What the pointer promises: the same building, said two ways, because a click on it does two
 * different things. The tag is the affordance now that the ground slab is gone.
 *
 * The building is named FIRST and the offer follows on a middot, which is a composition fix
 * found by eye: `hoverLabel` already spends an em-dash on "house — built by script", so the
 * landed `Look inside — {name}` read as LOOK INSIDE — HOUSE — BUILT BY SCRIPT, three phrases
 * on two identical separators with the least important one in the middle.
 */
export const LOOK_INSIDE = 'Look inside'
export function structureHoverText(state: WorldState | null, structureId: string): string | null {
  const name = hoverLabel(state, 'structure', structureId)
  if (name === null) return null
  return entersOnClick(state, structureId) ? `${name} · ${LOOK_INSIDE}` : name
}

export function doorTileOf(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } {
  return { x: s.x + ((s.w - 1) >> 1), y: s.y + s.h - 1 }
}

/** @deprecated for sorting — depth.ts owns the painter's order. Kept as the landed
 *  before-state that depth.test.ts and occlusion.test.ts measure U8 against. */
export function structureZIndex(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): number {
  return depthKey(s.x + s.w - 1, s.y + s.h - 1)
}

/**
 * @deprecated as a hit area — it is the BASE of the hit prism now, and on its own it is the
 * defect the ruling names. Still the shape `builtForm` cuts its plinth from, and
 * `entities.test.ts` cites it as the before-state whose coverage of the drawn art was measured
 * at 0.0 % – 0.8 %.
 */
export function footprintHitPoints(w: number, h: number, scale = 1): number[] {
  const k = scale === 0 ? 1 : scale
  return footprintDiamond(w, h).map((v) => v / k)
}

/**
 * ★ THE HITBOX OF THE STRUCTURE ITSELF, in the sprite's local space.
 *
 * Two sources, because a building is drawn two ways and the hitbox follows WHAT IS DRAWN:
 *
 *  · with ART — `artPrismPolygon`, the drawn cell's diamond footprint swept up the drawn cell's
 *    own height. Coverage of the decoded alpha is 89.1 % – 99.7 % over all twenty codex roots.
 *  · with NO art — `builtFormSpec` draws a plinth and a volume out of the palette, so the prism
 *    is that plinth's diamond swept up that volume's own `heightPx`. Exact, by construction.
 *
 * The 24 px floor is a SCREEN size, so the shape is re-cut when the camera scale moves — a
 * 1 × 1 shed is 64 world px across, which is 16 px at the 0.25 overview stop.
 */
export function structureHitPoints(
  kind: string, w: number, h: number, scale: number, zoom = 1, hasArt = true,
): number[] {
  const k = scale === 0 ? 1 : scale
  const local = hasArt
    ? artPrismPolygon(w, h, k)
    : extrudeDiamond(footprintDiamond(w, h), builtFormSpec(kind, w, h).heightPx).map((v) => v / k)
  return inflateToMin(local, HIT_MIN_PX, k * (zoom > 0 ? zoom : 1))
}

type Entry = {
  sprite: Sprite; url: string; pips: Graphics | null; form: Graphics | null
  /** the kind and ground plan the hit prism is cut from */
  kind: string
  footprint: { w: number; h: number }
  /** the camera scale this prism was last cut for — the 24 px floor is a SCREEN size */
  hitZoom: number
  /** the ground this drawable stands on, republished every sync for the frame's depth sort */
  box: DepthBox
}

/** `entry.url` for a structure whose kind has no art at all — never a real url, so the
 *  hot-load path re-resolves it exactly once, when the art finally lands. */
const NO_ART = ''
type SyncState = {
  entries: Map<string, Entry>; lastAssetsSeq: number
  onDoor: ((structureId: string) => void) | null
  /** the camera scale every structure prism was last cut for */
  hitZoom: number
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
    cutHitPrism(entry)
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
    cutHitPrism(entry)   // the prism is scaled with the sprite, so a new scale re-cuts it
  })
}

/**
 * Re-cut the structure's hit prism. Called when the art's scale lands, when the footprint
 * changes and when the camera settles at a new zoom — never per frame.
 */
function cutHitPrism(entry: Entry, zoom = entry.hitZoom): void {
  entry.hitZoom = zoom
  const { w, h } = entry.footprint
  const scale = entry.sprite.scale.x || 1
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
      hitZoom: scene.getZoom(),
    }
    syncStates.set(scene, sync)
    // The 24 px floor is a SCREEN size, and the 0.25 overview stop makes it live: a 1 × 1 shed
    // is 64 world px across, 16 px there. Re-cut every prism when the camera settles, not on a
    // 2.5 s world tick and not per frame.
    const cut = sync
    scene.onCamera(() => {
      const z = scene.getZoom()
      if (z === cut.hitZoom) return
      cut.hitZoom = z
      // Items and crops are in this map too and take Pixi's own sprite bounds; only a
      // structure carries a prism.
      for (const [key, e] of cut.entries) if (key.startsWith('structure:')) cutHitPrism(e, z)
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
      const text = kind === 'structure'
        ? structureHoverText(store.getState(), id)
        : hoverLabel(store.getState(), kind, id)
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
      // ONE TARGET, TWO MEANINGS, AND THE BUILDING DECIDES WHICH. A door you can walk through
      // is the reason to click a house; everything else answers with its story. The hover tag
      // says which one this click will do before it is made.
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        if (entersOnClick(store.getState(), sid)) {
          sync!.onDoor?.(sid)
          return
        }
        void provenanceText(sid, store.getState()).then((text) => showPopover(text, e.client.x, e.client.y))
      })
      entry = {
        sprite, url: '', pips: null, form: null, kind: s.kind,
        footprint: { w: s.w, h: s.h }, hitZoom: sync.hitZoom,
        box: structureDepthBox(key, s),
      }
      sprite.hitArea = new Polygon(structureHitPoints(s.kind, s.w, s.h, 1, sync.hitZoom))
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

    // A building that has changed shape or kind is a building whose prism is out of date.
    if (entry.footprint.w !== s.w || entry.footprint.h !== s.h || entry.kind !== s.kind) {
      entry.footprint = { w: s.w, h: s.h }
      entry.kind = s.kind
      cutHitPrism(entry, sync.hitZoom)
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
        sprite, url: '', pips: null, form: null, kind: it.kind,
        footprint: { w: 1, h: 1 }, hitZoom: 1,
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
        sprite, url: '', pips: null, form: null, kind: c.kind,
        footprint: { w: 1, h: 1 }, hitZoom: 1,
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
