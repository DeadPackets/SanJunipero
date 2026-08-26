import { Application, Container, Graphics, RenderTexture, Sprite, TextureSource } from 'pixi.js'
import type { ApplicationOptions, FederatedPointerEvent, Texture } from 'pixi.js'
import type { AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { InteriorScene } from './interiorScene.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import {
  ZOOM_STOPS,
  boundsCentre,
  cameraBoundsOf,
  clampCamera,
  fitStop,
  initialZoom,
  drawnBoundsOf,
  reachableBoundsOf,
  resizeIntent,
  tooBigToFit,
  zoomScaleAt,
  zoomSettled,
  zoomTo,
  zoomWheel,
  zoomGestureEnded,
  zoomRelease,
  WHEEL_GESTURE_GAP_MS,
  type CameraBounds,
  type ZoomState,
  type ZoomStop,
} from './camera.js'
import {
  OCTAVE_ALPHA,
  ROAD_SHOULDER_DARK,
  ROAD_SHOULDER_LIGHT,
  groundArtSignature,
  groundField,
  isRoadMass,
  materialMatrix,
  octaveMatrix,
  roadRibbonPolys,
  roadShoulderBands,
  type FieldLayer,
} from './groundField.js'
import {
  CHUNK_BYTES_PER_PX,
  bucketLayers,
  bucketPolys,
  createChunkResidency,
  groundGrid,
  type ChunkGrid,
  type ChunkKey,
  type ChunkRect,
} from './groundChunks.js'
import type { ViewRect } from './cull.js'
import {
  applyDepthOrder,
  createLayers,
  type DepthCounts,
  type DepthEntry,
  type LayerSet,
} from './layers.js'
import { flingFrom, flingStep, isDrag, trackDrag, type DragTrack, type Fling } from './fling.js'
import { createTooltipLayer, type TooltipLayer } from './tooltip.js'
import { HEADLAND_COLOR, KERB_COLOR, furrowLines, patchOutline, type Tile } from './patches.js'
import { tileKind } from './tileset.js'
import { TextureBook } from './textures.js'

export const BACKGROUND = 0x322b38
/** The ends of `ZOOM_STOPS`, so the HUD's disabled state and the wheel's clamp share a source. */
export const ZOOM_MIN: ZoomStop = ZOOM_STOPS[0]
export const ZOOM_MAX: ZoomStop = ZOOM_STOPS[ZOOM_STOPS.length - 1]!

// A grid of fixed-size chunks, not one texture the size of the field: a whole-map bake grows as
// the square of the ring count and passes `MAX_TEXTURE_SIZE`, where the allocation FAILS.
export type GroundBaker = {
  rebake(terrain: TileId[][], records: AssetRecord[]): void
  /** Which chunks are worth holding — the view is in world space, as `viewRect()` gives it. */
  setView(view: ViewRect): void
  /** What is on the GPU right now. A bound nobody can count is a claim, not a bound. */
  vram(): { chunks: number; bytes: number; maxDimPx: number }
  destroy(): void
}

/** The one thing the baker needs a live GPU for, named so a test can drive the real baker. */
export type BakeRenderer = {
  render(opts: { container: Container; target: RenderTexture; clear: boolean }): void
}

export function createGroundBaker(
  renderer: BakeRenderer,
  root: Container,
  book: TextureBook,
): GroundBaker {
  let grid: ChunkGrid | null = null
  /** the field's layers, cut per chunk — one O(shapes) pass per terrain, never per chunk */
  let buckets = new Map<ChunkKey, FieldLayer[]>()
  let kerbPolys = new Map<ChunkKey, number[][]>()
  let headlandPolys = new Map<ChunkKey, number[][]>()
  let furrowPolys = new Map<ChunkKey, number[][]>()
  const live = new Map<ChunkKey, { rect: ChunkRect; tex: RenderTexture; sprite: Sprite }>()
  const residency = createChunkResidency()
  let view: ViewRect = { x: 0, y: 0, w: 0, h: 0 }
  // one Texture per TERRAIN now — at most eight, whatever the size of the map
  const loaded = new Map<string, Texture>()
  let generation = 0

  // Geometry stays in BAKE space (`sx + offX`) with only the container translated, so a material
  // samples the same coordinates in any chunk and the framebuffer edge does all the cutting.
  function drawChunk(rect: ChunkRect, target: RenderTexture, offX: number): void {
    const layer = new Container()
    layer.position.set(-rect.x, -rect.y)
    const stack = buckets.get(rect.key) ?? []
    for (let li = 0; li < stack.length; li++) {
      const l = stack[li]!
      if (l.shapes.length === 0) continue // its index is still its index — see bucketLayers
      // Every shoulder is laid down BEFORE any ribbon, so a neighbour's rim can never sit on
      // top of this tile's surface.
      if (l.kind === 'road') {
        // Two tones, because one flat shoulder sat 0.060 luma from the grass and vanished at 1x.
        for (const [tone, pick] of [
          [ROAD_SHOULDER_LIGHT, 'light'],
          [ROAD_SHOULDER_DARK, 'dark'],
        ] as const) {
          const sh = new Graphics()
          for (const shape of l.shapes) {
            if (shape.roadKey === null) continue
            for (const poly of roadShoulderBands(shape.roadKey)[pick]) {
              const pts: number[] = []
              for (let i = 0; i < poly.length; i += 2) {
                pts.push(shape.sx + offX + poly[i]!, shape.sy + poly[i + 1]!)
              }
              sh.poly(pts)
            }
          }
          sh.fill(tone)
          layer.addChild(sh)
        }
      }
      // the layer's mask, laid down once per pass
      const shapesInto = (g: Graphics): void => {
        for (const shape of l.shapes) {
          const cx = shape.sx + offX,
            cy = shape.sy
          if (shape.roadKey === null) {
            g.poly([
              cx,
              cy,
              cx + TILE_W / 2,
              cy + TILE_H / 2,
              cx,
              cy + TILE_H,
              cx - TILE_W / 2,
              cy + TILE_H / 2,
            ])
            continue
          }
          for (const poly of roadRibbonPolys(shape.roadKey)) {
            const pts: number[] = []
            for (let i = 0; i < poly.length; i += 2) pts.push(cx + poly[i]!, cy + poly[i + 1]!)
            g.poly(pts)
          }
        }
      }

      const g = new Graphics()
      shapesInto(g)
      const tex = l.url === null ? undefined : loaded.get(l.url)
      if (tex === undefined) {
        g.fill(l.fallback) // art independence: palette-true flat ground
        layer.addChild(g)
      } else {
        tex.source.addressMode = 'repeat' // the field wraps; the material must too
        // An identity matrix would tile one 256px material on an axis-aligned lattice across
        // the whole map, so each layer samples through its own rotation and offset instead.
        g.fill({ texture: tex, matrix: materialMatrix(l.id, li) })
        layer.addChild(g)
        // A coarser octave at an incommensurate scale: two periods with no common multiple
        // inside the map cannot line up into a lattice. Bake-time cost only.
        const oct = new Graphics()
        shapesInto(oct)
        oct.fill({ texture: tex, matrix: octaveMatrix(l.id, li), alpha: OCTAVE_ALPHA })
        layer.addChild(oct)
      }
    }
    // The tile scan that finds these patches lives in the terrain pass, not here: it is O(the
    // map), and running it per chunk would put the whole map into every chunk's bake.
    const strokeAt = (polys: number[][], color: number, alpha: number, close: boolean): void => {
      if (polys.length === 0) return
      const g = new Graphics()
      for (const poly of polys) {
        const pts: number[] = []
        for (let i = 0; i < poly.length; i += 2) pts.push(poly[i]! + offX, poly[i + 1]!)
        if (close) g.poly(pts)
        else {
          g.moveTo(pts[0]!, pts[1]!)
          g.lineTo(pts[2]!, pts[3]!)
        }
      }
      g.stroke({ color, alpha, width: 1, alignment: 0.5 })
      layer.addChild(g)
    }

    strokeAt(furrowPolys.get(rect.key) ?? [], HEADLAND_COLOR, OCTAVE_ALPHA, false)
    strokeAt(headlandPolys.get(rect.key) ?? [], HEADLAND_COLOR, 1, true)
    strokeAt(kerbPolys.get(rect.key) ?? [], KERB_COLOR, 1, true)

    renderer.render({ container: layer, target, clear: true })
    layer.destroy({ children: true })
  }

  let offsetX = 0

  function bake(rect: ChunkRect): void {
    // resolution 1 and NEAREST, stated rather than inherited: a chunk baked at the device ratio
    // would resample the pixel art the whole `nearest` law exists to keep unresampled.
    const tex = RenderTexture.create({
      width: rect.texW,
      height: rect.texH,
      scaleMode: 'nearest',
      resolution: 1,
    })
    const sprite = new Sprite(tex)
    sprite.position.set(rect.x - offsetX, rect.y)
    root.addChild(sprite)
    live.set(rect.key, { rect, tex, sprite })
    drawChunk(rect, tex, offsetX)
  }

  function release(key: ChunkKey): void {
    const held = live.get(key)
    if (held === undefined) return
    live.delete(key)
    held.sprite.destroy()
    held.tex.destroy(true)
  }

  function applyResidency(): void {
    const step = residency.update(view)
    for (const rect of step.bake) bake(rect)
    for (const key of step.evict) release(key)
  }

  function releaseAll(): void {
    for (const key of [...live.keys()]) release(key)
    residency.clear()
  }

  return {
    rebake(terrain, records) {
      const field = groundField(terrain, records)
      offsetX = field.offsetX
      grid = groundGrid(field.widthPx, field.heightPx, field.offsetX)
      buckets = bucketLayers(grid, field.layers)

      const plaza: Tile[] = [],
        farmland: Tile[] = []
      for (let y = 0; y < terrain.length; y++) {
        const row = terrain[y]!
        for (let x = 0; x < row.length; x++) {
          if (tileKind(row[x]!) === 'farmland') farmland.push({ x, y })
          else if (isRoadMass(terrain, x, y)) plaza.push({ x, y })
        }
      }
      furrowPolys = bucketPolys(grid, furrowLines(farmland))
      headlandPolys = bucketPolys(grid, patchOutline(farmland))
      kerbPolys = bucketPolys(grid, patchOutline(plaza))

      // a new terrain is a new grid: every texture on the GPU belongs to the old one
      releaseAll()
      residency.setGrid(grid)
      applyResidency()

      // Textures load async: paint the flat fallback now, repaint once the art is in, and let
      // the generation counter stop a stale load overwriting a newer bake.
      const urls = [...new Set(field.layers.map((l) => l.url))].filter(
        (u): u is string => u !== null && !loaded.has(u),
      )
      if (urls.length === 0) return
      const gen = ++generation
      void Promise.all(
        urls.map(async (u) => {
          loaded.set(u, await book.get(u))
        }),
      )
        .then(() => {
          if (gen !== generation) return
          for (const held of live.values()) drawChunk(held.rect, held.tex, offsetX)
        })
        .catch(() => {
          /* art is optional — the flat diamonds already rendered */
        })
    },
    setView(next) {
      if (next.x === view.x && next.y === view.y && next.w === view.w && next.h === view.h) return
      view = next
      applyResidency()
    },
    vram() {
      let bytes = 0,
        maxDimPx = 0
      for (const held of live.values()) {
        bytes += held.rect.texW * held.rect.texH * CHUNK_BYTES_PER_PX
        maxDimPx = Math.max(maxDimPx, held.rect.texW, held.rect.texH)
      }
      return { chunks: live.size, bytes, maxDimPx }
    },
    destroy() {
      generation++
      releaseAll()
      grid = null
      buckets = new Map()
      loaded.clear()
    },
  }
}

/** A scene's clock, held rather than reached for through `app.ticker`: Pixi's
 *  `Application.destroy()` nulls that field, so an effect queued before teardown throws. */
export function sceneClock(app: { ticker: { start(): void; stop(): void } | null }): {
  set(on: boolean): void
  close(): void
} {
  let closed = false
  return {
    set: (on) => {
      if (closed) return
      if (on) app.ticker!.start()
      else app.ticker!.stop()
    },
    close: () => {
      closed = true
    },
  }
}

export type Scene = {
  app: Application
  /** Run or pause the scene's own clock. The ONLY way to do it: `app.ticker` is null on a
   *  destroyed scene, and a caller upstream of the teardown cannot know which it is holding. */
  setTicking(on: boolean): void
  /** How much larger than the reader's size a world caption is drawn — 1 for a person at a
   *  desk, `BROADCAST_TEXT_SCALE` for the frame a stream viewer sees at a quarter scale. */
  textScale: number
  world: Container
  /** the eight named layers — the one place that decides what is drawn over what */
  layers: LayerSet
  /** the only depth-sorted layer; `layers.entities`, named for the code that lives in it */
  entities: Container
  /** register what this module draws into `entities`; returns the unregister */
  addDepthSource(fn: () => DepthEntry[]): () => void
  /** one painter's order for the whole frame — called once per tick, by StageMount */
  sortDepth(): void
  /** what the last `sortDepth` drew and what the viewport let it skip */
  depthCounts(): DepthCounts
  /** the visible world rectangle, in the space labels are drawn in (tooltip.ts places in it) */
  viewRect(): { x: number; y: number; w: number; h: number }
  /** The box the camera may travel over: the ground that exists union the town as it is drawn.
   *  The minimap draws exactly this, so every point it shows is somewhere the camera can go. */
  reachableBox(): CameraBounds
  /** THE label layer. One owner for every world tag, so two can never be up by accident and
   *  a torn-down sprite cannot leave one behind. */
  tags: TooltipLayer
  /** above the entities and never hit-tested: place names and other reading aids */
  overlay: Container
  rebakeGround(terrain: TileId[][], records?: AssetRecord[]): void
  centerOn(x: number, y: number): void
  /** the same move in the space `tileToScreen` returns, so a camera can be put back EXACTLY
   *  where it was rather than on the nearest whole tile (interiorScene's `restoreCamera`) */
  centerOnScreen(sx: number, sy: number): void
  /** move to a named rest stop, turning about the screen centre */
  setZoom(stop: ZoomStop): void
  /** move to a named rest stop, keeping the world point under (screenX, screenY) fixed */
  setZoomAt(stop: ZoomStop, screenX: number, screenY: number): void
  /** the scale being drawn this frame — animated during a transit */
  getZoom(): number
  /** The one owner of `prefers-reduced-motion` for the whole canvas. */
  wantsMotion(): boolean
  /** where the camera is going, and where it will be at rest. The HUD reads THIS, so a label
   *  never shows a number the stop set does not contain. */
  getZoomStop(): ZoomStop
  panBy(dx: number, dy: number): void
  /** A press on the minimap, in the space `tileToScreen` returns. A cut, never a glide. */
  travelTo(sx: number, sy: number): void
  centerHome(): void
  /** a view of the whole settlement, at the largest stop it fits at */
  fitToTown(): void
  /** False once the town has outgrown the widest stop, so the bar can name what the overview
   *  control will actually do instead of promising the whole town. */
  fitsWholeTown(): boolean
  onCamera(cb: () => void): () => void
  setFollow(target: (() => { x: number; y: number } | null) | null): void
  /** fires when a user gesture (drag, pan, recenter) takes the camera back */
  onFollowEnd(cb: () => void): () => void
  /** A click that landed on the GROUND, as a tile. A click that landed on a person, a
   *  building, an item or a crop is not a tile pick and does not fire this — see the handler. */
  onTilePointer(cb: (t: { x: number; y: number }) => void): void
  /** world-space anchor for an agent's sprite; wired by StageMount once layers exist */
  anchorOf?: (agentId: string) => { x: number; y: number } | null
  /** the interior sub-scene; wired by StageMount once the character layer exists */
  interior?: InteriorScene
  destroy(): void
}

// Pixi defaults to one backing pixel per CSS pixel, so a DPR-2 screen resamples the canvas and
// NEAREST art arrives soft. `autoDensity` keeps the CSS box — and `app.screen` — unchanged.
export function rendererOptions(rootEl: HTMLElement, dpr: number): Partial<ApplicationOptions> {
  return {
    antialias: false,
    roundPixels: true,
    background: BACKGROUND,
    resizeTo: rootEl,
    resolution: Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
    autoDensity: true,
  }
}

export async function createScene(rootEl: HTMLElement, store: WorldStore): Promise<Scene> {
  TextureSource.defaultOptions.scaleMode = 'nearest' // global NEAREST law — before any texture exists
  const app = new Application()
  await app.init(rendererOptions(rootEl, globalThis.devicePixelRatio))
  rootEl.appendChild(app.canvas)
  // `resizeTo` only tracks window resizes, but a panel opening changes the root element itself,
  // and a stage that got smaller can leave the camera showing outside the world.
  const ro = new ResizeObserver(() => {
    app.resize()
    const intent = resizeIntent(fitted, townBox(), screenBox())
    if (intent.kind === 'refit') fitTo(intent.stop)
    else place(world.position.x, world.position.y)
  })
  ro.observe(rootEl)

  const world = new Container()
  // One table decides what is over what (layers.ts). Every layer but `entities` is event-inert,
  // so a label can never steal a click from the building it names.
  const layers = createLayers(world)

  // The ground is a grid of chunk sprites now, not one sprite the size of the map. `layers.ground`
  // is their only parent, so nothing else in the scene had to learn that the bake was cut up.
  const groundChunkRoot = new Container()
  layers.ground.addChild(groundChunkRoot)
  app.stage.addChild(world)

  const viewRect = (): { x: number; y: number; w: number; h: number } => {
    const k = world.scale.x || 1
    return {
      x: -world.position.x / k,
      y: -world.position.y / k,
      w: app.screen.width / k,
      h: app.screen.height / k,
    }
  }
  const tags = createTooltipLayer(layers, viewRect, () => world.scale.x)

  const tileCbs: ((t: { x: number; y: number }) => void)[] = []

  // The depth sort has ONE owner and runs ONCE a frame over the whole live set. Modules
  // publish the ground they stand on; nobody publishes an opinion about who is in front.
  const depthSources = new Set<() => DepthEntry[]>()
  // what the last frame drew and what it skipped — a cull nobody can count is a claim
  let lastCounts: DepthCounts = { drawn: 0, culled: 0 }

  const book = new TextureBook()
  const baker = createGroundBaker(app.renderer, groundChunkRoot, book)

  function rebakeGround(terrain: TileId[][], records?: AssetRecord[]): void {
    // the view first: a bake with a stale view bakes chunks nobody is looking at
    baker.setView(viewRect())
    baker.rebake(terrain, records ?? store.assetRecords())
  }

  // Every write to `world.position` goes through the clamp against this box, which is the
  // ground that exists UNION the town as drawn — a building can stand past the tile array.
  let bounds: CameraBounds = cameraBoundsOf([])

  const structureList = (): { x: number; y: number; w: number; h: number }[] => {
    const s = store.getState()
    return s === null ? [] : Object.values(s.structures)
  }
  const recomputeBounds = (terrain: TileId[][]): void => {
    bounds = reachableBoundsOf(terrain, structureList())
  }
  const screenBox = (): { w: number; h: number } => ({ w: app.screen.width, h: app.screen.height })

  /** The one writer of the camera's position, and therefore the one that fires `onCamera` —
   *  a mover added later cannot forget to announce itself. */
  function place(x: number, y: number): void {
    const p = clampCamera({ x, y }, world.scale.x, bounds, screenBox())
    if (p.x === world.position.x && p.y === world.position.y) return
    world.position.set(p.x, p.y)
    notifyCamera()
  }

  function centerOnScreen(sx: number, sy: number): void {
    place(app.screen.width / 2 - sx * world.scale.x, app.screen.height / 2 - sy * world.scale.y)
  }

  function centerOn(x: number, y: number): void {
    const { sx, sy } = tileToScreen(x, y)
    centerOnScreen(sx, sy)
  }

  /** The settlement AS DRAWN, or the whole map when nothing has been built yet. Drawn, not
   *  footprint: a sprite overhangs its own ground, and fitting the ground cuts the roofs off. */
  function townBox(): CameraBounds {
    const s = store.getState()
    const list = s === null ? [] : Object.values(s.structures)
    return list.length === 0 ? bounds : drawnBoundsOf(list)
  }

  /** True while the camera shows the whole town, so a resize refits rather than reclamping. */
  let fitted = false

  function fitTo(stop: ZoomStop): void {
    stopGlide()
    breakFollow()
    const c = boundsCentre(townBox())
    anchor = { sx: app.screen.width / 2, sy: app.screen.height / 2, wx: c.sx, wy: c.sy }
    fitted = true
    if (stop === zoom.stop) {
      centerOnScreen(c.sx, c.sy)
      notifyCamera()
      return
    }
    zoom = zoomTo(zoom, stop, performance.now())
  }

  function fitToTown(): void {
    fitTo(fitStop(townBox(), screenBox()))
  }

  const fitsWholeTown = (): boolean => !tooBigToFit(townBox(), screenBox())

  // smooth follow: eases the camera toward a moving world-space anchor each frame
  let followFn: (() => { x: number; y: number } | null) | null = null
  const followEndCbs: (() => void)[] = []
  const breakFollow = (): void => {
    if (followFn === null) return
    followFn = null
    for (const cb of followEndCbs) cb()
  }
  const followTick = (): void => {
    if (followFn === null) return
    const t = followFn()
    if (t === null) return
    const tx = app.screen.width / 2 - t.x * world.scale.x
    const ty = app.screen.height / 2 - t.y * world.scale.y
    // frame-rate independent lerp (~12%/frame at 60fps)
    const k = 1 - Math.pow(0.88, app.ticker.deltaMS / 16.7)
    place(
      world.position.x + (tx - world.position.x) * k,
      world.position.y + (ty - world.position.y) * k,
    )
  }
  app.ticker.add(followTick)

  const cameraCbs: (() => void)[] = []
  const notifyCamera = (): void => {
    for (const cb of cameraCbs) cb()
  }

  // Rest stops stay exact so the pixel grid stays exact; the eased transit turns about the
  // world point under the POINTER, so zooming toward a thing keeps that thing where it is.
  let zoom: ZoomState = initialZoom(1)
  let anchor = { sx: 0, sy: 0, wx: 0, wy: 0 }

  function captureAnchor(sx: number, sy: number): void {
    const k = world.scale.x || 1
    anchor = { sx, sy, wx: (sx - world.position.x) / k, wy: (sy - world.position.y) / k }
  }

  function setZoomAt(stop: ZoomStop, screenX: number, screenY: number): void {
    if (stop === zoom.stop && zoomSettled(zoom, performance.now())) return
    fitted = false
    captureAnchor(screenX, screenY)
    zoom = zoomTo(zoom, stop, performance.now())
  }

  const setZoom = (stop: ZoomStop): void => {
    setZoomAt(stop, app.screen.width / 2, app.screen.height / 2)
  }

  // The release lives here and not in `onWheel`, because the end of a gesture is the ABSENCE
  // of an event: nothing arrives to notice it, and the frame is the only thing still running.
  const zoomTick = (): void => {
    const now = performance.now()
    // reduced motion gets the exact stop immediately; the tracking during the gesture stays,
    // because that was the viewer's own hand and not motion we chose for them.
    if (zoomGestureEnded(zoom, now)) zoom = zoomRelease(zoom, now, !wantsMotion())
    const s = zoomScaleAt(zoom, now)
    if (s === world.scale.x) return
    world.scale.set(s)
    // While a follow is running it owns the position; otherwise the anchor stays put.
    if (followFn === null) place(anchor.sx - anchor.wx * s, anchor.sy - anchor.wy * s)
    else place(world.position.x, world.position.y)
    notifyCamera()
  }

  // camera: drag to pan, wheel steps integer zoom 1-4; the hand shows it
  app.stage.eventMode = 'static'
  app.stage.hitArea = app.screen
  app.renderer.events.cursorStyles.default = 'grab'
  // One tracker answers both questions the pointer raises: `isDrag` tells a tile pick from a
  // pan and is the same answer the throw reads, so a click can never become a fling.
  const wantsMotion = (): boolean =>
    typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches

  let drag: DragTrack | null = null
  let dragging = false
  let last = { x: 0, y: 0 }
  let glide: Fling | null = null

  /** Anything that says where the camera should be outranks something still deciding. */
  const stopGlide = (): void => {
    glide = null
  }

  app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    stopGlide() // catching a moving camera stops it, as a hand would
    dragging = true
    drag = trackDrag(null, e.global.x, e.global.y, performance.now())
    last = { x: e.global.x, y: e.global.y }
    app.canvas.style.cursor = 'grabbing'
  })
  app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (!dragging) return
    drag = trackDrag(drag, e.global.x, e.global.y, performance.now())
    if (isDrag(drag)) {
      fitted = false
      breakFollow() // the viewer takes the camera back
    }
    place(world.position.x + (e.global.x - last.x), world.position.y + (e.global.y - last.y))
    last = { x: e.global.x, y: e.global.y }
  })
  const endDrag = (): void => {
    if (dragging && wantsMotion()) glide = flingFrom(drag, performance.now())
    dragging = false
    app.canvas.style.cursor = 'grab'
  }
  app.stage.on('pointerup', endDrag)
  app.stage.on('pointerupoutside', endDrag)
  // The screen-sized `app.stage.hitArea` must stay: drag-to-pan, the fling and the wheel-zoom
  // anchor are all `app.stage` handlers and each needs a target under the pointer.
  app.stage.on('pointertap', (e: FederatedPointerEvent) => {
    if (isDrag(drag)) return // a drag is not a tile pick
    if (e.target !== app.stage) return // nor is a click that landed on a body or a building
    const wx = (e.global.x - world.position.x) / world.scale.x
    const wy = (e.global.y - world.position.y) / world.scale.y
    const t = screenToTile(wx, wy)
    for (const cb of tileCbs) cb(t)
  })

  // The glide, one frame at a time. A throw that reaches the edge of the world is over: the
  // clamp refused the move, and a camera grinding against a wall it cannot cross is not motion.
  const glideTick = (): void => {
    if (glide === null) return
    const step = flingStep(glide, app.ticker.deltaMS)
    glide = step.next
    const before = { x: world.position.x, y: world.position.y }
    place(before.x + step.dx, before.y + step.dy)
    if (world.position.x === before.x && world.position.y === before.y) stopGlide()
    else notifyCamera()
  }
  app.ticker.add(glideTick)

  // Read the delta, ask the pure rule, store. The DOM half has no logic (P6) — except for the
  // one thing only the DOM knows: `ctrlKey` is how the platform says "this was a pinch".
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    // A zoom pins the world point under the cursor; a camera still gliding would tear it out
    // from under the anchor, which is the class of defect the wheel gate already exists for.
    stopGlide()
    const now = performance.now()
    // Once per gesture, not once per step: a continuous zoom moves the scale on every event,
    // and re-pinning each time makes the town swim under the cursor instead of growing.
    if (zoom.live === null || now - zoom.lastWheelMs > WHEEL_GESTURE_GAP_MS) {
      fitted = false
      captureAnchor(e.offsetX, e.offsetY)
    }
    zoom = zoomWheel(zoom, e.deltaY, now, e.ctrlKey)
  }
  app.canvas.addEventListener('wheel', onWheel, { passive: false })
  app.ticker.add(zoomTick)

  // bake on first snapshot and whenever the terrain array identity changes
  let bakedTerrain: TileId[][] | null = null
  let bakedArtSig = -1
  // A bake tessellates every tile outline on the map, so it must never run more than once a
  // frame: one bake per asset message blocks the main thread hard enough to stall rAF.
  let dirty = false
  const bakeTick = (): void => {
    // Asking here rather than from `place()` costs one question a frame however many times the
    // camera moved, and still runs before the render, which Application adds at lower priority.
    baker.setView(viewRect())
    if (!dirty || bakedTerrain === null) return
    dirty = false
    rebakeGround(bakedTerrain)
  }
  app.ticker.add(bakeTick)

  const offSub = store.subscribe(() => {
    const s = store.getState()
    if (s === null) return
    // The bake is gated on the terrain, but the reachable box is not: it must follow the town
    // every time it grows, or the newest house is the one the camera cannot get to.
    recomputeBounds(s.terrain)
    // terrain art arriving is a rebake trigger too — the flat ground hot-swaps to materials
    const sig = groundArtSignature(store.assetRecords())
    if (s.terrain === bakedTerrain && sig === bakedArtSig) return
    const first = bakedTerrain === null
    bakedTerrain = s.terrain
    bakedArtSig = sig
    if (first) {
      // the very first map appears immediately; every later one waits for the frame
      rebakeGround(s.terrain)
      fitToTown()
      return
    }
    dirty = true
  })
  const offEvents = store.onEvents((evts) => {
    if (evts.some((ev) => ev.type === 'terrain_changed' || ev.type === 'tile_changed')) {
      const s = store.getState()
      if (s !== null) {
        bakedTerrain = s.terrain
        dirty = true
      }
    }
  })
  const boot = store.getState()
  if (boot !== null) {
    bakedTerrain = boot.terrain
    recomputeBounds(boot.terrain)
    rebakeGround(boot.terrain)
    fitToTown()
  }

  const clock = sceneClock(app)

  return {
    app,
    setTicking: clock.set,
    textScale: 1,
    world,
    layers,
    entities: layers.entities,
    overlay: layers.overlay,
    addDepthSource: (fn) => {
      depthSources.add(fn)
      return () => depthSources.delete(fn)
    },
    viewRect,
    reachableBox: () => bounds,
    tags,
    sortDepth: () => {
      const entries: DepthEntry[] = []
      for (const fn of depthSources) for (const e of fn()) entries.push(e)
      lastCounts = applyDepthOrder(entries, viewRect())
    },
    depthCounts: () => lastCounts,
    rebakeGround,
    centerOn,
    centerOnScreen,
    setZoom,
    setZoomAt,
    getZoom: () => world.scale.x,
    wantsMotion,
    getZoomStop: () => zoom.stop,
    panBy: (dx, dy) => {
      stopGlide()
      fitted = false
      breakFollow()
      place(world.position.x + dx, world.position.y + dy)
    },
    travelTo: (sx, sy) => {
      stopGlide()
      fitted = false
      breakFollow()
      centerOnScreen(sx, sy)
      notifyCamera()
    },
    centerHome: () => {
      stopGlide()
      fitted = false
      breakFollow()
      const c = boundsCentre(townBox())
      centerOnScreen(c.sx, c.sy)
      notifyCamera()
    },
    fitToTown,
    fitsWholeTown,
    onCamera: (cb) => {
      cameraCbs.push(cb)
      return () => {
        const i = cameraCbs.indexOf(cb)
        if (i >= 0) cameraCbs.splice(i, 1)
      }
    },
    setFollow: (target) => {
      if (target !== null) {
        fitted = false
        stopGlide() // a follow owns the camera; a leftover throw would fight it
      }
      followFn = target
    },
    onFollowEnd: (cb) => {
      followEndCbs.push(cb)
      return () => {
        const i = followEndCbs.indexOf(cb)
        if (i >= 0) followEndCbs.splice(i, 1)
      }
    },
    onTilePointer: (cb) => {
      tileCbs.push(cb)
    },
    destroy: () => {
      clock.close()
      offSub()
      offEvents()
      ro.disconnect()
      app.ticker.remove(followTick)
      app.ticker.remove(zoomTick)
      app.ticker.remove(glideTick)
      app.ticker.remove(bakeTick)
      app.canvas.removeEventListener('wheel', onWheel)
      tags.destroy()
      baker.destroy()
      app.destroy(true, { children: true })
    },
  }
}
