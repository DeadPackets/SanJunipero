import type { TileId } from '@sj/engine/state'
import type { AssetRecord } from '@sj/shared'
import type { ApplicationOptions } from 'pixi.js'
import { Application, Container, TextureSource } from 'pixi.js'
import type { WorldStore } from '../state/worldStore.js'
import {
  type CameraBounds,
  cameraBoundsOf,
  drawnBoundsOf,
  reachableBoundsOf,
  ZOOM_STOPS,
  type ZoomStop,
} from './camera.js'
import { createCameraRig } from './cameraRig.js'
import { createGroundBaker } from './groundBake.js'
import { groundArtSignature } from './groundField.js'
import type { InteriorScene } from './interiorScene.js'
import {
  applyDepthOrder,
  createLayers,
  type DepthCounts,
  type DepthEntry,
  type LayerSet,
} from './layers.js'
import { TextureBook } from './textures.js'
import { createTooltipLayer, type TooltipLayer } from './tooltip.js'

export const BACKGROUND = 0x322b38
/** The ends of `ZOOM_STOPS`, so the HUD's disabled state and the wheel's clamp share a source. */
export const ZOOM_MIN: ZoomStop = ZOOM_STOPS[0]
export const ZOOM_MAX: ZoomStop = ZOOM_STOPS[ZOOM_STOPS.length - 1]!

/** A scene's clock, held rather than reached for through `app.ticker`: Pixi's
 *  `Application.destroy()` nulls that field, so an effect queued before teardown throws. */
export function sceneClock(app: { ticker: { start(): void; stop(): void } | null }): {
  set: (on: boolean) => void
  close: () => void
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
    rig.onResize()
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
  let townBounds: CameraBounds = bounds

  const structureList = (): { x: number; y: number; w: number; h: number }[] => {
    const s = store.getState()
    return s === null ? [] : Object.values(s.structures)
  }
  const recomputeBounds = (terrain: TileId[][]): void => {
    const list = structureList()
    bounds = reachableBoundsOf(terrain, list)
    // Drawn, not footprint: a sprite overhangs its own ground, and fitting the ground cuts the
    // roofs off. Derived here so the camera does not re-walk the town on every notify.
    townBounds = list.length === 0 ? bounds : drawnBoundsOf(list)
  }
  const rig = createCameraRig(app, world, {
    reachable: () => bounds,
    town: () => townBounds,
  })

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
      rig.fitToTown()
      return
    }
    dirty = true
  })
  const offEvents = store.onEvents((evts) => {
    if (evts.some((ev) => ev.type === 'tile_changed')) {
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
    rig.fitToTown()
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
    centerOn: rig.centerOn,
    centerOnScreen: rig.centerOnScreen,
    setZoom: rig.setZoom,
    setZoomAt: rig.setZoomAt,
    getZoom: rig.getZoom,
    wantsMotion: rig.wantsMotion,
    getZoomStop: rig.getZoomStop,
    panBy: rig.panBy,
    travelTo: rig.travelTo,
    centerHome: rig.centerHome,
    fitToTown: rig.fitToTown,
    fitsWholeTown: rig.fitsWholeTown,
    onCamera: rig.onCamera,
    setFollow: rig.setFollow,
    onFollowEnd: rig.onFollowEnd,
    onTilePointer: rig.onTilePointer,
    destroy: () => {
      clock.close()
      offSub()
      offEvents()
      ro.disconnect()
      rig.destroy()
      app.ticker.remove(bakeTick)
      tags.destroy()
      baker.destroy()
      app.destroy(true, { children: true })
    },
  }
}
