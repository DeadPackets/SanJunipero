import { Application, Container, Graphics, RenderTexture, Sprite, TextureSource } from 'pixi.js'
import type { FederatedPointerEvent, Texture } from 'pixi.js'
import type { AssetRecord } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { InteriorScene } from './interiorScene.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import { shadeColor, tilesetPlan } from './ground.js'
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
  // one Texture per (kind, variant) or road key — ≤ 32 entries at 48×48
  const loaded = new Map<string, Texture>()
  let generation = 0

  function draw(terrain: TileId[][], records: AssetRecord[], offX: number): void {
    if (target === null) return
    const layer = new Container()
    const g = new Graphics()
    layer.addChild(g)
    const diamond = (cx: number, sy: number, color: number, shade: boolean): void => {
      g.poly([cx, sy, cx + TILE_W / 2, sy + TILE_H / 2, cx, sy + TILE_H, cx - TILE_W / 2, sy + TILE_H / 2])
      g.fill(shade ? shadeColor(color) : color)
    }
    const blit = (url: string | null, cx: number, sy: number): boolean => {
      const tex = url === null ? undefined : loaded.get(url)
      if (tex === undefined) return false
      const s = new Sprite(tex)                   // NEAREST is global (C6 T11); drawn 1:1
      s.position.set(cx - TILE_W / 2, sy)
      layer.addChild(s)
      return true
    }
    for (const cell of tilesetPlan(terrain, records)) {
      const cx = cell.sx + offX
      // An overlay tile is a ribbon on transparency: paint the ground first or its own holes
      // show the stage. If either half is still loading, the flat diamond covers the tile —
      // a viewer never sees a hole, only a coarser tile.
      if (cell.overlay && cell.base !== null) {
        if (loaded.has(cell.url ?? '')) {
          if (!blit(cell.base.url, cx, cell.sy)) diamond(cx, cell.sy, cell.base.fallback, cell.shade)
          blit(cell.url, cx, cell.sy)
          continue
        }
        diamond(cx, cell.sy, cell.fallback, cell.shade)
        continue
      }
      if (blit(cell.url, cx, cell.sy)) continue
      diamond(cx, cell.sy, cell.fallback, cell.shade)
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
      // both layers, or a road's ground never loads and every ribbon stays a flat diamond
      const urls = [...new Set(tilesetPlan(terrain, records).flatMap((c) => [c.url, c.base?.url ?? null]))]
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

export async function createScene(rootEl: HTMLElement, store: WorldStore): Promise<Scene> {
  TextureSource.defaultOptions.scaleMode = 'nearest' // global NEAREST law — before any texture exists
  const app = new Application()
  await app.init({ antialias: false, roundPixels: true, background: BACKGROUND, resizeTo: rootEl })
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
  let bakedAssetsSeq = -1
  const offSub = store.subscribe(() => {
    const s = store.getState()
    if (s === null) return
    // terrain art arriving is a rebake trigger too — the flat diamonds hot-swap to tiles
    const artChanged = store.assetsSeq() !== bakedAssetsSeq
    if (s.terrain !== bakedTerrain || artChanged) {
      const first = bakedTerrain === null
      bakedTerrain = s.terrain
      bakedAssetsSeq = store.assetsSeq()
      rebakeGround(s.terrain)
      if (first) centerOn(s.terrain[0]!.length / 2, s.terrain.length / 2)
    }
  })
  const offEvents = store.onEvents((evts) => {
    if (evts.some((ev) => ev.type === 'terrain_changed' || ev.type === 'tile_changed')) {
      const s = store.getState()
      if (s !== null) {
        bakedTerrain = s.terrain
        rebakeGround(s.terrain)
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
      app.canvas.removeEventListener('wheel', onWheel)
      baker.destroy()
      app.destroy(true, { children: true })
    },
  }
}
