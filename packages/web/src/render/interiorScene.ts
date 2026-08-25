import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { CITY_INTERIOR_SLOTS, type AssetRecord, type SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { materialMatrix, resolveMaterial } from './groundField.js'
import { characterArt, type TextureBook } from './textures.js'
import { characterCell } from './characters.js'
import {
  advanceInterior, bedSlots, contactShadow, furnishingId, furnishingScale,
  interiorBodyScale, interiorOf, interiorOrder, interiorPieces, isFlat, roomPlan, roomSizeOf,
  slotGridOf,
  type InteriorPhaseState, type PlacedBody, type RoomItem,
} from './interiors.js'
import {
  INTERIOR_PX_SCALE, ROOM_TILES, WALL_PIECES_THAT_STAND, interiorPath, roomMapOf, seatLiftPx,
  standingTiles,
  type MapPiece, type RoomMap, type Tile,
} from './interiorMap.js'
import {
  FURNISHING_WALL_PIECE, WALL_STRIP_TILES, flagstoneRegions, hasInteriorTileset,
  resolveInteriorMaterial, resolveInteriorPiece, wallCourses, wallStripAt, wallStripWidth,
  wallTransform,
} from './interiorTileset.js'
import { SCENE_TOTAL_MS } from '../ui/sceneTransition.js'
import { doorTileOf } from './entities.js'
import type { ZoomStop } from './camera.js'
import {
  ROOM_SHELL_INK, ROOM_SHELL_PAINT, WALL_H_PX, WALL_TINT,
  ceilingBeams, drawFloorBase, drawFloorLight, drawFloorTop, drawWalls, floorPolyOf, floorPools,
  floorRegionPoly, roomMaskPoly, roomOriginX, roomOriginY, roomZoomFor, tileCentreScreen,
  tileSpanCentre, wallMount,
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

export { ROOM_ZOOM, roomZoomFor } from './roomShell.js'
export { ROOM_TILES } from './interiorMap.js'
/** How far the room is lifted clear of the transport bar AT MOST — `roomOriginY` clamps it to
 *  the headroom the stage has, because a courtesy that pushes a wall off the top is not one. */
export const ROOM_OFFSET_Y = 40
export const HEARTH_GLOW_PX = 26 * INTERIOR_PX_SCALE
export const PLACEHOLDER_URL = '/assets/placeholder/item.png'
/** A hung piece is on the back plane, so it draws behind everything standing on the floor
 *  and in front of the wall itself — one depth, because a wall has no depth of its own. */
export const WALL_PIECE_Z = -1

// Awake occupants stand where the room's life is: the hearth first, then the table, then
// whatever else is furnished. Deterministic, so two viewers see the same room.
const AWAKE_PREFERENCE = ['hearth', 'table', 'bench', 'chair', 'anvil', 'shelf'] as const
/** Where a body goes when the room furnishes it nowhere to be: just inside the threshold. A
 *  function of the room now that rooms differ in size — the near corner of a farmhouse is not
 *  the near corner of a house. */
const spareTile = (room: { w: number; h: number }): Tile => ({ x: room.w - 1, y: room.h - 1 })
/** How long a body takes to cross one interior tile. A step, not a glide. */
export const WALK_MS_PER_TILE = 420

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

  // ★ THE ROOM'S SIZE IS THE BUILDING'S NOW, so it is state and not a module constant. It is
  // set from the kind the moment a room is planned; `ROOM_TILES` is the house's, and the house
  // is only one of six. Everything that draws a plane reads this.
  let roomTiles: { w: number; h: number } = ROOM_TILES
  let roomSlots: { w: number; h: number } = CITY_INTERIOR_SLOTS

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
  roomMask.poly(roomMaskPoly(roomTiles, WALL_H_PX))
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
  const floorStone = new Graphics()    // flagstone under the hearth and inside the door
  floorStone.zIndex = -2.75
  // The authored wall elevations, sheared onto the two wall planes. Behind the painted shell's
  // own rim and in front of nothing: a wall has no depth of its own.
  const wallArt = new Container()
  wallArt.zIndex = -3.5
  const floor = new Graphics()
  floor.zIndex = -2.5
  const floorLight = new Graphics()
  floorLight.zIndex = -2.25
  const floorMask = new Graphics()
  floorMask.poly(floorPolyOf(roomTiles))
  floorMask.fill(0xffffff)
  floorLight.mask = floorMask
  const floorTop = new Graphics()
  floorTop.zIndex = -2
  // ONE shadow plane, under everything that stands in the room — the same arrangement the
  // town's eight-layer contract uses. Nothing floats, and a shadow can never sort in front of
  // the body it belongs to because it is not in the sort at all.
  const shadows = new Graphics()
  shadows.zIndex = -1.5
  room.addChild(walls, wallArt, floorArt, floorStone, floor, floorMask, floorLight, floorTop, shadows)

  const furniture = new Map<string, Sprite>()   // piece id → sprite
  const bodies = new Map<string, Sprite>()      // agentId → sprite
  const sheets = new Map<string, Sheet>()

  let activeId: string | null = null
  let followedId: string | null = null
  let phase: InteriorPhaseState = { phase: 'town', sinceMs: 0 }
  let plannedFor: string | null = null          // the kind the furniture map was built for
  let plannedSeq = -1
  let plan: RoomItem[] = []
  let map: RoomMap = roomMapOf([])
  let lightKinds: ReadonlySet<string> = new Set()
  let perches: Tile[] = []
  /** The kinds the wall itself draws this room, so no object is drawn for them as well. */
  let elevated: ReadonlySet<string> = new Set()
  /** Where each body is on the room map, and the tiles it still has to cross to get where it
   *  is going. The engine has no interior position, so this is the renderer's own. */
  const walking = new Map<string, { at: Tile; path: Tile[]; t: number }>()
  const changeCbs: Array<(id: string | null) => void> = []

  // A cut, not a fade, for a viewer who asked for less motion — the destination is the
  // point, and 260ms of dissolve is the part they opted out of.
  const reduced = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const notify = (): void => { for (const cb of changeCbs) cb(activeId) }

  // ART INDEPENDENCE, the interior's half. The floor takes a continuous material the moment
  // the codex holds one and reads as a palette-true plane until then — the same hot-swap law
  // the outdoor ground answers to, and the same reason a missing texture is never a hole.
  const pools = (m: RoomMap): ReturnType<typeof floorPools> =>
    floorPools(m.pieces.map((p) => ({ tile: p.tile, light: lightKinds.has(p.kind) })), roomTiles)

  let floorMaterial: string | null = null
  let stoneMaterial: string | null = null

  /** The flagstone patches, drawn over the boards: a hearth stands on stone, and so does the
   *  ground just inside a door. Nothing here exists without the art, so nothing here is a hole
   *  when the codex is empty. */
  function paintStone(m: RoomMap, records: AssetRecord[]): void {
    const url = resolveInteriorMaterial(records, 'interior-flagstone')
    stoneMaterial = url
    floorStone.clear()
    if (url === null) return
    const hearths = m.pieces.filter((p) => lightKinds.has(p.kind)).map((p) => p.tile)
    void book.get(url).then((t) => {
      if (stoneMaterial !== url || floorStone.destroyed) return
      t.source.addressMode = 'repeat'
      floorStone.clear()
      for (const r of flagstoneRegions(hearths, roomTiles)) {
        floorStone.poly(floorRegionPoly(r))
        floorStone.fill({ texture: t, matrix: materialMatrix('interior-flagstone', 1) })
      }
    })
  }

  function paintFloor(m: RoomMap, records: AssetRecord[]): void {
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
        floorArt.poly(floorPolyOf(roomTiles))
        floorArt.fill({ texture: t, matrix: materialMatrix('interior-floor', 0) })
        floorArt.visible = true
      })
    }
    floor.clear()
    drawFloorBase(floor, roomTiles, url === null ? ROOM_SHELL_PAINT.floor : null)
    paintStone(m, records)
    floorLight.clear()
    drawFloorLight(floorLight, pools(m), roomTiles, ceilingBeams(WALL_STRIP_TILES, roomTiles))
  }

  /**
   * ★ THE WALLS, FROM ART. Every wall is laid plain end to end first so there is never a gap,
   * then each feature is drawn over it: the window and the door the room must have, and the
   * chimney breast that IS the hearth. A strip is authored square-on and sheared onto its own
   * wall plane, so the art is never stretched along the wall — see `interiorTileset.ts`.
   *
   * When the codex holds no tileset this draws nothing and the code-painted shell stands,
   * which is the same art-independence law the ground answers to.
   */
  function paintWalls(m: RoomMap, records: AssetRecord[]): void {
    wallArt.removeChildren().forEach((c) => c.destroy())
    const art = hasInteriorTileset(records)
    walls.visible = !art          // painted trapezoids OR authored elevations, never both
    if (!art) return
    const features = m.pieces
      .filter((p) => p.placement === 'wall')
      .flatMap((p) => {
        const wall = p.tile.x === 0 && p.tile.y > 0 ? 'back-left' as const : 'back-right' as const
        return [{ kind: p.kind, wall, atTiles: wall === 'back-right' ? p.tile.x : p.tile.y }]
      })
    for (const course of wallCourses(features, roomTiles)) {
      const url = resolveInteriorPiece(records, course.piece)
      if (url === null) continue
      const width = wallStripWidth(course.wall, course.atTiles, roomTiles)
      if (width <= 0) continue
      const at = wallStripAt(course.wall, course.atTiles)
      const t = wallTransform(course.wall)
      const sprite = new Sprite()
      sprite.eventMode = 'none'
      sprite.anchor.set(0, 0)
      sprite.position.set(at.sx, at.sy)
      sprite.skew.y = t.skewY
      sprite.scale.set(t.scaleX, 1)
      sprite.tint = tintOf(WALL_TINT[course.wall])
      wallArt.addChild(sprite)
      const apply = (tex: Texture): void => {
        if (sprite.destroyed) return
        // A strip that would overrun its wall is CROPPED, never squeezed: the art keeps its
        // own pixel pitch and the corner simply arrives sooner.
        sprite.texture = width >= tex.frame.width
          ? tex
          : new Texture({
            source: tex.source,
            frame: new Rectangle(tex.frame.x, tex.frame.y, width, tex.frame.height),
          })
      }
      const inHand = book.peek(url)
      if (inHand !== null) apply(inHand)
      else void book.get(url).then(apply)
    }
  }

  /** A multiplier on white, as the tint colour Pixi wants. */
  const tintOf = (k: number): number => {
    const c = Math.round(255 * k)
    return (c << 16) | (c << 8) | c
  }

  /** Which of the room's furnishings the wall itself draws, so nothing is drawn twice. */
  const elevationKinds = (m: RoomMap, records: AssetRecord[]): ReadonlySet<string> =>
    new Set(m.pieces
      .filter((p) => p.placement === 'wall')
      .map((p) => p.kind)
      .filter((k) => {
        const piece = FURNISHING_WALL_PIECE[k]
        return piece !== undefined && resolveInteriorPiece(records, piece) !== null
      }))

  drawWalls(walls, roomTiles, WALL_H_PX)
  drawFloorTop(floorTop, roomTiles)
  paintFloor(roomMapOf([]), [])

  function clearRoom(): void {
    for (const s of furniture.values()) s.destroy()
    furniture.clear()
    for (const s of bodies.values()) s.destroy()
    bodies.clear()
    walking.clear()
    plannedFor = null
  }

  const onWall = (item: RoomItem): boolean => item.meta?.placement === 'wall'
  const sizeOf = (item: RoomItem): { w: number; h: number } => item.meta?.slots ?? { w: 1, h: 1 }

  /** The room's furnishings as map pieces, in the plan's own order — index for index, so a
   *  piece and the library record that draws it can never come apart. */
  const mapOf = (items: RoomItem[]): RoomMap => roomMapOf(items.map((i) => ({
    kind: i.kind, slot: i.slot, size: sizeOf(i),
    placement: onWall(i) ? 'wall' : 'floor', flat: isFlat(i.kind),
  })), roomTiles, roomSlots)

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

  /**
   * ★ A WALL FURNISHING IS DRAWN ONCE, AND THE WALL DECIDES WHICH WAY IT FACES (task 84 §2).
   *
   * The landed room hung EVERY `placement: 'wall'` piece at eye height, on a wall chosen by
   * `slot.x > slot.y`, with nothing anywhere saying which way the piece then faced. That is
   * what put a fireplace halfway up a wall, and it is the same defect the mock showed as two
   * fireplaces in one corner. Now: the wall is the one the piece's TILE is actually against,
   * its facing is that wall's own (`WALL_FACING`, and the type has no third member), and a
   * piece that reaches the ground STANDS at the foot of its wall instead of hanging over it.
   */
  function placeFurniture(m: RoomMap, items: RoomItem[], asElevation: ReadonlySet<string>): void {
    const onFloor: Array<{ piece: MapPiece; item: RoomItem }> = []
    m.pieces.forEach((piece, i) => {
      const item = items[i]
      if (item === undefined) return
      // ★ ONCE, AND ONLY ONCE. When the tileset holds an elevation for this kind, the wall IS
      // the furnishing — the chimney breast is the hearth — so no object is drawn as well. That
      // duplicate is what the mock showed as two fireplaces in one corner.
      if (asElevation.has(piece.kind)) return
      if (piece.placement !== 'wall' || WALL_PIECES_THAT_STAND.has(piece.kind)) {
        onFloor.push({ piece, item })
        return
      }
      const at = wallMount(piece.tile)
      if (at === null) return          // a wall piece against no wall is a placement error
      addPiece(furnishingId(piece.kind, piece.tile), item, null, at.sx, at.sy, WALL_PIECE_Z)
    })

    const placed = onFloor.map(({ piece, item }) =>
      ({ kind: piece.kind, tile: piece.tile, meta: item.meta }))
    const byId = new Map(onFloor.map(({ piece, item }) =>
      [furnishingId(piece.kind, piece.tile), item]))
    for (const p of interiorPieces(placed, [])) {
      const item = byId.get(p.half === null ? p.id : p.id.slice(0, p.id.indexOf('#')))
      if (item === undefined) continue
      // ★ `p.anchor`, NOT `p.tile`. The split tile is the DEPTH box; spending it on the
      // position as well tore every 'in' furnishing in two — see `RoomPiece.anchor`.
      const foot = tileSpanCentre(p.anchor.tile, p.anchor.size)
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
    // ★ NATIVE. `furnishingScale()` is 1 under Option C: the art is authored at exactly the
    // span its footprint covers on the 128×64 interior tile and the scene zoom is 1, so
    // nothing in this room is resampled on its way to the glass. It used to be 0.5 against a
    // zoom of 4 — a composite of 2, i.e. every 128 px sprite pixel-doubled by the camera.
    sprite.scale.set(furnishingScale())
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
    if (inHand !== null) applyHalf(sprite, inHand, half)   // native px; the room's zoom is 1
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

  /**
   * ★ A BODY WALKS TO WHERE IT IS GOING, AND WALKS ROUND WHAT IS IN THE WAY.
   *
   * The engine has NO interior position — an agent indoors carries `insideId` and nothing else
   * — so where a body stands in the room is the renderer's own truth, and this is not invented
   * world behaviour: the room says which tile a body belongs on, and this is how it gets
   * there. `interiorPath` is the four-neighbour law the town walks by, run over the room's
   * blocked tiles, so a body crosses AROUND the table instead of through it.
   */
  function retarget(id: string, goal: Tile, m: RoomMap): void {
    const w = walking.get(id)
    if (w === undefined) {
      walking.set(id, { at: goal, path: [], t: 0 })
      return
    }
    const end = w.path.at(-1) ?? w.at
    if (end.x === goal.x && end.y === goal.y) return
    w.path = interiorPath(m, w.at, goal) ?? []
    w.t = 0
    if (w.path.length === 0) w.at = goal    // nowhere to walk to: be there
  }

  /** One step of the walk, in room space — where the body is drawn this frame. */
  function advanceWalk(id: string, dtMs: number): { sx: number; sy: number } {
    const w = walking.get(id)
    if (w === undefined) return { sx: 0, sy: 0 }
    const next = w.path[0]
    if (next === undefined) return tileCentreScreen(w.at.x, w.at.y)
    w.t = Math.min(1, w.t + dtMs / WALK_MS_PER_TILE)
    const a = tileCentreScreen(w.at.x, w.at.y)
    const b = tileCentreScreen(next.x, next.y)
    if (w.t >= 1) {
      w.at = next
      w.path.shift()
      w.t = 0
      return b
    }
    return { sx: a.sx + (b.sx - a.sx) * w.t, sy: a.sy + (b.sy - a.sy) * w.t }
  }

  function layoutRoom(dtMs: number): void {
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
      // The room's own floor plan, before anything is drawn on it. Both masks are cut from it,
      // so a farmhouse is not clipped to a house's box.
      roomTiles = roomSizeOf(room2.kind)
      roomSlots = slotGridOf(room2.kind)
      roomMask.clear()
      roomMask.poly(roomMaskPoly(roomTiles, WALL_H_PX))
      roomMask.fill(0xffffff)
      floorMask.clear()
      floorMask.poly(floorPolyOf(roomTiles))
      floorMask.fill(0xffffff)
      plan = roomPlan(room2.kind, records)
      lightKinds = new Set(plan.filter((p) => p.meta?.providesLight === true).map((p) => p.kind))
      map = mapOf(plan)
      // ★ AN AWAKE BODY STANDS BESIDE THE THING IT IS USING, NOT ON IT. There is floor to stand
      // on now, so "at the hearth" is a real tile a real body occupies.
      perches = AWAKE_PREFERENCE
        .flatMap((kind) => map.pieces.filter((p) => p.kind === kind))
        .flatMap((p) => standingTiles(map, p).slice(0, 1))
      elevated = elevationKinds(map, records)
      placeFurniture(map, plan, elevated)
      paintFloor(map, records)   // the light on the floor is the room's own fires
      paintWalls(map, records)
    }

    const sleeping = room2.occupants.filter((id) => state.agents[id]?.asleep === true)
    const beds = bedSlots(room2.kind, sleeping, records)
    // What is actually STANDING in the room: everything on the floor, plus the wall pieces
    // that reach the ground and are not already drawn as part of the wall.
    const standing = map.pieces.filter((p) => !elevated.has(p.kind)
      && (p.placement !== 'wall' || WALL_PIECES_THAT_STAND.has(p.kind)))
    let awakeIdx = 0

    // Whom each body is with. A sleeper is IN the furnishing whose cells it was given; an
    // awake body is AT a tile BESIDE its perch, and walks there.
    const placed: PlacedBody[] = []
    const live = new Set(room2.occupants)
    for (const id of room2.occupants) {
      const agent = state.agents[id]
      if (agent === undefined) continue
      const asleep = agent.asleep
      const goal = asleep
        ? beds[id] ?? spareTile(roomTiles)
        : perches[awakeIdx++ % Math.max(1, perches.length)] ?? spareTile(roomTiles)
      retarget(id, goal, map)
      const own = asleep ? goal : walking.get(id)?.at ?? goal
      const host = standing.find((p) => hosts(p, own)) ?? null
      placed.push({ id, tile: own, inside: host === null ? null : furnishingId(host.kind, host.tile) })
      const sprite = bodyFor(id)
      const sheet = sheetFor(id, records)
      if (sheet.texture !== null) {
        const cell = characterCell(sheet.texture, sheet.art, asleep ? 'sleep' : 'idle', 'se')
        if (cell !== null) {
          sprite.texture = cell.texture
          sprite.anchor.set(cell.anchor.x, cell.anchor.y)
          // ★ THE ROOM'S OWN SCALE, NOT THE TOWN'S. This was `cell.scale × INTERIOR_PX_SCALE`,
          // which carries a body across on the PIXEL factor and leaves the WORLD factor behind
          // — and a room whose tile is a metre then shows a person taller than its own wall.
          sprite.scale.set(interiorBodyScale(cell.scale))
        }
      }
    }

    // ONE painter's order for the room, from the same authority the town answers to. No
    // module invents a number, so a sleeper can no longer sit on top of the bed it is in.
    const items = standing.map((p) => ({
      kind: p.kind, tile: p.tile,
      meta: plan.find((i) => i.kind === p.kind)?.meta ?? null,
    }))
    const pieces = interiorPieces(items, placed)
    const index = new Map(interiorOrder(pieces).map((id, i) => [id, i]))
    // What each body is INSIDE, by kind — a bed lifts a sleeper onto its mattress.
    const hostKind = new Map(placed.map((b) =>
      [b.id, b.inside === null ? null : b.inside.slice(0, b.inside.indexOf(':'))]))
    shadows.clear()
    for (const p of pieces) {
      const node = p.kind === 'body' ? bodies.get(p.id) : furniture.get(p.id)
      if (node === undefined) continue
      node.zIndex = index.get(p.id) ?? 0
      const lift = p.kind === 'body' ? seatLiftPx(hostKind.get(p.id) ?? null) : 0
      if (p.kind === 'body') {
        const foot = advanceWalk(p.id, dtMs)
        node.position.set(foot.sx, foot.sy - lift)
      }
      // A split furnishing casts ONE shadow, under its front half, not two; a flat one casts
      // none, because it IS on the floor — and neither does a body that is off the floor, in a
      // bed. A contact shadow says "this thing touches the ground here", and it does not.
      if (p.half === 'back' || node.texture.width <= 1 || lift > 0) continue
      if (p.kind === 'furniture' && isFlat(p.id.slice(0, p.id.indexOf(':')))) continue
      const s = contactShadow(node.texture.width * node.scale.x)
      // A body is anchored at its FEET, which already is the ground centre; a furnishing is
      // anchored at its texture's bottom, which is the near vertex of the ground it stands on.
      const foot = p.kind === 'body'
        ? { sx: node.position.x, sy: node.position.y }
        : { sx: node.position.x, sy: node.position.y - s.lift }
      shadows.ellipse(foot.sx, foot.sy, s.rx, s.ry)
      shadows.fill({ color: ROOM_SHELL_INK, alpha: s.alpha })
    }

    for (const [id, sprite] of bodies) {
      if (live.has(id)) continue
      sprite.destroy()
      bodies.delete(id)
      walking.delete(id)
    }
  }

  /** The furnishing a body on `tile` is with: the one whose footprint covers that tile. */
  function hosts(piece: MapPiece, tile: Tile): boolean {
    return tile.x >= piece.tile.x && tile.x < piece.tile.x + piece.size.w
      && tile.y >= piece.tile.y && tile.y < piece.tile.y + piece.size.h
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

  let lastTickMs = 0
  const tick = (): void => {
    const now = app.ticker.lastTime
    const dtMs = lastTickMs === 0 ? 0 : Math.min(100, now - lastTickMs)
    lastTickMs = now
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
    // ★ NEVER A BARE CONSTANT. Option C has one integer scene zoom and it is 1: the interior
    // tile is authored at the size it reaches the glass, so every other factor resamples pixel
    // art. `roomZoomFor` is still asked, because the day the room has a second answer this is
    // where it arrives.
    const zoom = roomZoomFor(app.screen.height)
    room.scale.set(zoom)
    // The whole box, walls included — centring the floor alone put the top of the walls off
    // the top of the stage, which is what the browser showed.
    room.position.set(
      roomOriginX(app.screen.width, zoom, roomTiles),
      roomOriginY(app.screen.height, ROOM_OFFSET_Y, zoom, roomTiles, WALL_H_PX),
    )
    if (activeId !== null) layoutRoom(dtMs)
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
