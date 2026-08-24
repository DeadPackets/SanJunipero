import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import type { AssetRecord, SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { materialMatrix, resolveMaterial } from './groundField.js'
import { characterArt, type TextureBook } from './textures.js'
import { characterCell } from './characters.js'
import {
  advanceInterior, bedSlots, contactShadow, furnishingId, furnishingScale,
  interiorOf, interiorOrder, interiorPieces, isFlat, roomPlan,
  type InteriorPhaseState, type PlacedBody, type RoomItem,
} from './interiors.js'
import { SCENE_TOTAL_MS } from '../ui/sceneTransition.js'
import { doorTileOf } from './entities.js'
import type { ZoomStop } from './camera.js'
import {
  ROOM_SHELL_INK, ROOM_SHELL_PAINT, ROOM_SLOTS, SLOT_TILES, WALL_H_TILES,
  drawFloorBase, drawFloorLight, drawFloorTop, drawWalls, floorPolyOf, floorPools,
  roomMaskPoly, roomOriginY, roomZoomFor, slotCentreScreen, slotSpanCentre, wallMount,
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

export { ROOM_SLOTS, ROOM_ZOOM_CLOSE, ROOM_ZOOM_SHORT, SLOT_TILES, roomZoomFor } from './roomShell.js'
/** How far the room is lifted clear of the transport bar AT MOST — `roomOriginY` clamps it to
 *  the headroom the stage has, because a courtesy that pushes a wall off the top is not one. */
export const ROOM_OFFSET_Y = 40
export const HEARTH_GLOW_PX = 26
export const PLACEHOLDER_URL = '/assets/placeholder/item.png'
/** A hung piece is on the back plane, so it draws behind everything standing on the floor
 *  and in front of the wall itself — one depth, because a wall has no depth of its own. */
export const WALL_PIECE_Z = -1

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
  // A room is a box, and nothing drawn inside it belongs outside it. One mask settles that for
  // every prop: a hearth's glow is a child of its sprite and grew with the furniture scale
  // until it was painting a pale disc across the town.
  const roomMask = new Graphics()
  roomMask.poly(roomMaskPoly(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES))
  roomMask.fill(0xffffff)
  room.addChild(roomMask)
  room.mask = roomMask
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
  // ONE shadow plane, under everything that stands in the room — the same arrangement the
  // town's eight-layer contract uses. Nothing floats, and a shadow can never sort in front of
  // the body it belongs to because it is not in the sort at all.
  const shadows = new Graphics()
  shadows.zIndex = -1.5
  room.addChild(walls, floorArt, floor, floorMask, floorLight, floorTop, shadows)

  const furniture = new Map<string, Sprite>()   // piece id → sprite
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

  const onWall = (item: RoomItem): boolean => item.meta?.placement === 'wall'
  const sizeOf = (item: RoomItem): { w: number; h: number } => item.meta?.slots ?? { w: 1, h: 1 }

  /**
   * A furnishing a body lies IN is drawn as TWO sprites cut from ONE texture, split at its
   * own mid-line, so the body can go between them. Everything else is one sprite. The two
   * halves reassemble exactly: each keeps a bottom anchor, and the back half is lifted by the
   * front half's own height.
   */
  function applyHalf(sprite: Sprite, t: Texture, half: 'back' | 'front' | null): void {
    if (half === null) {
      sprite.texture = t
      return
    }
    const f = t.frame
    const cut = Math.round(f.height / 2)
    const rect = half === 'back'
      ? new Rectangle(f.x, f.y, f.width, cut)
      : new Rectangle(f.x, f.y + cut, f.width, f.height - cut)
    sprite.texture = new Texture({ source: t.source, frame: rect })
    if (half === 'back') sprite.position.y -= (f.height - cut) * sprite.scale.y
  }

  function placeFurniture(items: RoomItem[]): void {
    const floorItems = items.filter((i) => !onWall(i))
    const byId = new Map(floorItems.map((i) => [furnishingId(i.kind, i.slot), i]))

    for (const item of items.filter(onWall)) {
      // A wall piece now HANGS: `placement: 'wall'` used to mean a 0 px offset because there
      // was nothing to hang it on. It mounts on the wall plane behind its slot, at eye height.
      const at = wallMount(item.slot, ROOM_SLOTS, SLOT_TILES)
      addPiece(furnishingId(item.kind, item.slot), item, null, at.sx, at.sy, WALL_PIECE_Z)
    }

    for (const p of interiorPieces(floorItems, [])) {
      const item = byId.get(p.half === null ? p.id : p.id.slice(0, p.id.indexOf('#')))
      if (item === undefined) continue
      const foot = slotSpanCentre(item.slot, sizeOf(item), SLOT_TILES)
      addPiece(p.id, item, p.half, foot.sx, foot.sy, 0)
    }
  }

  function addPiece(
    key: string, item: RoomItem, half: 'back' | 'front' | null, sx: number, sy: number, z: number,
  ): void {
    if (furniture.has(key)) return
    const sprite = new Sprite()
    // A flat piece is anchored at the CENTRE of its ground; a standing piece at the bottom of
    // its texture, which is the near vertex of the ground it stands on.
    sprite.anchor.set(0.5, isFlat(item.kind) ? 0.5 : 1)
    sprite.eventMode = 'none'
    sprite.scale.set(furnishingScale(SLOT_TILES))
    sprite.position.set(sx, sy)
    sprite.zIndex = z
    // ★ THE ROOM AND ITS FURNITURE ARRIVE IN THE SAME FRAME. `book.get(...).then(...)` alone
    // could not do that: the plan is built inside the frame that first paints the room, and a
    // `.then` — even on a texture already in the book — runs on a microtask, i.e. after that
    // frame is on the glass. Every room's first painted frame was therefore an empty room, and
    // a viewer sampling the screen at intervals sees "the walls, and then the furniture".
    // `peek` closes it for a warm book; a cold one still takes the round trip and the fade.
    const url = item.url ?? PLACEHOLDER_URL
    const inHand = book.peek(url)
    if (inHand !== null) applyHalf(sprite, inHand, half)   // native px; the room's zoom is the only scale
    else {
      void book.get(url).then((t) => {
        if (!sprite.destroyed) applyHalf(sprite, t, half)
      })
    }
    furniture.set(key, sprite)
    room.addChild(sprite)
    // The glow belongs to the whole furnishing, so only the front half of a split one wears it.
    if (item.meta?.providesLight === true && half !== 'back') {
      const glow = new Graphics()
      glow.circle(0, -HEARTH_GLOW_PX / 2, HEARTH_GLOW_PX)
      glow.fill({ color: INTERIOR_HEARTH_GLOW, alpha: 0.14 })
      glow.eventMode = 'none'
      glow.zIndex = -0.5
      sprite.addChild(glow)
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
        claimed.texture = t
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
    const floorItems = plan.filter((i) => !onWall(i))
    let awakeIdx = 0

    // Whom each body is with. A sleeper is IN the furnishing whose cells it was given; an
    // awake body is AT its perch. `interiorPieces` turns that into where it stands.
    const placed: PlacedBody[] = []
    const live = new Set(room2.occupants)
    for (const id of room2.occupants) {
      const agent = state.agents[id]
      if (agent === undefined) continue
      const asleep = agent.asleep
      const own = asleep
        ? beds[id] ?? { x: ROOM_SLOTS - 1, y: ROOM_SLOTS - 1 }
        : perches[awakeIdx++ % Math.max(1, perches.length)] ?? { x: 1, y: 1 }
      const host = floorItems.find((i) => hosts(i, own)) ?? null
      placed.push({ id, slot: own, inside: host === null ? null : furnishingId(host.kind, host.slot) })
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
    }

    // ONE painter's order for the room, from the same authority the town answers to. No
    // module invents a number, so a sleeper can no longer sit on top of the bed it is in.
    const pieces = interiorPieces(floorItems, placed)
    const index = new Map(interiorOrder(pieces).map((id, i) => [id, i]))
    shadows.clear()
    for (const p of pieces) {
      const node = p.kind === 'body' ? bodies.get(p.id) : furniture.get(p.id)
      if (node === undefined) continue
      node.zIndex = index.get(p.id) ?? 0
      if (p.kind === 'body') {
        const foot = slotCentreScreen(p.slot.x, p.slot.y, SLOT_TILES)
        node.position.set(foot.sx, foot.sy)
      }
      // A split furnishing casts ONE shadow, under its front half, not two; a flat one casts
      // none, because it IS on the floor.
      if (p.half === 'back' || node.texture.width <= 1) continue
      if (p.kind === 'furniture' && isFlat(p.id.slice(0, p.id.indexOf(':')))) continue
      const s = contactShadow(node.texture.width * node.scale.x)
      // A body is anchored at its FEET, which already is the ground centre; a furnishing is
      // anchored at its texture's bottom, which is the near vertex of the ground it stands on.
      const foot = p.kind === 'body'
        ? slotCentreScreen(p.slot.x, p.slot.y, SLOT_TILES)
        : { sx: node.position.x, sy: node.position.y - s.lift }
      shadows.ellipse(foot.sx, foot.sy, s.rx, s.ry)
      shadows.fill({ color: ROOM_SHELL_INK, alpha: s.alpha })
    }

    for (const [id, sprite] of bodies) {
      if (live.has(id)) continue
      sprite.destroy()
      bodies.delete(id)
    }
  }

  /** The furnishing a body at `slot` is with: the one whose footprint covers that slot. */
  function hosts(item: RoomItem, slot: { x: number; y: number }): boolean {
    const size = sizeOf(item)
    return slot.x >= item.slot.x && slot.x < item.slot.x + size.w
      && slot.y >= item.slot.y && slot.y < item.slot.y + size.h
  }

  // ★ A CARD APPEARING IS NOT GOING INSIDE. The veil used to rise over a town that never
  // moved, so entering a room read as a panel opening. The camera pushes in to the door tile
  // while the veil rises, and leaving puts it back on the exact point it left — `centerOnScreen`
  // rather than `centerOn`, because a whole-tile restore lands somewhere the viewer did not
  // leave from.
  const PUSH_IN_STOP: ZoomStop = 3
  let beforePush: { sx: number; sy: number; stop: ZoomStop } | null = null

  function pushInTo(structureId: string): void {
    const s = store.getState()?.structures[structureId]
    if (s === undefined) return
    const v = scene.viewRect()
    beforePush = { sx: v.x + v.w / 2, sy: v.y + v.h / 2, stop: scene.getZoomStop() }
    const door = doorTileOf(s)
    scene.centerOn(door.x, door.y)
    if (scene.getZoomStop() !== PUSH_IN_STOP) scene.setZoom(PUSH_IN_STOP)
  }

  function restoreCamera(): void {
    if (beforePush === null) return
    const { sx, sy, stop } = beforePush
    beforePush = null
    if (scene.getZoomStop() !== stop) scene.setZoom(stop)
    scene.centerOnScreen(sx, sy)
  }

  function setActive(structureId: string | null): void {
    if (structureId === activeId) return
    if (structureId !== null && (store.getState() === null || interiorOf(store.getState()!, structureId) === null)) return
    activeId = structureId
    if (structureId !== null) {
      clearRoom()
      pushInTo(structureId)
    } else restoreCamera()
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
        : Math.min(1, Math.max(0, (now - phase.sinceMs) / SCENE_TOTAL_MS))
    const alpha = phase.phase === 'entering' ? t : phase.phase === 'exiting' ? 1 - t : (entered ? 1 : 0)

    root.visible = alpha > 0
    if (!root.visible) return
    root.alpha = alpha
    veil.clear()
    veil.rect(0, 0, app.screen.width, app.screen.height)
    veil.fill({ color: INTERIOR_VEIL, alpha: INTERIOR_VEIL_ALPHA })
    // ★ AS CLOSE AS THIS STAGE CAN HOLD THE WHOLE ROOM — never a bare constant. At 4 a body
    // is the height it is out of doors and library art doubles cleanly; at 3 it was 156 px
    // against 208 and a 1.5x composite. `roomZoomFor` answers 3 on a stage too short for it.
    const zoom = roomZoomFor(app.screen.height)
    room.scale.set(zoom)
    // The whole box, walls included — centring the floor alone put the top of the walls off
    // the top of the stage, which is what the browser showed.
    room.position.set(
      app.screen.width / 2,
      roomOriginY(app.screen.height, ROOM_OFFSET_Y, zoom, ROOM_SLOTS, SLOT_TILES, WALL_H_TILES),
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
