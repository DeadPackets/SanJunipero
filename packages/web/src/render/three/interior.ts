import { createMaterialLibrary } from './materials.js'
import { DEFAULT_CONFIG, isRoofedKind, simTimeFromTick } from '@sj/shared'
import { effectiveConfig } from '@sj/engine/laws'
import type { AgentBody } from '@sj/engine/state'
import { Sprite, type FederatedPointerEvent } from 'pixi.js'
import {
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PointLight,
  Raycaster,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'
import type { WorldStore } from '../../state/worldStore.js'
import type { Scene } from '../scene.js'
import type { InteriorScene } from '../interiorScene.js'
import { TextureBook, characterArt } from '../textures.js'
import { characterCell } from '../characters.js'
import { facingFrom, tileToScreen, type Facing } from '../iso.js'
import { WALK_LOOP } from '../charAnim.js'
import { interiorPath, type RoomMap } from '../interiorMap.js'
import { createPeople } from './people.js'
import { CAMERA_ELEVATION, WORLD_PX } from './projection.js'
import { disposeGroup } from './dispose.js'
import { buildInteriorRoom } from './interiorRoom.js'

type Body = {
  sprite: Sprite
  at: Vector3
  goal: Vector3
  path: Vector3[]
  facing: Facing
  phase: number
  sleeping: boolean
  slot: number
}

export function createThreeInterior(
  view: Scene,
  store: WorldStore,
  renderer: WebGLRenderer,
  select: (id: string) => void,
): InteriorScene & { render(dt: number): boolean } {
  const stage = new ThreeScene()
  stage.background = new Color(0x353e36)
  const camera = new OrthographicCamera(-8, 8, 8, -8, 0.1, 120)
  const ambient = new HemisphereLight(0xfff0d0, 0x6e7661, 2.1)
  const sun = new DirectionalLight(0xffe3b1, 2.2)
  sun.position.set(-1.5, 6, -8)
  sun.target.position.set(1, 0, 2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -14
  sun.shadow.camera.right = 14
  sun.shadow.camera.top = 14
  sun.shadow.camera.bottom = -14
  sun.shadow.normalBias = 0.025
  sun.shadow.bias = -0.00015
  sun.shadow.radius = 3
  const fire = new PointLight(0xffb86c, 0, 12, 1.5)
  fire.castShadow = true
  fire.shadow.mapSize.set(512, 512)
  fire.shadow.bias = -0.001
  fire.shadow.normalBias = 0.035
  fire.shadow.radius = 4
  stage.add(ambient, sun, sun.target, fire)
  const people = createPeople(stage)
  const book = new TextureBook()
  const materials = createMaterialLibrary()
  let artSeq = -1
  const loading = new Set<string>()
  const bodies = new Map<string, Body>()
  const listeners = new Set<(id: string | null) => void>()
  let active: string | null = null,
    followed: string | null = null,
    followedRoom: string | null = null
  let model: ReturnType<typeof buildInteriorRoom> | null = null,
    modelKey = '',
    itemKey = ''
  let map: RoomMap = { w: 0, h: 0, pieces: [], blocked: new Uint8Array() }
  let lastTick = -1,
    seconds = 0,
    destroyed = false
  const savedVisibility = new Map<{ visible: boolean }, boolean>()
  const ray = new Raycaster()
  const pointers = new Vector2()
  const setActive = (id: string | null) => {
    const s = id === null ? null : store.getState()?.structures[id]
    if (
      id !== null &&
      (!s || s.stage !== 'complete' || !isRoofedKind(store.getConfig() ?? DEFAULT_CONFIG, s.kind))
    )
      return
    if (active === id) return
    active = id
    if (view.app.canvas.parentElement)
      view.app.canvas.parentElement.dataset.room = id === null ? 'off' : 'on'
    modelKey = ''
    itemKey = ''
    lastTick = -1
    for (const body of bodies.values()) body.sprite.destroy()
    bodies.clear()
    people.sync([], () => null)
    if (model) {
      disposeGroup(model.group)
      model = null
    }
    const layers = [view.world, ...view.app.stage.children.filter((c) => c !== view.world)]
    if (id !== null) {
      for (const layer of layers)
        if (!savedVisibility.has(layer)) {
          savedVisibility.set(layer, layer.visible)
          layer.visible = false
        }
    } else {
      for (const [layer, visible] of savedVisibility) layer.visible = visible
      savedVisibility.clear()
    }
    for (const cb of listeners) cb(id)
  }
  const syncFollow = () => {
    if (followed === null) return
    const next = store.getState()?.agents[followed]?.insideId ?? null
    if (next !== followedRoom) {
      followedRoom = next
      setActive(next)
    }
  }
  const off = store.subscribe(syncFollow)
  const pick = (event: FederatedPointerEvent) => {
    if (active === null || view.wasDrag()) return
    pointers.set(
      (event.global.x / view.app.screen.width) * 2 - 1,
      1 - (event.global.y / view.app.screen.height) * 2,
    )
    ray.setFromCamera(pointers, camera)
    const hit = ray.intersectObjects(people.pickables(), false)[0]
    if (hit) select(String(hit.object.userData.pick.id))
  }
  view.app.stage.on('pointertap', pick)
  const grid = (v: Vector3) => ({
    x: Math.max(0, Math.min(map.w - 1, Math.round((v.x + model!.w / 2 - 0.2) / 0.4))),
    y: Math.max(0, Math.min(map.h - 1, Math.round((v.z + model!.d / 2 - 0.2) / 0.4))),
  })
  const point = (x: number, y: number) =>
    new Vector3(-model!.w / 2 + 0.2 + x * 0.4, 0, -model!.d / 2 + 0.2 + y * 0.4)
  const nearest = (v: Vector3, used: Set<number>) => {
    let best: Vector3 | null = null,
      dist = Infinity
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const key = y * map.w + x
        if (map.blocked[key] || used.has(key)) continue
        const p = point(x, y),
          delta = p.distanceToSquared(v)
        if (delta < dist) {
          dist = delta
          best = p
        }
      }
    return best ?? v.clone()
  }
  const destination = (a: AgentBody, slot: number) => {
    const room = model!
    if (a.asleep && room.beds.length) return room.beds[slot % room.beds.length]!.clone()
    const verb = a.activity?.verb ?? ''
    if (verb === 'exit') return room.entry.clone()
    if (verb === 'stoke' || verb === 'cook') return room.hearth.clone().add(new Vector3(0, 0, 1.35))
    if (verb === 'stow' || verb === 'take') return room.storage.clone().add(new Vector3(0, 0, 1))
    if (verb === 'craft' || verb === 'eat') return room.table.clone().add(new Vector3(1.2, 0, 0))
    const places = [
      new Vector3(room.w * 0.04, 0, room.d * 0.24),
      new Vector3(room.w * 0.32, 0, -room.d * 0.05),
      new Vector3(-room.w * 0.02, 0, room.d * 0.4),
      new Vector3(room.w * 0.35, 0, room.d * 0.4),
    ]
    return places[slot % places.length]!.clone()
  }
  return {
    setActive,
    setFollowed(id) {
      if (followed === id) return
      followed = id
      followedRoom = null
      if (id !== null) {
        followedRoom = store.getState()?.agents[id]?.insideId ?? null
        setActive(followedRoom)
      }
    },
    isActive: () => active !== null,
    activeId: () => active,
    onChange(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    render(dt) {
      if (active === null || destroyed) return false
      const state = store.getState(),
        s = state?.structures[active]
      if (!state || !s || s.stage !== 'complete') {
        setActive(null)
        return false
      }
      const config = effectiveConfig(store.getConfig() ?? DEFAULT_CONFIG, state.laws)
      const key = [s.id, s.kind, s.w, s.h, s.owner, s.facing].join(':')
      if (key !== modelKey) {
        if (model) disposeGroup(model.group)
        model = buildInteriorRoom(s, config)
        stage.add(model.group)
        modelKey = key
        itemKey = ''
        artSeq = -1
        map = {
          w: Math.floor(model.w / 0.4),
          h: Math.floor(model.d / 0.4),
          pieces: [],
          blocked: new Uint8Array(Math.floor(model.w / 0.4) * Math.floor(model.d / 0.4)),
        }
        for (let y = 0; y < map.h; y++)
          for (let x = 0; x < map.w; x++) {
            const p = point(x, y)
            map.blocked[y * map.w + x] = model.obstacles.some(
              (o) => Math.abs(p.x - o.x) < o.w / 2 + 0.22 && Math.abs(p.z - o.z) < o.d / 2 + 0.22,
            )
              ? 1
              : 0
          }
      }
      const room = model!
      if (artSeq !== store.assetsSeq()) {
        artSeq = store.assetsSeq()
        void materials.apply(room.group, s.kind, store.assetRecords())
      }
      const occupants = Object.values(state.agents)
        .filter((a) => a.alive && a.insideId === active)
        .sort((a, b) => a.id.localeCompare(b.id))
      const ids = occupants.map((a) => a.id)
      const fresh = lastTick < 0 || Math.abs(state.tick - lastTick) > 5
      const moving = view.wantsMotion() && store.timeMoving() && !store.getPaused()
      if (moving) seconds += dt
      if (lastTick >= 0 && Math.abs(state.tick - lastTick) > 5) {
        for (const b of bodies.values()) b.sprite.destroy()
        bodies.clear()
      }
      lastTick = state.tick
      for (const [id, b] of bodies)
        if (!ids.includes(id)) {
          b.sprite.destroy()
          bodies.delete(id)
        }
      const used = new Set<number>()
      for (const b of bodies.values()) {
        const p = grid(b.goal)
        used.add(p.y * map.w + p.x)
      }
      for (const a of occupants) {
        let body = bodies.get(a.id)
        if (!body) {
          const taken = new Set([...bodies.values()].map((b) => b.slot))
          let slot = 0
          while (taken.has(slot)) slot++
          const desired = destination(a, slot),
            at = a.asleep ? desired : nearest(fresh ? desired : room.entry, used)
          body = {
            sprite: new Sprite(),
            at: at.clone(),
            goal: at.clone(),
            path: [],
            facing: 'se',
            phase: 0,
            sleeping: a.asleep,
            slot,
          }
          bodies.set(a.id, body)
          const g = grid(at)
          used.add(g.y * map.w + g.x)
        }
        const own = grid(body.goal)
        used.delete(own.y * map.w + own.x)
        const wanted = destination(a, body.slot),
          goal = a.asleep ? wanted : nearest(wanted, used)
        if (goal.distanceToSquared(body.goal) > 0.02 || a.asleep !== body.sleeping) {
          if (a.asleep || body.sleeping || !moving) {
            body.at.copy(goal)
            body.path = []
          } else {
            const from = grid(body.at),
              to = grid(goal)
            body.path = (interiorPath(map, from, to) ?? []).map((p) => point(p.x, p.y))
          }
          body.goal.copy(goal)
          body.sleeping = a.asleep
        }
        const g = grid(body.goal)
        used.add(g.y * map.w + g.x)
        let walking = false
        const next = body.path[0]
        if (next && moving) {
          const delta = next.clone().sub(body.at),
            length = delta.length()
          if (length < dt * 1.6) {
            body.at.copy(next)
            body.path.shift()
          } else {
            body.at.addScaledVector(delta, (dt * 1.6) / length)
            body.facing = facingFrom(delta.x, delta.z) ?? body.facing
            walking = true
            body.phase += dt * 5.5
          }
        }
        if (!walking && !a.asleep) {
          const target = room.table.clone().sub(body.at)
          body.facing = facingFrom(target.x, target.z) ?? 'se'
        }
        const art = characterArt(store.assetRecords(), a.id),
          sheet = book.peek(art.url)
        if (!sheet) {
          if (!loading.has(art.url)) {
            loading.add(art.url)
            void book
              .get(art.url)
              .catch(() => undefined)
              .finally(() => loading.delete(art.url))
          }
          continue
        }
        const row = a.asleep ? 'sleep' : walking ? WALK_LOOP[Math.floor(body.phase) % 4]! : 'idle'
        const cell = characterCell(sheet, art, row, body.facing)
        if (!cell) continue
        body.sprite.texture = cell.texture
        body.sprite.anchor.set(cell.anchor.x, cell.anchor.y)
        body.sprite.scale.set((cell.scale * 1.78 * WORLD_PX * Math.cos(CAMERA_ELEVATION)) / 52)
        const at = tileToScreen(body.at.x, body.at.z)
        body.sprite.position.set(at.sx, at.sy)
      }
      room.bedrolls.forEach((roll, index) => {
        roll.visible = occupants.some((a) => a.asleep && bodies.get(a.id)?.slot === index + 1)
      })
      const time = simTimeFromTick(state.tick),
        hour = time.hour + time.minute / 60
      const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI))
      const awake = occupants.some((a) => !a.asleep)
      const lit = (s.fueledUntilTick ?? 0) > state.tick
      ambient.intensity = 1.05 + daylight * 1.6 + (awake ? 0.55 : 0)
      ambient.color.setHex(daylight > 0.1 ? 0xffedd0 : 0xb4c2db)
      sun.intensity =
        0.7 +
        daylight *
          2.1 *
          (state.weather.kind === 'storm'
            ? 0.3
            : state.weather.kind === 'rain' || state.weather.kind === 'snow'
              ? 0.55
              : state.weather.kind === 'cloudy'
                ? 0.7
                : 1)
      sun.color.setHex(daylight > 0.1 ? 0xffe1ac : 0x9eb6dc)
      room.glass.emissiveIntensity = 0.25 + daylight * 0.5
      room.flames.visible = lit
      room.flames.children.forEach((flame, i) => {
        flame.scale.y = 1 + (moving ? Math.sin(seconds * 7 + i) * 0.13 : 0)
      })
      fire.position.copy(room.hearth).add(new Vector3(0, 0.7, 0.6))
      fire.intensity = lit ? 4.8 + (moving ? Math.sin(seconds * 6) * 0.22 : 0) : 0
      const stored = Object.values(state.items)
        .filter((i) => i.loc.t === 'structure' && i.loc.id === active)
        .sort((a, b) => a.id.localeCompare(b.id))
      const contents = stored.map((i) => i.id + ':' + i.kind).join('|')
      if (contents !== itemKey) {
        for (const child of [...room.stored.children]) disposeGroup(child)
        stored.slice(0, 18).forEach((item, i) => {
          const color = /wood|plank|stick/.test(item.kind)
            ? 0x9c774a
            : /stone|iron|ore/.test(item.kind)
              ? 0x7e8380
              : /berry|fruit|food|bread/.test(item.kind)
                ? 0xb77d57
                : 0xaeb69a
          const mesh = new Mesh(
            new BoxGeometry(0.19 + (i % 3) * 0.03, 0.18, 0.23),
            new MeshStandardMaterial({ color, roughness: 1 }),
          )
          mesh.position.set(
            room.storage.x - 0.49 + (i % 6) * 0.19,
            0.3 + Math.floor(i / 6) * 0.62,
            room.storage.z + 0.07,
          )
          mesh.castShadow = true
          room.stored.add(mesh)
        })
        itemKey = contents
      }
      people.sync(
        ids,
        (id) => bodies.get(id)?.sprite ?? null,
        Math.max(0.3, daylight),
        (id) => bodies.get(id)?.at.y ?? 0,
      )
      const width = view.app.screen.width,
        height = view.app.screen.height
      const top = (view.safeInsets?.top ?? 0) + 16,
        bottom = Math.max(view.safeInsets?.bottom ?? 0, 100)
      const available = Math.max(120, height - top - bottom)
      camera.position.set(16, 14, 16)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      const bounds = new Box3(
        new Vector3(-room.w / 2 - 0.35, -0.4, -room.d / 2 - 0.35),
        new Vector3(room.w / 2 + 0.35, 3.05, room.d / 2 + 0.35),
      )
      const projected = new Box3()
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            if (y === bounds.max.y && x === bounds.max.x && z === bounds.max.z) continue
            projected.expandByPoint(new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse))
          }
      const span =
        Math.max(
          projected.max.x - projected.min.x,
          ((projected.max.y - projected.min.y) * width) / available,
        ) * 1.035
      const cy = (projected.max.y + projected.min.y) / 2 + (((top - bottom) / 2) * span) / width
      camera.left = -span / 2
      camera.right = span / 2
      camera.top = cy + (span * height) / width / 2
      camera.bottom = cy - (span * height) / width / 2
      camera.updateProjectionMatrix()
      renderer.setRenderTarget(null)
      renderer.info.reset()
      renderer.render(stage, camera)
      return true
    },
    destroy() {
      destroyed = true
      off()
      view.app.stage.off('pointertap', pick)
      setActive(null)
      people.destroy()
      materials.destroy()
      sun.shadow.dispose()
      fire.shadow.dispose()
      listeners.clear()
    },
  }
}
