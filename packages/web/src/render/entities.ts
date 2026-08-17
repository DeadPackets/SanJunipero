import { Graphics, Polygon, Sprite, type FederatedPointerEvent } from 'pixi.js'
import { INTERIOR_KINDS, tickToMoment } from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { hoverLabel, itemCropDetail, type HoverKind } from '../ui/interaction.js'
import { TILE_H, TILE_W, depthKey, tileToScreen } from './iso.js'
import { createNameTagLayer, type NameTagLayer } from './nameTags.js'
import type { Scene } from './scene.js'
import {
  BUILDING_PX_PER_TILE, TextureBook, buildingArt, smoothSource, textureUrlFor, type BuildingArt,
} from './textures.js'

export { BUILDING_PX_PER_TILE }

export const CONSTRUCTION_TINT = 0xcfc6bc
export const WITHERED_TINT = 0x857d75
export const ITEM_PX = 24
export const CROP_SCALE_BASE = 0.4
export const CROP_SCALE_PER_STAGE = 0.15
export const PIP_COUNT = 4
export const PIP_COLOR = 0xf2c879
export const BUILD_TICKS_FULL = 2880 // pip denominator — DEFAULT_CONFIG construction.hutTicks; presentation only

// The door a resident walks out of: south face, centre of the frontage. The same rule the
// C13 city template applies in template space (`doorTile`), read here in world tiles.
export const ENTERABLE_KINDS: ReadonlySet<string> = new Set(INTERIOR_KINDS)
export const DOOR_W = 10, DOOR_H = 13
export const DOOR_FILL = 0x43394a, DOOR_STEP = 0xf2c879
export const DOOR_IDLE_ALPHA = 0.5

export function doorTileOf(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } {
  return { x: s.x + ((s.w - 1) >> 1), y: s.y + s.h - 1 }
}

// A building depth-sorts from its FAR corner, and its sprite is ~1.85x wider than its own
// ground diamond (C13 hi-res art), so it covers the door tile and — being the top-most child
// of a sortableChildren container — took every hover. The door therefore sorts against its
// BUILDING, not against its own tile: one step above it, which is still a whole depth row
// below anything actually standing in front of the building.
export function structureZIndex(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): number {
  return depthKey(s.x + s.w - 1, s.y + s.h - 1)
}

export const DOOR_Z_OVER_BUILDING = 1

export function doorZIndex(s: Pick<Structure, 'x' | 'y' | 'w' | 'h'>): number {
  return structureZIndex(s) + DOOR_Z_OVER_BUILDING
}

// A building sprite is ~1.85x wider than the ground it stands on, and Pixi hit-tests a
// sprite's full RECTANGULAR bounds — transparent margin included. So a wagon one depth row
// south of the storehouse was intercepting hits on the storehouse's door with nothing but
// its empty canopy padding, and the scaffolding was doing the same to the hut.
//
// The honest target for "tell me about this building" is the ground it occupies, so the
// hit area is the footprint DIAMOND: it can never reach past the tiles the building stands
// on, and therefore can never cover a neighbour's door.
//
// Local sprite space has its origin at the sprite's position — the TOP vertex of the centre
// tile — and Pixi scales hitArea with the sprite, so the points are divided by the applied
// scale exactly as `hitRect` does for characters.
export function footprintHitPoints(w: number, h: number, scale = 1): number[] {
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0.5 - w / 2, 0.5 - h / 2],   // north
    [w / 2 + 0.5, 0.5 - h / 2],   // east
    [w / 2 + 0.5, h / 2 + 0.5],   // south
    [0.5 - w / 2, h / 2 + 0.5],   // west
  ]
  const k = scale === 0 ? 1 : scale
  return corners.flatMap(([dx, dy]) => [
    ((dx - dy) * (TILE_W / 2)) / k,
    ((dx + dy) * (TILE_H / 2)) / k,
  ])
}

type Entry = { sprite: Sprite; url: string; pips: Graphics | null }
type SyncState = {
  entries: Map<string, Entry>; lastAssetsSeq: number; tags: NameTagLayer
  doors: Map<string, Graphics>; onDoor: ((structureId: string) => void) | null
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
  footprint: { w: number; h: number },
): void {
  entry.url = art.url
  const p = swapFrom !== null && swapFrom !== art.url ? book.swap(swapFrom, art.url) : book.get(art.url)
  void p.then((t) => {
    if (entry.url !== art.url || entry.sprite.destroyed) return // superseded or torn down mid-load
    entry.sprite.texture = art.anchor !== null ? smoothSource(t) : t
    if (art.anchor !== null) entry.sprite.anchor.set(art.anchor.x, art.anchor.y)
    else entry.sprite.anchor.set(0.5, 1.0)
    const scale = art.scale ?? 1
    entry.sprite.scale.set(scale)
    // the hit area is scaled with the sprite, so it is re-cut whenever the scale moves
    entry.sprite.hitArea = new Polygon(footprintHitPoints(footprint.w, footprint.h, scale))
  })
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
      entries: new Map(), lastAssetsSeq: store.assetsSeq(), tags: createNameTagLayer(scene),
      doors: new Map(), onDoor: null,
    }
    syncStates.set(scene, sync)
  }
  if (onDoor !== undefined) sync.onDoor = onDoor
  const tags = sync.tags

  // Everything on the map answers to the pointer: hover names it, click tells its story.
  const nameOnHover = (sprite: Sprite, kind: HoverKind, id: string): void => {
    sprite.eventMode = 'static'
    sprite.cursor = 'pointer'
    sprite.on('pointerover', () => {
      const text = hoverLabel(store.getState(), kind, id)
      if (text !== null) tags.show(text, sprite.x, sprite.y - sprite.height)
    })
    sprite.on('pointerout', () => tags.hide())
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
      entry = { sprite, url: '', pips: null }
      sync.entries.set(key, entry)
      scene.entities.addChild(sprite)
      applyBuildingArt(book, entry, buildingArt(records, s.kind, s.w, s.h), null, s)
    }
    const ground = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.sprite.zIndex = structureZIndex(s)
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
      drawPips(entry.pips, Math.min(PIP_COUNT, Math.floor((s.progressTicks / BUILD_TICKS_FULL) * PIP_COUNT)))
    } else {
      entry.sprite.tint = 0xffffff
      if (entry.pips !== null) {
        entry.pips.destroy()
        entry.pips = null
      }
    }

    // Look-inside affordance: a door on the frontage of a finished enterable building. It is
    // drawn rather than hidden behind a hover, so it can be found without a pointer sweep,
    // and it is its own hotspot so the building keeps its provenance click.
    const enterable = s.stage === 'complete' && ENTERABLE_KINDS.has(s.kind)
    const doorKey = `door:${s.id}`
    live.add(doorKey)
    let door = sync.doors.get(doorKey)
    if (enterable && door === undefined) {
      door = new Graphics()
      door.roundRect(-DOOR_W / 2, -DOOR_H, DOOR_W, DOOR_H, 3)
      door.fill(DOOR_FILL)
      door.rect(-DOOR_W / 2, -2, DOOR_W, 2)
      door.fill(DOOR_STEP)
      door.alpha = DOOR_IDLE_ALPHA
      door.eventMode = 'static'
      door.cursor = 'pointer'
      const sid = s.id
      door.on('pointerover', () => {
        door!.alpha = 1
        const name = hoverLabel(store.getState(), 'structure', sid)
        if (name !== null) tags.show(`Look inside — ${name}`, door!.x, door!.y - DOOR_H)
      })
      door.on('pointerout', () => {
        door!.alpha = DOOR_IDLE_ALPHA
        tags.hide()
      })
      door.on('pointertap', () => sync!.onDoor?.(sid))
      sync.doors.set(doorKey, door)
      scene.entities.addChild(door)
    }
    if (door !== undefined) {
      door.visible = enterable
      const d = doorTileOf(s)
      const at = tileToScreen(d.x, d.y)
      door.position.set(at.sx, at.sy + TILE_H / 2)
      door.zIndex = doorZIndex(s)
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
      entry = { sprite, url: '', pips: null }
      sync.entries.set(key, entry)
      scene.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'item', it.kind))
      void book.get(entry.url).then(() => {
        entry!.sprite.width = ITEM_PX
        entry!.sprite.height = ITEM_PX
      })
    }
    const ground = tileToScreen(it.loc.x, it.loc.y)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.sprite.zIndex = depthKey(it.loc.x, it.loc.y)
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
      entry = { sprite, url: '', pips: null }
      sync.entries.set(key, entry)
      scene.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'crop', c.kind))
    }
    const ground = tileToScreen(c.x, c.y)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.sprite.zIndex = depthKey(c.x, c.y)
    entry.sprite.scale.set(CROP_SCALE_BASE + CROP_SCALE_PER_STAGE * c.stage)
    entry.sprite.tint = c.withered ? WITHERED_TINT : 0xffffff
  }

  for (const [key, entry] of sync.entries) {
    if (!live.has(key)) {
      entry.sprite.destroy({ children: true })
      sync.entries.delete(key)
      tags.hide() // a torn-down sprite never fires pointerout, so its tag would hang
    }
  }
  for (const [key, door] of sync.doors) {
    if (!live.has(key)) {
      door.destroy()
      sync.doors.delete(key)
      tags.hide()
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
        const art = buildingArt(records, s.kind, s.w, s.h)
        if (art.url !== entry.url) applyBuildingArt(book, entry, art, entry.url, s)
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
