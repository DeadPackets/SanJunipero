import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { AssetRecord, SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { TILE_H, tileToScreen } from './iso.js'
import type { Scene } from './scene.js'
import { materialMatrix, resolveMaterial } from './groundField.js'
import { characterArt, smoothSource, type TextureBook } from './textures.js'
import { characterCell } from './characters.js'
import {
  INTERIOR_FADE_MS, advanceInterior, bedSlots, interiorOf, roomPlan,
  type InteriorPhaseState, type RoomItem,
} from './interiors.js'
import {
  ROOM_SHELL_INK, ROOM_SHELL_PAINT, ROOM_SLOTS, SLOT_TILES, WALL_H_TILES,
  drawFloorBase, drawFloorLight, drawFloorTop, drawWalls, floorPolyOf, floorPools,
  roomOriginY, wallMount,
} from './roomShell.js'

// Palette-true: the room is cut from the same warm paper the chrome is (Style Bible §7).
// The shell's own tones live in roomShell.ts; these are the names the rest of the app already
// imports, kept pointing at one source so a colour cannot be defined twice.
export const INTERIOR_FLOOR = ROOM_SHELL_PAINT.floor
export const INTERIOR_FLOOR_SHADE = ROOM_SHELL_PAINT.wallLit
export const INTERIOR_RIM = ROOM_SHELL_INK
export const INTERIOR_VEIL = 0x322b38
export const INTERIOR_VEIL_ALPHA = 0.62
export const INTERIOR_HEARTH_GLOW = ROOM_SHELL_PAINT.hearthPool

export { ROOM_SLOTS, SLOT_TILES }
export const ROOM_ZOOM = 3             // integer zoom only (spec §15)
export const ROOM_OFFSET_Y = 40        // lifts the room clear of the transport bar
export const HEARTH_GLOW_PX = 26
export const PLACEHOLDER_URL = '/assets/placeholder/item.png'
/** A hung piece is on the back plane, so it draws behind everything standing on the floor
 *  and in front of the wall itself — one depth, because a wall has no depth of its own. */
export const WALL_PIECE_Z = -1

// A slot's TOP vertex. Furniture and bodies draw at native pixel size; the only scaling in
// the room is ROOM_ZOOM, an integer, so nothing here lands off the pixel grid.
const slotToScreen = (x: number, y: number): { sx: number; sy: number } =>
  tileToScreen(x * SLOT_TILES, y * SLOT_TILES)

// Awake occupants stand where the room's life is: the hearth first, then the table, then
// whatever else is furnished. Deterministic, so two viewers see the same room.
const AWAKE_PREFERENCE = ['hearth', 'table', 'bench', 'chair', 'anvil', 'shelf'] as const

type Sheet = { art: ReturnType<typeof characterArt>; texture: Texture | null }

export type InteriorScene = {
  setActive(structureId: string | null): void
  setFollowed(agentId: string | null): void
  isActive(): boolean
  activeId(): string | null
  onChange(cb: (structureId: string | null) => void): () => void
  destroy(): void
}

// The plan passed a CharacterLayer here; the room draws its occupants from `characterArt`
// and the map layer's own `characterCell` slicer, so a second layer handle would be a
// parameter that does nothing. The town keeps living, dimmed, behind the veil.
export function createInteriorScene(
  scene: Scene, store: WorldStore, book: TextureBook,
): InteriorScene {
  const app = scene.app

  const root = new Container()
  root.visible = false
  root.eventMode = 'passive'
  const veil = new Graphics()
  veil.eventMode = 'static'        // the dimmed town is scenery: a click must not reach through it
  const room = new Container()
  room.eventMode = 'none'          // the room is a view; the chrome bar owns the way out
  room.sortableChildren = true
  root.addChild(veil, room)
  app.stage.addChild(root)

  // Three planes, behind everything that stands in the room. The walls sort behind the floor
  // because a dimetric camera sees the two far faces of the box and nothing else. The light
  // is its own node because it is MASKED to the floor: the doorway pool is centred on the
  // near vertex, so unmasked it paints a pale ellipse across the town behind the room.
  const walls = new Graphics()
  walls.zIndex = -4
  const floorArt = new Graphics()      // the continuous material, when the codex has one
  floorArt.zIndex = -3
  const floor = new Graphics()
  floor.zIndex = -2.5
  const floorLight = new Graphics()
  floorLight.zIndex = -2.25
  const floorMask = new Graphics()
  floorMask.poly(floorPolyOf(ROOM_SLOTS, SLOT_TILES))
  floorMask.fill(0xffffff)
  floorLight.mask = floorMask
  const floorTop = new Graphics()
  floorTop.zIndex = -2
  room.addChild(walls, floorArt, floor, floorMask, floorLight, floorTop)

  const furniture = new Map<string, Sprite>()   // `${kind}:${x},${y}` → sprite
  const bodies = new Map<string, Sprite>()      // agentId → sprite
  const sheets = new Map<string, Sheet>()

  let activeId: string | null = null
  let followedId: string | null = null
  let phase: InteriorPhaseState = { phase: 'town', sinceMs: 0 }
  let plannedFor: string | null = null          // the kind the furniture map was built for
  let plannedSeq = -1
  let plan: RoomItem[] = []
  let perches: Array<{ x: number; y: number }> = []
  const changeCbs: Array<(id: string | null) => void> = []

  // A cut, not a fade, for a viewer who asked for less motion — the destination is the
  // point, and 260ms of dissolve is the part they opted out of.
  const reduced = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const notify = (): void => { for (const cb of changeCbs) cb(activeId) }

  // ART INDEPENDENCE, the interior's half. The floor takes a continuous material the moment
  // the codex holds one and reads as a palette-true plane until then — the same hot-swap law
  // the outdoor ground answers to, and the same reason a missing texture is never a hole.
  const pools = (items: RoomItem[]): ReturnType<typeof floorPools> =>
    floorPools(items.map((i) => ({ slot: i.slot, light: i.meta?.providesLight === true })), ROOM_SLOTS)

  let floorMaterial: string | null = null
  function paintFloor(items: RoomItem[], records: AssetRecord[]): void {
    const url = resolveMaterial(records, 'interior-floor')
    if (url === null) {
      floorMaterial = null
      floorArt.clear()
      floorArt.visible = false
    } else if (url !== floorMaterial) {
      floorMaterial = url
      void book.get(url).then((t) => {
        if (floorMaterial !== url || floorArt.destroyed) return
        t.source.addressMode = 'repeat'
        floorArt.clear()
        floorArt.poly(floorPolyOf(ROOM_SLOTS, SLOT_TILES))
        floorArt.fill({ texture: t, matrix: materialMatrix('interior-floor', 0) })
        floorArt.visible = true
      })
    }
    floor.clear()
    drawFloorBase(floor, ROOM_SLOTS, SLOT_TILES, url === null ? ROOM_SHELL_PAINT.floor : null)
    floorLight.clear()
    drawFloorLight(floorLight, pools(items), ROOM_SLOTS, SLOT_TILES)
  }

  drawWalls(walls, ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
  drawFloorTop(floorTop, ROOM_SLOTS, SLOT_TILES)
  paintFloor([], [])

  function clearRoom(): void {
    for (const s of furniture.values()) s.destroy()
    furniture.clear()
    for (const s of bodies.values()) s.destroy()
    bodies.clear()
    plannedFor = null
  }

  function placeFurniture(items: RoomItem[]): void {
    for (const item of items) {
      const key = `${item.kind}:${item.slot.x},${item.slot.y}`
      if (furniture.has(key)) continue
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1)
      sprite.eventMode = 'none'
      // A wall piece now HANGS: `placement: 'wall'` used to mean a 0 px offset because there
      // was nothing to hang it on. It mounts on the wall plane behind its slot, at eye height.
      const onWall = item.meta?.placement === 'wall'
      const at = onWall
        ? wallMount(item.slot, ROOM_SLOTS, SLOT_TILES)
        : (() => {
          const s = slotToScreen(item.slot.x, item.slot.y)
          return { sx: s.sx, sy: s.sy + TILE_H }
        })()
      sprite.position.set(at.sx, at.sy)
      sprite.zIndex = onWall ? WALL_PIECE_Z : item.slot.x + item.slot.y
      const url = item.url ?? PLACEHOLDER_URL
      void book.get(url).then((t) => {
        if (!sprite.destroyed) sprite.texture = t   // native pixels; ROOM_ZOOM is the only scale
      })
      furniture.set(key, sprite)
      room.addChild(sprite)
      if (item.meta?.providesLight === true) {
        const glow = new Graphics()
        glow.circle(0, -HEARTH_GLOW_PX / 2, HEARTH_GLOW_PX)
        glow.fill({ color: INTERIOR_HEARTH_GLOW, alpha: 0.14 })
        glow.eventMode = 'none'
        glow.zIndex = sprite.zIndex - 0.5
        sprite.addChild(glow)
      }
    }
  }

  function bodyFor(agentId: string): Sprite {
    let sprite = bodies.get(agentId)
    if (sprite !== undefined) return sprite
    sprite = new Sprite()
    sprite.eventMode = 'none'
    bodies.set(agentId, sprite)
    room.addChild(sprite)
    return sprite
  }

  function sheetFor(agentId: string, records: AssetRecord[]): Sheet {
    const art = characterArt(records, agentId)
    let sheet = sheets.get(agentId)
    if (sheet === undefined || sheet.art.url !== art.url) {
      sheet = { art, texture: null }
      sheets.set(agentId, sheet)
      const claimed = sheet
      void book.get(art.url).then((t) => {
        if (sheets.get(agentId) !== claimed) return
        claimed.texture = art.manifest !== null ? smoothSource(t) : t
      })
    }
    return sheet
  }

  function layoutRoom(): void {
    const state = store.getState()
    if (activeId === null || state === null) return
    const room2 = interiorOf(state, activeId)
    if (room2 === null) return
    const records = store.assetRecords()
    const seq = store.assetsSeq()
    // The plan only moves when the room or the codex does — this runs every frame.
    if (plannedFor !== room2.kind || plannedSeq !== seq) {
      clearRoom()
      plannedFor = room2.kind
      plannedSeq = seq
      plan = roomPlan(room2.kind, records)
      perches = AWAKE_PREFERENCE
        .flatMap((kind) => plan.filter((p) => p.kind === kind))
        .map((p) => p.slot)
      placeFurniture(plan)
      paintFloor(plan, records)   // the light on the floor is the room's own fires
    }

    const sleeping = room2.occupants.filter((id) => state.agents[id]?.asleep === true)
    const beds = bedSlots(room2.kind, sleeping, records)
    let awakeIdx = 0

    const live = new Set(room2.occupants)
    for (const id of room2.occupants) {
      const agent = state.agents[id]
      if (agent === undefined) continue
      const asleep = agent.asleep
      const slot = asleep
        ? beds[id] ?? { x: ROOM_SLOTS - 1, y: ROOM_SLOTS - 1 }
        : perches[awakeIdx++ % Math.max(1, perches.length)] ?? { x: 1, y: 1 }
      const sprite = bodyFor(id)
      const sheet = sheetFor(id, records)
      if (sheet.texture !== null) {
        const cell = characterCell(sheet.texture, sheet.art, asleep ? 'sleep' : 'idle', 'se')
        if (cell !== null) {
          sprite.texture = cell.texture
          sprite.anchor.set(cell.anchor.x, cell.anchor.y)
          sprite.scale.set(cell.scale)
        }
      }
      const { sx, sy } = slotToScreen(slot.x, slot.y)
      sprite.position.set(sx, sy + TILE_H)
      sprite.zIndex = slot.x + slot.y + 0.5
    }
    for (const [id, sprite] of bodies) {
      if (live.has(id)) continue
      sprite.destroy()
      bodies.delete(id)
    }
  }

  function setActive(structureId: string | null): void {
    if (structureId === activeId) return
    if (structureId !== null && (store.getState() === null || interiorOf(store.getState()!, structureId) === null)) return
    activeId = structureId
    if (structureId !== null) clearRoom()
    notify()
  }

  const offEvents = store.onEvents((evts: SimEvent[]) => {
    if (followedId === null) return
    for (const ev of evts) {
      const p = ev.payload as { agentId?: string; id?: string; structureId?: string }
      const who = p.agentId ?? p.id
      if (who !== followedId) continue
      if (ev.type === 'agent_entered' && typeof p.structureId === 'string') setActive(p.structureId)
      else if (ev.type === 'agent_exited') setActive(null)
    }
  })

  const tick = (): void => {
    const now = app.ticker.lastTime
    const entered = activeId !== null
    phase = reduced()
      ? { phase: entered ? 'inside' : 'town', sinceMs: now }
      : advanceInterior(phase, entered, now)

    const t = phase.phase === 'inside' ? 1
      : phase.phase === 'town' ? 0
        : Math.min(1, Math.max(0, (now - phase.sinceMs) / INTERIOR_FADE_MS))
    const alpha = phase.phase === 'entering' ? t : phase.phase === 'exiting' ? 1 - t : (entered ? 1 : 0)

    root.visible = alpha > 0
    if (!root.visible) return
    root.alpha = alpha
    veil.clear()
    veil.rect(0, 0, app.screen.width, app.screen.height)
    veil.fill({ color: INTERIOR_VEIL, alpha: INTERIOR_VEIL_ALPHA })
    room.scale.set(ROOM_ZOOM)
    // The whole box, walls included — centring the floor alone put the top of the walls off
    // the top of the stage, which is what the browser showed.
    room.position.set(
      app.screen.width / 2,
      roomOriginY(app.screen.height, ROOM_OFFSET_Y, ROOM_ZOOM, ROOM_SLOTS, SLOT_TILES, WALL_H_TILES),
    )
    if (activeId !== null) layoutRoom()
  }
  app.ticker.add(tick)

  return {
    setActive,
    setFollowed: (agentId) => { followedId = agentId },
    isActive: () => activeId !== null,
    activeId: () => activeId,
    onChange: (cb) => {
      changeCbs.push(cb)
      return () => {
        const i = changeCbs.indexOf(cb)
        if (i >= 0) changeCbs.splice(i, 1)
      }
    },
    destroy: () => {
      offEvents()
      app.ticker.remove(tick)
      clearRoom()
      sheets.clear()
      changeCbs.length = 0
      root.destroy({ children: true })
    },
  }
}
