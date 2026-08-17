import { Application, Container, Graphics, RenderTexture, Sprite, TextureSource } from 'pixi.js'
import type { ApplicationOptions, FederatedPointerEvent, Texture } from 'pixi.js'
import type { AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { InteriorScene } from './interiorScene.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import {
  OCTAVE_ALPHA, ROAD_SHOULDER_DARK, ROAD_SHOULDER_LIGHT, groundArtSignature, groundField,
  isRoadMass, materialMatrix, octaveMatrix, roadRibbonPolys, roadShoulderBands,
} from './groundField.js'
import { applyDepthOrder, createLayers, type DepthEntry, type LayerSet } from './layers.js'
import { createTooltipLayer, type TooltipLayer } from './tooltip.js'
import { HEADLAND_COLOR, KERB_COLOR, furrowLines, patchOutline, type Tile } from './patches.js'
import { tileKind } from './tileset.js'
import { TextureBook } from './textures.js'

export const BACKGROUND = 0x322b38
export const ZOOM_MIN = 1
export const ZOOM_MAX = 4

// THE BAKE SEAM (C11 §9 supersession point). One whole-map pass is correct at the 48×48
// showcase scale; C11's 128×128 growth map replaces this with a chunked, dirty-rebake baker.
// Everything above talks to `GroundBaker`, so that swap touches this factory and nothing else.
export type GroundBaker = {
  rebake(terrain: TileId[][], records: AssetRecord[]): void
  destroy(): void
}

export function createGroundBaker(app: Application, sprite: Sprite, book: TextureBook): GroundBaker {
  let target: RenderTexture | null = null
  // one Texture per TERRAIN now — at most eight, whatever the size of the map
  const loaded = new Map<string, Texture>()
  let generation = 0

  // TERRAIN V2. One pass PER TERRAIN, not one stamp per tile. Every tile of a terrain
  // contributes its outline to a single Graphics, and that whole shape is filled from the
  // terrain's material in bake space, which is world space. The material therefore flows
  // across tile boundaries, and nothing in the picture varies at tile frequency. The old
  // `shade` checkerboard is gone with it: alternating every other diamond by 15% was a
  // literal checkerboard in the fallback path.
  //
  // V2.2 (U6): the fill matrix is no longer the identity. An identity tiled one 256px material
  // on an axis-aligned lattice across the whole map, so the pattern the eye found had simply
  // moved from tile frequency to material frequency.
  function draw(terrain: TileId[][], records: AssetRecord[], offX: number): void {
    if (target === null) return
    const layer = new Container()
    for (const [li, l] of groundField(terrain, records).layers.entries()) {
      // A road needs a rim or it disappears into the grass at 1x — v1's art carried a painted
      // edge and the material does not. Every shoulder is laid down BEFORE any ribbon, so a
      // neighbour's rim can never sit on top of this tile's surface.
      if (l.kind === 'road') {
        // Two tones across the rim's depth: light where the shoulder meets the ground, dark
        // where it meets the road. One flat shoulder measured only 0.060 luma from the grass,
        // which is why a road vanished at 1x (U5).
        for (const [tone, pick] of [
          [ROAD_SHOULDER_LIGHT, 'light'], [ROAD_SHOULDER_DARK, 'dark'],
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
          const cx = shape.sx + offX, cy = shape.sy
          if (shape.roadKey === null) {
            g.poly([cx, cy, cx + TILE_W / 2, cy + TILE_H / 2, cx, cy + TILE_H, cx - TILE_W / 2, cy + TILE_H / 2])
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
        g.fill(l.fallback)                     // art independence: palette-true flat ground
        layer.addChild(g)
      } else {
        tex.source.addressMode = 'repeat'      // the field wraps; the material must too
        // An IDENTITY matrix tiled one 256px material on an axis-aligned lattice across the
        // whole map — tile-frequency pattern replaced by material-frequency pattern (U6). Each
        // layer now samples through its own rotation and offset.
        g.fill({ texture: tex, matrix: materialMatrix(l.id, li) })
        layer.addChild(g)
        // One coarser pass at an incommensurate scale. Two periods with no common multiple
        // inside the map cannot line up into a lattice. One extra fill per ground layer, at
        // bake time — not a frame cost.
        const oct = new Graphics()
        shapesInto(oct)
        oct.fill({ texture: tex, matrix: octaveMatrix(l.id, li), alpha: OCTAVE_ALPHA })
        layer.addChild(oct)
      }
    }
    // U7: a patch was only ever the union of its tiles' diamonds under one material — a shape
    // with no edge, which is what read as an amorphous blob. Paved ground gets a kerb, a field
    // gets a headland and furrows. All of it lands in the BAKE, so it costs nothing per frame.
    const plaza: Tile[] = [], farmland: Tile[] = []
    for (let y = 0; y < terrain.length; y++) {
      const row = terrain[y]!
      for (let x = 0; x < row.length; x++) {
        if (tileKind(row[x]!) === 'farmland') farmland.push({ x, y })
        else if (isRoadMass(terrain, x, y)) plaza.push({ x, y })
      }
    }

    const strokeAt = (polys: number[][], color: number, alpha: number, close: boolean): void => {
      if (polys.length === 0) return
      const g = new Graphics()
      for (const poly of polys) {
        const pts: number[] = []
        for (let i = 0; i < poly.length; i += 2) pts.push(poly[i]! + offX, poly[i + 1]!)
        if (close) g.poly(pts)
        else { g.moveTo(pts[0]!, pts[1]!); g.lineTo(pts[2]!, pts[3]!) }
      }
      g.stroke({ color, alpha, width: 1, alignment: 0.5 })
      layer.addChild(g)
    }

    strokeAt(furrowLines(farmland), HEADLAND_COLOR, OCTAVE_ALPHA, false)
    strokeAt(patchOutline(farmland), HEADLAND_COLOR, 1, true)
    strokeAt(patchOutline(plaza), KERB_COLOR, 1, true)

    app.renderer.render({ container: layer, target, clear: true })
    layer.destroy({ children: true })
  }

  return {
    rebake(terrain, records) {
      const h = terrain.length
      const w = terrain[0]?.length ?? 0
      const texW = (w + h) * (TILE_W / 2)
      const texH = (w + h) * (TILE_H / 2)
      const offX = h * (TILE_W / 2) // sx can go negative down to -h*16; shift into texture space
      if (target === null || target.width !== texW || target.height !== texH) {
        target?.destroy(true)
        target = RenderTexture.create({ width: texW, height: texH })
        sprite.texture = target
        sprite.position.set(-offX, 0)
      }
      draw(terrain, records, offX)

      // Textures load async. Paint the flat fallback now, then repaint once the tile art is
      // in — a viewer never waits on a blank map, and a stale load never overwrites a newer bake.
      // one material per terrain — at most eight urls for the whole map
      const urls = [...new Set(groundField(terrain, records).layers.map((l) => l.url))]
        .filter((u): u is string => u !== null && !loaded.has(u))
      if (urls.length === 0) return
      const gen = ++generation
      void Promise.all(urls.map(async (u) => { loaded.set(u, await book.get(u)) }))
        .then(() => { if (gen === generation) draw(terrain, records, offX) })
        .catch(() => { /* art is optional — the flat diamonds already rendered */ })
    },
    destroy() {
      generation++
      target?.destroy(true)
      target = null
      loaded.clear()
    },
  }
}

export type Scene = {
  app: Application
  world: Container
  /** the eight named layers — the one place that decides what is drawn over what */
  layers: LayerSet
  /** the only depth-sorted layer; `layers.entities`, named for the code that lives in it */
  entities: Container
  /** register what this module draws into `entities`; returns the unregister */
  addDepthSource(fn: () => DepthEntry[]): () => void
  /** one painter's order for the whole frame — called once per tick, by StageMount */
  sortDepth(): void
  /** the visible world rectangle, in the space labels are drawn in (tooltip.ts places in it) */
  viewRect(): { x: number; y: number; w: number; h: number }
  /** THE label layer. One owner for every world tag, so two can never be up by accident and
   *  a torn-down sprite cannot leave one behind. */
  tags: TooltipLayer
  /** above the entities and never hit-tested: place names and other reading aids */
  overlay: Container
  rebakeGround(terrain: TileId[][], records?: AssetRecord[]): void
  centerOn(x: number, y: number): void
  setZoom(z: 1 | 2 | 3 | 4): void
  getZoom(): number
  panBy(dx: number, dy: number): void
  centerHome(): void
  onCamera(cb: () => void): () => void
  setFollow(target: (() => { x: number; y: number } | null) | null): void
  /** fires when a user gesture (drag, pan, recenter) takes the camera back */
  onFollowEnd(cb: () => void): () => void
  onTilePointer(cb: (t: { x: number; y: number }) => void): void
  /** world-space anchor for an agent's sprite; wired by StageMount once layers exist */
  anchorOf?: (agentId: string) => { x: number; y: number } | null
  /** the interior sub-scene; wired by StageMount once the character layer exists */
  interior?: InteriorScene
  destroy(): void
}

// Pixi defaults to one backing pixel per CSS pixel. On a DPR-2 screen the browser then resamples
// the whole canvas, so NEAREST art and every in-canvas glyph arrive soft. `autoDensity` keeps the
// CSS box (and therefore `app.screen`, which all the camera maths is written in) unchanged.
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
  // resizeTo only tracks window resizes; panel open/close changes the root element itself
  const ro = new ResizeObserver(() => app.resize())
  ro.observe(rootEl)

  const world = new Container()
  // One table decides what is over what (layers.ts). A label is a reading aid, not a thing in
  // the world: every layer but `entities` is event-inert, so it can never steal a click from
  // the building it names.
  const layers = createLayers(world)

  const groundSprite = new Sprite()
  layers.ground.addChild(groundSprite)
  app.stage.addChild(world)

  const viewRect = (): { x: number; y: number; w: number; h: number } => {
    const k = world.scale.x || 1
    return {
      x: -world.position.x / k, y: -world.position.y / k,
      w: app.screen.width / k, h: app.screen.height / k,
    }
  }
  const tags = createTooltipLayer(layers, viewRect)

  const tileCbs: Array<(t: { x: number; y: number }) => void> = []

  // The depth sort has ONE owner and runs ONCE a frame over the whole live set. Modules
  // publish the ground they stand on; nobody publishes an opinion about who is in front.
  const depthSources = new Set<() => DepthEntry[]>()

  const book = new TextureBook()
  const baker = createGroundBaker(app, groundSprite, book)

  function rebakeGround(terrain: TileId[][], records?: AssetRecord[]): void {
    baker.rebake(terrain, records ?? store.assetRecords())
  }

  function centerOn(x: number, y: number): void {
    const { sx, sy } = tileToScreen(x, y)
    world.position.set(app.screen.width / 2 - sx * world.scale.x, app.screen.height / 2 - sy * world.scale.y)
  }

  // smooth follow: eases the camera toward a moving world-space anchor each frame
  let followFn: (() => { x: number; y: number } | null) | null = null
  const followEndCbs: Array<() => void> = []
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
    world.position.x += (tx - world.position.x) * k
    world.position.y += (ty - world.position.y) * k
  }
  app.ticker.add(followTick)

  const cameraCbs: Array<() => void> = []
  const notifyCamera = (): void => {
    for (const cb of cameraCbs) cb()
  }

  function setZoom(z: 1 | 2 | 3 | 4): void {
    // keep the screen center fixed while zooming
    const cx = app.screen.width / 2
    const cy = app.screen.height / 2
    const wx = (cx - world.position.x) / world.scale.x
    const wy = (cy - world.position.y) / world.scale.y
    world.scale.set(z)
    world.position.set(cx - wx * z, cy - wy * z)
    notifyCamera()
  }

  // camera: drag to pan, wheel steps integer zoom 1-4; the hand shows it
  app.stage.eventMode = 'static'
  app.stage.hitArea = app.screen
  app.renderer.events.cursorStyles.default = 'grab'
  let dragging = false
  let moved = false
  let last = { x: 0, y: 0 }
  app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    dragging = true
    moved = false
    last = { x: e.global.x, y: e.global.y }
    app.canvas.style.cursor = 'grabbing'
  })
  app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (!dragging) return
    const dx = e.global.x - last.x
    const dy = e.global.y - last.y
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      moved = true
      breakFollow() // the viewer takes the camera back
    }
    world.position.x += dx
    world.position.y += dy
    last = { x: e.global.x, y: e.global.y }
  })
  const endDrag = (): void => {
    dragging = false
    app.canvas.style.cursor = 'grab'
  }
  app.stage.on('pointerup', endDrag)
  app.stage.on('pointerupoutside', endDrag)
  app.stage.on('pointertap', (e: FederatedPointerEvent) => {
    if (moved) return // a drag is not a tile pick
    const wx = (e.global.x - world.position.x) / world.scale.x
    const wy = (e.global.y - world.position.y) / world.scale.y
    const t = screenToTile(wx, wy)
    for (const cb of tileCbs) cb(t)
  })
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const cur = Math.round(world.scale.x)
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cur + (e.deltaY < 0 ? 1 : -1)))
    setZoom(next as 1 | 2 | 3 | 4)
  }
  app.canvas.addEventListener('wheel', onWheel, { passive: false })

  // bake on first snapshot and whenever the terrain array identity changes
  let bakedTerrain: TileId[][] | null = null
  let bakedArtSig = -1
  // A bake tessellates every tile outline on the map, so it must never run more than once a
  // frame — and it must not run at all for art the ground does not use. Booting used to fire
  // one full bake PER ASSET MESSAGE; with the library ingested that is ~166 of them back to
  // back, which blocks the main thread hard enough that requestAnimationFrame itself drops to
  // fractions of a frame per second. Mark dirty, bake once on the next tick.
  let dirty = false
  const bakeTick = (): void => {
    if (!dirty || bakedTerrain === null) return
    dirty = false
    rebakeGround(bakedTerrain)
  }
  app.ticker.add(bakeTick)

  const offSub = store.subscribe(() => {
    const s = store.getState()
    if (s === null) return
    // terrain art arriving is a rebake trigger too — the flat ground hot-swaps to materials
    const sig = groundArtSignature(store.assetRecords())
    if (s.terrain === bakedTerrain && sig === bakedArtSig) return
    const first = bakedTerrain === null
    bakedTerrain = s.terrain
    bakedArtSig = sig
    if (first) {
      // the very first map appears immediately; every later one waits for the frame
      rebakeGround(s.terrain)
      centerOn(s.terrain[0]!.length / 2, s.terrain.length / 2)
      return
    }
    dirty = true
  })
  const offEvents = store.onEvents((evts) => {
    if (evts.some((ev) => ev.type === 'terrain_changed')) {
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
    rebakeGround(boot.terrain)
    centerOn(boot.terrain[0]!.length / 2, boot.terrain.length / 2)
  }

  return {
    app,
    world,
    layers,
    entities: layers.entities,
    overlay: layers.overlay,
    addDepthSource: (fn) => {
      depthSources.add(fn)
      return () => depthSources.delete(fn)
    },
    viewRect,
    tags,
    sortDepth: () => {
      const entries: DepthEntry[] = []
      for (const fn of depthSources) entries.push(...fn())
      applyDepthOrder(entries)
    },
    rebakeGround,
    centerOn,
    setZoom,
    getZoom: () => world.scale.x,
    panBy: (dx, dy) => {
      breakFollow()
      world.position.x += dx
      world.position.y += dy
    },
    centerHome: () => {
      breakFollow()
      if (bakedTerrain !== null) centerOn(bakedTerrain[0]!.length / 2, bakedTerrain.length / 2)
    },
    onCamera: (cb) => {
      cameraCbs.push(cb)
      return () => {
        const i = cameraCbs.indexOf(cb)
        if (i >= 0) cameraCbs.splice(i, 1)
      }
    },
    setFollow: (target) => {
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
      offSub()
      offEvents()
      ro.disconnect()
      app.ticker.remove(followTick)
      app.ticker.remove(bakeTick)
      app.canvas.removeEventListener('wheel', onWheel)
      tags.destroy()
      baker.destroy()
      app.destroy(true, { children: true })
    },
  }
}
