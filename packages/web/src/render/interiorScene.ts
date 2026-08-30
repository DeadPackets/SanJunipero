import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { CITY_INTERIOR_SLOTS, type AssetRecord, type SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { materialMatrix, resolveMaterial } from './groundField.js'
import { characterArt, type TextureBook } from './textures.js'
import { characterCell } from './characters.js'
import {
  advanceInterior,
  bedCells,
  bedSlots,
  contactShadow,
  furnishingId,
  furnishingScale,
  interiorBodyScale,
  interiorOf,
  interiorOrder,
  interiorPieces,
  isFlat,
  roomLights,
  roomPlan,
  roomSizeOf,
  slotGridOf,
  type InteriorKind,
  type InteriorPhaseState,
  type PlacedBody,
  type RoomItem,
} from './interiors.js'
import {
  INTERIOR_PX_SCALE,
  ROOM_TILES,
  WALL_PIECES_THAT_STAND,
  interiorPath,
  roomMapOf,
  seatLiftPx,
  standingTiles,
  type MapPiece,
  type RoomMap,
  type Tile,
} from './interiorMap.js'
import {
  FURNISHING_WALL_PIECE,
  WALL_STRIP_TILES,
  flagstoneRegions,
  hasInteriorTileset,
  resolveInteriorMaterial,
  resolveInteriorPiece,
  wallCourses,
  wallStripAt,
  wallStripWidth,
  wallTransform,
} from './interiorTileset.js'
import { SCENE_TOTAL_MS, transitionAlpha } from '../ui/sceneTransition.js'
import { doorTileOf } from './entities.js'
import type { ZoomStop } from './camera.js'
import {
  ROOM_SHELL_INK,
  ROOM_SHELL_PAINT,
  WALL_H_PX,
  WALL_MOUNT_H_PX,
  WALL_TINT,
  ceilingBeams,
  drawFloorBase,
  drawFloorLight,
  drawFloorTop,
  drawWalls,
  floorPolyOf,
  floorPools,
  floorRegionPoly,
  roomMaskPoly,
  roomOriginX,
  roomOriginY,
  roomZoomFor,
  tileCentreScreen,
  tileSpanCentre,
  wallMount,
  easePan,
  roomFocusOf,
  roomPanTo,
} from './roomShell.js'

// Palette-true: the room is cut from the same warm paper the chrome is. The shell's own tones
// live in roomShell.ts; these names point at that one source so a colour is never defined twice.
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
/** How far above the floor line a chimney breast's firebox sits, in interior px — where the
 *  fire is in the authored strip, and so where its light comes from. */
export const HEARTH_FIRE_H_PX = 44
export const PLACEHOLDER_URL = '/assets/placeholder/item.png'
/** A hung piece is on the back plane, so it draws behind everything standing on the floor
 *  and in front of the wall itself — one depth, because a wall has no depth of its own. */
export const WALL_PIECE_Z = -1

// Awake occupants stand where the room's life is: the hearth first, then the table, then
// whatever else is furnished. Deterministic, so two viewers see the same room.
const AWAKE_PREFERENCE = ['hearth', 'table', 'bench', 'chair', 'anvil', 'shelf'] as const
/** Where a body goes when the room furnishes it nowhere to be: just inside the threshold. A
 *  function of the room, since the near corner of a farmhouse is not a house's. */
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

// The town keeps living, dimmed, behind the veil; the room draws its own occupants from
// `characterArt` and the map layer's `characterCell` slicer.
export function createInteriorScene(
  scene: Scene,
  store: WorldStore,
  book: TextureBook,
): InteriorScene {
  const app = scene.app

  // The room's size is the building's, so it is state and not a module constant: `ROOM_TILES` is
  // the house's, and the house is only one of six. Everything that draws a plane reads this.
  let roomTiles: { w: number; h: number } = ROOM_TILES
  let roomSlots: { w: number; h: number } = CITY_INTERIOR_SLOTS

  const root = new Container()
  root.visible = false
  root.eventMode = 'passive'
  const veil = new Graphics()
  veil.eventMode = 'static' // the dimmed town is scenery: a click must not reach through it
  const room = new Container()
  room.eventMode = 'none' // the room is a view; the chrome bar owns the way out
  room.sortableChildren = true
  // A room is a box, and nothing drawn inside it belongs outside it. One mask settles that for
  // every prop, including a hearth glow that is a child of its own sprite.
  const roomMask = new Graphics()
  roomMask.poly(roomMaskPoly(roomTiles, WALL_H_PX))
  roomMask.fill(0xffffff)
  room.addChild(roomMask)
  room.mask = roomMask
  root.addChild(veil, room)
  app.stage.addChild(root)

  // Three planes, behind everything that stands in the room. The walls sort behind the floor
  // because a dimetric camera sees the two far faces of the box and nothing else; the light is
  // MASKED to the floor, or the doorway pool paints a pale ellipse across the town behind it.
  const walls = new Graphics()
  walls.zIndex = -4
  const floorArt = new Graphics() // the continuous material, when the codex has one
  floorArt.zIndex = -3
  const floorStone = new Graphics() // flagstone under the hearth and inside the door
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
  // ONE shadow plane, under everything that stands in the room: a shadow can never sort in front
  // of the body it belongs to, because it is not in the sort at all.
  const shadows = new Graphics()
  shadows.zIndex = -1.5
  room.addChild(
    walls,
    wallArt,
    floorArt,
    floorStone,
    floor,
    floorMask,
    floorLight,
    floorTop,
    shadows,
  )

  const furniture = new Map<string, Sprite>() // piece id → sprite
  const bodies = new Map<string, Sprite>() // agentId → sprite
  const sheets = new Map<string, Sheet>()

  let activeId: string | null = null
  let followedId: string | null = null
  let phase: InteriorPhaseState = { phase: 'town', sinceMs: 0 }
  let plannedFor: string | null = null // the kind the furniture map was built for
  let plannedSeq = -1
  let plan: RoomItem[] = []
  let bedTiles: Tile[] = []
  /** Who is lying in which bed cell. Follows the world and the plan, never the frame. */
  let beds: Record<string, Tile> = {}
  let map: RoomMap = roomMapOf([])
  let lightKinds: ReadonlySet<string> = new Set()
  let perches: Tile[] = []
  /** The kinds the wall itself draws this room, so no object is drawn for them as well. */
  let elevated: ReadonlySet<string> = new Set()
  /** What is on the floor and what the painter's order sorts. Furniture cannot move, so both
   *  are derived when the plan is, not when a body walks. */
  let roomState: WorldState | null = null
  let roomFor: string | null = null
  let room2: ReturnType<typeof interiorOf> = null
  let standing: MapPiece[] = []
  let items: { kind: string; tile: Tile; meta: RoomItem['meta'] | null }[] = []
  /** Where each body is on the room map, and the tiles it still has to cross to get where it
   *  is going. The engine has no interior position, so this is the renderer's own. */
  const walking = new Map<string, { at: Tile; path: Tile[]; t: number }>()
  const changeCbs: ((id: string | null) => void)[] = []

  // THE ROOM CAMERA. A farmhouse's box is 1 920 × 1 120 and there is no integer scene zoom below
  // 1, so part of it is off the glass and cannot be zoomed back on; what is left to choose is
  // WHICH part. Set from the room's own life, one frame behind `layoutRoom`.
  let camFocus: { sx: number; sy: number } | null = null
  let camX = 0
  let camY = 0
  /** A room change is a cut: the new room starts where it belongs rather than sliding in from
   *  wherever the last one was being watched. */
  let camSnap = true

  // A cut, not a fade, for a viewer who asked for less motion — the destination is the
  // point, and 260ms of dissolve is the part they opted out of.
  const reduced = (): boolean => !scene.wantsMotion()

  const notify = (): void => {
    for (const cb of changeCbs) cb(activeId)
  }

  // Art independence, the interior's half: the floor takes a continuous material the moment the
  // codex holds one and reads as a palette-true plane until then.
  const pools = (m: RoomMap): ReturnType<typeof floorPools> =>
    floorPools(
      m.pieces.map((p) => ({ tile: p.tile, light: lightKinds.has(p.kind) })),
      roomTiles,
    )

  let floorMaterial: string | null = null
  let stoneMaterial: string | null = null

  /** The flagstone patches, drawn over the boards. Nothing here exists without the art, so
   *  nothing here is a hole when the codex is empty. */
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
   * Every wall is laid plain end to end first so there is never a gap, then each feature is
   * drawn over it. When the codex holds no tileset this draws nothing and the code-painted shell
   * stands — the same art-independence law the ground answers to.
   */
  function paintWalls(m: RoomMap, records: AssetRecord[]): void {
    wallArt.removeChildren().forEach((c) => {
      c.destroy()
    })
    const art = hasInteriorTileset(records)
    walls.visible = !art // painted trapezoids OR authored elevations, never both
    if (!art) return
    const features = m.pieces
      .filter((p) => p.placement === 'wall')
      .flatMap((p) => {
        const wall =
          p.tile.x === 0 && p.tile.y > 0 ? ('back-left' as const) : ('back-right' as const)
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
        sprite.texture =
          width >= tex.frame.width
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
    new Set(
      m.pieces
        .filter((p) => p.placement === 'wall')
        .map((p) => p.kind)
        .filter((k) => {
          const piece = FURNISHING_WALL_PIECE[k]
          return piece !== undefined && resolveInteriorPiece(records, piece) !== null
        }),
    )

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
    camFocus = null
    camSnap = true
  }

  const onWall = (item: RoomItem): boolean => item.meta?.placement === 'wall'
  const sizeOf = (item: RoomItem): { w: number; h: number } => item.meta?.slots ?? { w: 1, h: 1 }

  /** The room's furnishings as map pieces, in the plan's own order — index for index, so a
   *  piece and the library record that draws it can never come apart. */
  const mapOf = (items: RoomItem[]): RoomMap =>
    roomMapOf(
      items.map((i) => ({
        kind: i.kind,
        slot: i.slot,
        size: sizeOf(i),
        placement: onWall(i) ? 'wall' : 'floor',
        flat: isFlat(i.kind),
      })),
      roomTiles,
      roomSlots,
    )

  /** A furnishing a body lies IN is drawn as TWO sprites cut from ONE texture, split at its own
   *  mid-line, so the body can go between them. Each keeps a bottom anchor and the back half is
   *  lifted by the front half's own height, which is what reassembles them exactly. */
  function applyHalf(sprite: Sprite, t: Texture, half: 'back' | 'front' | null): void {
    if (half === null) {
      sprite.texture = t
      return
    }
    const f = t.frame
    const cut = Math.round(f.height / 2)
    const rect =
      half === 'back'
        ? new Rectangle(f.x, f.y, f.width, cut)
        : new Rectangle(f.x, f.y + cut, f.width, f.height - cut)
    sprite.texture = new Texture({ source: t.source, frame: rect })
    if (half === 'back') sprite.position.y -= (f.height - cut) * sprite.scale.y
  }

  /**
   * A wall furnishing is drawn once, and the wall decides which way it faces: the wall is the
   * one the piece's TILE is against, the facing is that wall's own (`WALL_FACING`), and a piece
   * that reaches the ground STANDS at the foot of its wall instead of hanging over it.
   */
  function placeFurniture(m: RoomMap, items: RoomItem[], asElevation: ReadonlySet<string>): void {
    const onFloor: { piece: MapPiece; item: RoomItem }[] = []
    m.pieces.forEach((piece, i) => {
      const item = items[i]
      if (item === undefined) return
      // When the tileset holds an elevation for this kind, the wall IS the furnishing — the
      // chimney breast is the hearth — so no object is drawn as well.
      if (asElevation.has(piece.kind)) return // the wall is the furnishing; its LIGHT is drawn below
      if (piece.placement !== 'wall' || WALL_PIECES_THAT_STAND.has(piece.kind)) {
        onFloor.push({ piece, item })
        return
      }
      const at = wallMount(piece.tile)
      if (at === null) return // a wall piece against no wall is a placement error
      addPiece(furnishingId(piece.kind, piece.tile), item, null, at.sx, at.sy, WALL_PIECE_Z)
    })

    const placed = onFloor.map(({ piece, item }) => ({
      kind: piece.kind,
      tile: piece.tile,
      meta: item.meta,
    }))
    const byId = new Map(
      onFloor.map(({ piece, item }) => [furnishingId(piece.kind, piece.tile), item]),
    )
    for (const p of interiorPieces(placed, [])) {
      const item = byId.get(p.half === null ? p.id : p.id.slice(0, p.id.indexOf('#')))
      if (item === undefined) continue
      // ★ `p.anchor`, NOT `p.tile`. The split tile is the DEPTH box; spending it on the
      // position as well tore every 'in' furnishing in two — see `RoomPiece.anchor`.
      const foot = tileSpanCentre(p.anchor.tile, p.anchor.size)
      addPiece(p.id, item, p.half, foot.sx, foot.sy, 0)
    }

    // A hearth the tileset draws as a chimney breast has no sprite of its own to hang a glow on,
    // so the light list is derived from what the room CONTAINS, never from how it is drawn.
    for (const light of roomLights(m.pieces, lightKinds)) {
      if (!asElevation.has(light.kind)) continue // its own sprite already wears the glow
      const at = wallMount(light.tile)
      if (at === null) continue
      addWallGlow(light.id, at.sx, at.sy + WALL_MOUNT_H_PX - HEARTH_FIRE_H_PX)
    }
  }

  /** The firelight of a hearth the WALL draws, at the height of its own firebox. A Sprite with
   *  no texture, so it lives and dies in the `furniture` map with everything else in the room. */
  function addWallGlow(key: string, sx: number, sy: number): void {
    const holder = new Sprite()
    holder.position.set(sx, sy)
    holder.zIndex = WALL_PIECE_Z
    holder.eventMode = 'none'
    const glow = new Graphics()
    glow.circle(0, 0, HEARTH_GLOW_PX)
    glow.fill({ color: INTERIOR_HEARTH_GLOW, alpha: 0.22 })
    glow.eventMode = 'none'
    holder.addChild(glow)
    furniture.set(key, holder)
    room.addChild(holder)
  }

  function addPiece(
    key: string,
    item: RoomItem,
    half: 'back' | 'front' | null,
    sx: number,
    sy: number,
    z: number,
  ): void {
    if (furniture.has(key)) return
    const sprite = new Sprite()
    // A flat piece is anchored at the CENTRE of its ground; a standing piece at the bottom of
    // its texture, which is the near vertex of the ground it stands on.
    sprite.anchor.set(0.5, isFlat(item.kind) ? 0.5 : 1)
    sprite.eventMode = 'none'
    // `furnishingScale()` is 1 under Option C: the art is authored at exactly the span its
    // footprint covers and the scene zoom is 1, so nothing in this room is resampled.
    sprite.scale.set(furnishingScale())
    sprite.position.set(sx, sy)
    sprite.zIndex = z
    // `book.get(...).then(...)` runs on a microtask — after the frame that first paints the room
    // — so a warm book is asked with `peek` and the furniture arrives in that same frame.
    const url = item.url ?? PLACEHOLDER_URL
    const inHand = book.peek(url)
    if (inHand !== null)
      applyHalf(sprite, inHand, half) // native px; the room's zoom is 1
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
    if (sheet?.art.url !== art.url) {
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

  /** The engine has no interior position, so where a body stands in the room is the renderer's
   *  own truth. `interiorPath` is the four-neighbour law the town walks by, run over the room's
   *  blocked tiles, so a body crosses AROUND the table instead of through it. */
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
    if (w.path.length === 0) w.at = goal // nowhere to walk to: be there
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

  /** Everything that follows from the room's KIND and the codex, and from nothing a body does. */
  function replan(kind: InteriorKind, records: AssetRecord[], seq: number): void {
    clearRoom()
    plannedFor = kind
    plannedSeq = seq
    // The room's own floor plan, before anything is drawn on it. Both masks are cut from it,
    // so a farmhouse is not clipped to a house's box.
    roomTiles = roomSizeOf(kind)
    roomSlots = slotGridOf(kind)
    roomMask.clear()
    roomMask.poly(roomMaskPoly(roomTiles, WALL_H_PX))
    roomMask.fill(0xffffff)
    floorMask.clear()
    floorMask.poly(floorPolyOf(roomTiles))
    floorMask.fill(0xffffff)
    plan = roomPlan(kind, records)
    bedTiles = bedCells(kind, plan)
    lightKinds = new Set(plan.filter((p) => p.meta?.providesLight === true).map((p) => p.kind))
    map = mapOf(plan)
    // ★ AN AWAKE BODY STANDS BESIDE THE THING IT IS USING, NOT ON IT. There is floor to stand
    // on now, so "at the hearth" is a real tile a real body occupies.
    perches = AWAKE_PREFERENCE.flatMap((kind2) =>
      map.pieces.filter((p) => p.kind === kind2),
    ).flatMap((p) => standingTiles(map, p).slice(0, 1))
    elevated = elevationKinds(map, records)
    placeFurniture(map, plan, elevated)
    paintFloor(map, records) // the light on the floor is the room's own fires
    paintWalls(map, records)

    // What is actually STANDING in the room: everything on the floor, plus the wall pieces
    // that reach the ground and are not already drawn as part of the wall.
    standing = map.pieces.filter(
      (p) =>
        !elevated.has(p.kind) && (p.placement !== 'wall' || WALL_PIECES_THAT_STAND.has(p.kind)),
    )
    items = standing.map((p) => ({
      kind: p.kind,
      tile: p.tile,
      meta: plan.find((i) => i.kind === p.kind)?.meta ?? null,
    }))
  }

  /** The furnishing a body on `tile` is with: the one whose footprint covers that tile. */
  function hosts(piece: MapPiece, tile: Tile): boolean {
    return (
      tile.x >= piece.tile.x &&
      tile.x < piece.tile.x + piece.size.w &&
      tile.y >= piece.tile.y &&
      tile.y < piece.tile.y + piece.size.h
    )
  }

  function layoutRoom(dtMs: number): void {
    const state = store.getState()
    if (activeId === null || state === null) return
    // `interiorOf` walks every agent and every item; the world it reads changes at most every
    // 250 ms, so it is asked on a new state rather than on a new frame.
    let laidDown = false
    if (state !== roomState || activeId !== roomFor) {
      roomState = state
      roomFor = activeId
      room2 = interiorOf(state, activeId)
      laidDown = true
    }
    if (room2 === null) return
    const records = store.assetRecords()
    const seq = store.assetsSeq()
    // The plan only moves when the room or the codex does — this runs every frame.
    if (plannedFor !== room2.kind || plannedSeq !== seq) {
      replan(room2.kind, records, seq)
      laidDown = true
    }
    // Who is asleep follows the world, and which cell they lie in follows `replan`'s plan.
    // Neither is a thing a frame changes.
    if (laidDown) {
      const sleeping = room2.occupants.filter((id) => state.agents[id]?.asleep === true)
      beds = bedSlots(sleeping, bedTiles)
    }
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
        ? (beds[id] ?? spareTile(roomTiles))
        : (perches[awakeIdx++ % Math.max(1, perches.length)] ?? spareTile(roomTiles))
      retarget(id, goal, map)
      const own = asleep ? goal : (walking.get(id)?.at ?? goal)
      const host = standing.find((p) => hosts(p, own)) ?? null
      placed.push({
        id,
        tile: own,
        inside: host === null ? null : furnishingId(host.kind, host.tile),
      })
      const sprite = bodyFor(id)
      const sheet = sheetFor(id, records)
      if (sheet.texture !== null) {
        const cell = characterCell(sheet.texture, sheet.art, asleep ? 'sleep' : 'idle', 'se')
        if (cell !== null) {
          sprite.texture = cell.texture
          sprite.anchor.set(cell.anchor.x, cell.anchor.y)
          // The ROOM's scale, not the town's: `cell.scale × INTERIOR_PX_SCALE` carries a body
          // across on the PIXEL factor and leaves the WORLD factor behind.
          sprite.scale.set(interiorBodyScale(cell.scale))
        }
      }
    }

    // ONE painter's order for the room, from the same authority the town answers to. No
    // module invents a number, so a sleeper can no longer sit on top of the bed it is in.
    const pieces = interiorPieces(items, placed)
    const index = new Map(interiorOrder(pieces).map((id, i) => [id, i]))
    // What each body is INSIDE, by kind — a bed lifts a sleeper onto its mattress.
    const hostKind = new Map(
      placed.map((b) => [
        b.id,
        b.inside === null ? null : b.inside.slice(0, b.inside.indexOf(':')),
      ]),
    )
    shadows.clear()
    const bodyPts: { id: string; sx: number; sy: number }[] = []
    for (const p of pieces) {
      const node = p.kind === 'body' ? bodies.get(p.id) : furniture.get(p.id)
      if (node === undefined) continue
      node.zIndex = index.get(p.id) ?? 0
      const lift = p.kind === 'body' ? seatLiftPx(hostKind.get(p.id) ?? null) : 0
      if (p.kind === 'body') {
        const foot = advanceWalk(p.id, dtMs)
        node.position.set(foot.sx, foot.sy - lift)
        bodyPts.push({ id: p.id, sx: foot.sx, sy: foot.sy - lift })
      }
      // A split furnishing casts ONE shadow, under its front half. A flat one casts none because
      // it IS on the floor, and neither does a body that is off the floor, in a bed.
      if (p.half === 'back' || node.texture.width <= 1 || lift > 0) continue
      if (p.kind === 'furniture' && isFlat(p.id.slice(0, p.id.indexOf(':')))) continue
      const s = contactShadow(node.texture.width * node.scale.x)
      // A body is anchored at its FEET, which already is the ground centre; a furnishing is
      // anchored at its texture's bottom, which is the near vertex of the ground it stands on.
      const foot =
        p.kind === 'body'
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

    // Where the camera rests when the room is empty: the first perch, which `AWAKE_PREFERENCE`
    // makes the hearth. An empty farmhouse crops as hard as a full one.
    const rest = perches[0] === undefined ? null : tileCentreScreen(perches[0].x, perches[0].y)
    camFocus = roomFocusOf(bodyPts, followedId, rest)
  }

  // The camera pushes in to the door tile while the veil rises, and leaving restores the exact
  // point with `centerOnScreen` — a whole-tile `centerOn` lands somewhere the viewer never left.
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
    if (
      structureId !== null &&
      (store.getState() === null || interiorOf(store.getState()!, structureId) === null)
    )
      return
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

    // OUT THEN IN, never both: the veil rises over the first 120 ms and the room arrives over
    // the next 180, or the room leaves first and the veil follows. One alpha on the root put
    // the town through a half-drawn room for the whole 300 ms (D22).
    const elapsed = now - phase.sinceMs
    const moving =
      (phase.phase === 'entering' || phase.phase === 'exiting') && elapsed < SCENE_TOTAL_MS
    let veilAlpha = entered ? 1 : 0
    let roomAlpha = veilAlpha
    if (moving) {
      const pair = transitionAlpha(elapsed)
      // in: the veil rises as the town goes out, then the room comes in. Out: the reverse.
      veilAlpha = phase.phase === 'entering' ? 1 - pair.out : 1 - pair.in
      roomAlpha = phase.phase === 'entering' ? pair.in : pair.out
    }

    root.visible = veilAlpha > 0 || roomAlpha > 0
    if (!root.visible) return
    veil.alpha = veilAlpha
    room.alpha = roomAlpha
    veil.clear()
    veil.rect(0, 0, app.screen.width, app.screen.height)
    veil.fill({ color: INTERIOR_VEIL, alpha: INTERIOR_VEIL_ALPHA })
    // Option C has one integer scene zoom and it is 1: the interior tile is authored at the size
    // it reaches the glass, so every other factor resamples pixel art.
    const zoom = roomZoomFor(app.screen.height)
    room.scale.set(zoom)
    // `roomPanTo` adds nothing to the origin unless `roomCrop` is non-zero: a room the stage
    // holds gets a travel range of [0, 0] and cannot drift by construction.
    const target = roomPanTo(
      camFocus,
      app.screen.width,
      app.screen.height,
      zoom,
      roomTiles,
      WALL_H_PX,
    )
    if (camSnap) {
      camX = target.dx
      camY = target.dy
      camSnap = false
    } else {
      camX = easePan(camX, target.dx, dtMs)
      camY = easePan(camY, target.dy, dtMs)
    }
    // The whole box, walls included — centring the floor alone put the top of the walls off
    // the top of the stage, which is what the browser showed.
    room.position.set(
      roomOriginX(app.screen.width, zoom, roomTiles) + camX,
      roomOriginY(app.screen.height, ROOM_OFFSET_Y, zoom, roomTiles, WALL_H_PX) + camY,
    )
    if (activeId !== null) layoutRoom(dtMs)
  }
  app.ticker.add(tick)

  return {
    setActive,
    setFollowed: (agentId) => {
      followedId = agentId
    },
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
