import { Application, Container, Graphics, Matrix, RenderTexture, Sprite, TextureSource } from 'pixi.js'
import type { ApplicationOptions, FederatedPointerEvent, Texture } from 'pixi.js'
import type { AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { InteriorScene } from './interiorScene.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import {
  ROAD_SHOULDER, groundArtSignature, groundField, roadRibbonPolys, roadShoulderPolys,
} from './groundField.js'
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
  // terrain's material with an IDENTITY matrix — so the texture is sampled in bake space,
  // which is world space. The material therefore flows across tile boundaries, and nothing
  // in the picture varies at tile frequency. The old `shade` checkerboard is gone with it:
  // alternating every other diamond by 15% was a literal checkerboard in the fallback path.
  function draw(terrain: TileId[][], records: AssetRecord[], offX: number): void {
    if (target === null) return
    const layer = new Container()
    for (const l of groundField(terrain, records).layers) {
      // A road needs a rim or it disappears into the grass at 1x — v1's art carried a painted
      // edge and the material does not. Every shoulder is laid down BEFORE any ribbon, so a
      // neighbour's rim can never sit on top of this tile's surface.
      if (l.kind === 'road') {
        const sh = new Graphics()
        for (const shape of l.shapes) {
          if (shape.roadKey === null) continue
          for (const poly of roadShoulderPolys(shape.roadKey)) {
            const pts: number[] = []
            for (let i = 0; i < poly.length; i += 2) {
              pts.push(shape.sx + offX + poly[i]!, shape.sy + poly[i + 1]!)
            }
            sh.poly(pts)
          }
        }
        sh.fill(ROAD_SHOULDER)
        layer.addChild(sh)
      }
      const g = new Graphics()
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
      const tex = l.url === null ? undefined : loaded.get(l.url)
      if (tex === undefined) {
        g.fill(l.fallback)                     // art independence: palette-true flat ground
      } else {
        tex.source.addressMode = 'repeat'      // the field wraps; the material must too
        g.fill({ texture: tex, matrix: new Matrix() })
      }
      layer.addChild(g)
    }
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
  entities: Container
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
  const entities = new Container()
  entities.sortableChildren = true

  const groundSprite = new Sprite()
  world.addChild(groundSprite)
  world.addChild(entities)
  app.stage.addChild(world)

  const tileCbs: Array<(t: { x: number; y: number }) => void> = []

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
    entities,
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
      baker.destroy()
      app.destroy(true, { children: true })
    },
  }
}
