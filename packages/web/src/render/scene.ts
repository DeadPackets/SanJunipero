import { Application, Container, Graphics, RenderTexture, Sprite, TextureSource } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import { groundPlan, shadeColor } from './ground.js'

export const BACKGROUND = 0x322b38
export const ZOOM_MIN = 1
export const ZOOM_MAX = 4

export type Scene = {
  app: Application
  world: Container
  entities: Container
  rebakeGround(terrain: TileId[][]): void
  centerOn(x: number, y: number): void
  setZoom(z: 1 | 2 | 3 | 4): void
  getZoom(): number
  panBy(dx: number, dy: number): void
  centerHome(): void
  onCamera(cb: () => void): () => void
  setFollow(target: (() => { x: number; y: number } | null) | null): void
  onTilePointer(cb: (t: { x: number; y: number }) => void): void
  /** world-space anchor for an agent's sprite; wired by StageMount once layers exist */
  anchorOf?: (agentId: string) => { x: number; y: number } | null
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

  let groundTexture: RenderTexture | null = null
  const groundSprite = new Sprite()
  world.addChild(groundSprite)
  world.addChild(entities)
  app.stage.addChild(world)

  const tileCbs: Array<(t: { x: number; y: number }) => void> = []

  function rebakeGround(terrain: TileId[][]): void {
    const h = terrain.length
    const w = terrain[0]?.length ?? 0
    const texW = (w + h) * (TILE_W / 2)
    const texH = (w + h) * (TILE_H / 2)
    const offX = h * (TILE_W / 2) // sx can go negative down to -h*16; shift into texture space
    if (groundTexture === null || groundTexture.width !== texW || groundTexture.height !== texH) {
      groundTexture?.destroy(true)
      groundTexture = RenderTexture.create({ width: texW, height: texH })
      groundSprite.texture = groundTexture
      groundSprite.position.set(-offX, 0)
    }
    const g = new Graphics()
    for (const cell of groundPlan(terrain)) {
      const cx = cell.sx + offX
      g.poly([cx, cell.sy, cx + TILE_W / 2, cell.sy + TILE_H / 2, cx, cell.sy + TILE_H, cx - TILE_W / 2, cell.sy + TILE_H / 2])
      g.fill(cell.shade ? shadeColor(cell.color) : cell.color)
    }
    app.renderer.render({ container: g, target: groundTexture, clear: true })
    g.destroy()
  }

  function centerOn(x: number, y: number): void {
    const { sx, sy } = tileToScreen(x, y)
    world.position.set(app.screen.width / 2 - sx * world.scale.x, app.screen.height / 2 - sy * world.scale.y)
  }

  // smooth follow: eases the camera toward a moving world-space anchor each frame
  let followFn: (() => { x: number; y: number } | null) | null = null
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
      followFn = null // the viewer takes the camera back
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
  const offSub = store.subscribe(() => {
    const s = store.getState()
    if (s !== null && s.terrain !== bakedTerrain) {
      const first = bakedTerrain === null
      bakedTerrain = s.terrain
      rebakeGround(s.terrain)
      if (first) centerOn(s.terrain[0]!.length / 2, s.terrain.length / 2)
    }
  })
  const offEvents = store.onEvents((evts) => {
    if (evts.some((ev) => ev.type === 'terrain_changed')) {
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
      followFn = null
      world.position.x += dx
      world.position.y += dy
    },
    centerHome: () => {
      followFn = null
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
    onTilePointer: (cb) => {
      tileCbs.push(cb)
    },
    destroy: () => {
      offSub()
      offEvents()
      ro.disconnect()
      app.ticker.remove(followTick)
      app.canvas.removeEventListener('wheel', onWheel)
      groundTexture?.destroy(true)
      app.destroy(true, { children: true })
    },
  }
}
