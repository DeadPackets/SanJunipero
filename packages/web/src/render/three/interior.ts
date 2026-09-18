import { createMaterialLibrary } from './materials.js'
import { DEFAULT_CONFIG, isRoofedKind } from '@sj/shared'
import { effectiveConfig } from '@sj/engine/laws'
import type { AgentBody } from '@sj/engine/state'
import { Sprite, type FederatedPointerEvent } from 'pixi.js'
import {
  Box3,
  BoxGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  MeshBasicMaterial,
  PlaneGeometry,
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
): InteriorScene & {
  render(
    dt: number,
    light: { sun: DirectionalLight; sky: HemisphereLight; daylight: number },
  ): boolean
} {
  const stage = new ThreeScene()
  const backdrop = new ThreeScene()
  const backdropCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const veil = new Mesh(
    new PlaneGeometry(2, 2),
    new MeshBasicMaterial({
      color: 0x15221d,
      transparent: true,
      opacity: 0.48,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  backdrop.add(veil)
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
  const lamps = [0, 1].map((i) => {
    const lamp = new PointLight(0xffce8e, 0, 14, 1.5)
    lamp.castShadow = i === 0
    lamp.shadow.mapSize.set(512, 512)
    lamp.shadow.normalBias = 0.035
    lamp.shadow.bias = -0.001
    lamp.shadow.radius = 3
    lamp.shadow.intensity = 0.55
    return lamp
  })
  let lampLevel = 0
  stage.add(ambient, sun, sun.target, fire, ...lamps)
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
      (s?.stage !== 'complete' || !isRoofedKind(store.getConfig() ?? DEFAULT_CONFIG, s.kind))
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
    if (hit) select((hit.object.userData.pick as { kind: 'agent'; id: string }).id)
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
        if (map.blocked[key]) continue
        let occupied = false
        for (const taken of used) {
          const dx = x - (taken % map.w),
            dy = y - Math.floor(taken / map.w)
          if (dx * dx + dy * dy < 4) {
            occupied = true
            break
          }
        }
        if (occupied) continue
        const p = point(x, y),
          delta = p.distanceToSquared(v)
        if (delta < dist) {
          dist = delta
          best = p
        }
      }
    return best ?? v.clone()
  }
  const destination = (
    a: AgentBody,
    slot: number,
    occupants: AgentBody[],
    beside = true,
  ): Vector3 => {
    const room = model!
    if (a.asleep && room.beds.length) return room.beds[slot % room.beds.length]!.clone()
    const verb = a.activity?.verb ?? ''
    if (verb === 'exit') return room.entry.clone()
    if (verb === 'stoke' || verb === 'cook') return room.hearth.clone().add(new Vector3(0, 0, 1.35))
    if (verb === 'stow' || verb === 'take') return room.storage.clone().add(new Vector3(0, 0, 1))
    if (verb === 'craft' || verb === 'eat') return room.table.clone().add(new Vector3(1.2, 0, 0))
    const chosen = a.indoorDestination
    if (chosen?.kind === 'bed' && room.beds.length)
      return room.beds[slot % Math.max(1, room.beds.length - room.bedrolls.length)]!.clone()
        .setY(0)
        .add(new Vector3(1, 0, 0))
    if (chosen?.kind === 'hearth') return room.hearth.clone().add(new Vector3(0, 0, 1.35))
    if (chosen?.kind === 'storage') return room.storage.clone().add(new Vector3(0, 0, 1))
    if (chosen?.kind === 'table') return room.table.clone().add(new Vector3(1.2, 0, 0))
    if (beside && chosen?.kind === 'beside') {
      const other = occupants.find((person) => person.id === chosen.targetId)
      if (other) {
        const otherSlot = bodies.get(other.id)?.slot ?? occupants.indexOf(other)
        return destination(other, otherSlot, occupants, false)
          .setY(0)
          .add(new Vector3(0.8, 0, 0.8))
      }
    }
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
    speechAnchor(id) {
      const body = bodies.get(id)
      if (active === null || !body) return null
      const head = body.at
        .clone()
        .add(new Vector3(0, 1.9, 0))
        .project(camera)
      const feet = body.at.clone().project(camera)
      return {
        x: ((head.x + 1) * view.app.screen.width) / 2,
        y: ((1 - head.y) * view.app.screen.height) / 2,
        footY: ((1 - feet.y) * view.app.screen.height) / 2,
      }
    },
    onChange(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    render(dt, light) {
      if (active === null || destroyed) return false
      const state = store.getState(),
        s = state?.structures[active]
      if (!state || s?.stage !== 'complete') {
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
          const desired = destination(a, slot, occupants),
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
        const wanted = destination(a, body.slot, occupants),
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
        let remaining = moving ? dt * 1.6 : 0
        while (body.path.length && remaining > 0.000001) {
          const next = body.path[0]!
          const delta = next.clone().sub(body.at),
            length = delta.length()
          if (length < 0.000001) {
            body.at.copy(next)
            body.path.shift()
            continue
          }
          const distance = Math.min(length, remaining)
          body.at.addScaledVector(delta, distance / length)
          body.facing = facingFrom(delta.x, delta.z) ?? body.facing
          walking = true
          body.phase += (distance / 1.6) * 5.5
          remaining -= distance
          if (distance === length) {
            body.at.copy(next)
            body.path.shift()
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
      const { daylight } = light
      const awake = occupants.some((a) => !a.asleep)
      const lit = (s.fueledUntilTick ?? 0) > state.tick
      const lampTarget = awake ? 1 : 0
      lampLevel =
        fresh || !view.wantsMotion() || !moving
          ? lampTarget
          : lampLevel + (lampTarget - lampLevel) * (1 - Math.exp(-dt * 5))
      room.lampGlass.emissiveIntensity = lampLevel * 0.8
      lamps.forEach((lamp, i) => {
        lamp.position.copy(room.lampPositions[i]!)
        lamp.intensity = lampLevel * (9 - daylight * 4)
        lamp.castShadow = i === 0 && lampLevel > 0.01
      })
      ambient.intensity = 0.38 + light.sky.intensity * 0.85 + (awake ? 0.35 : 0)
      ambient.color.copy(light.sky.color)
      ambient.groundColor.copy(light.sky.groundColor)
      sun.position
        .copy(light.sun.position)
        .sub(light.sun.target.position)
        .normalize()
        .multiplyScalar(18)
      sun.target.position.set(0, 0, 0)
      sun.color.copy(light.sun.color)
      sun.intensity = light.sun.intensity
      sun.shadow.intensity = light.sun.shadow.intensity
      sun.shadow.radius = light.sun.shadow.radius + 1
      room.glass.color.copy(light.sky.color)
      room.glass.emissive.copy(light.sun.color)
      room.glass.emissiveIntensity = daylight * 0.3
      room.flames.visible = lit
      fire.castShadow = lit
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
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(backdrop, backdropCamera)
      renderer.clearDepth()
      renderer.render(stage, camera)
      renderer.autoClear = autoClear
      return true
    },
    destroy() {
      destroyed = true
      off()
      view.app.stage.off('pointertap', pick)
      setActive(null)
      people.destroy()
      materials.destroy()
      disposeGroup(veil)
      sun.shadow.dispose()
      fire.shadow.dispose()
      for (const lamp of lamps) lamp.shadow.dispose()
      listeners.clear()
    },
  }
}
