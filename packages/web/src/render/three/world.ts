import { DEFAULT_CONFIG } from '@sj/shared'
import type { FederatedPointerEvent } from 'pixi.js'
import {
  ACESFilmicToneMapping,
  Box3,
  ConeGeometry,
  Mesh,
  Group,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  Raycaster,
  Scene as ThreeScene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { WorldStore } from '../../state/worldStore.js'
import type { Scene } from '../scene.js'
import { entersOnClick, type WorldPick } from '../entities.js'
import { rendersOnMap, type CharacterLayer } from '../characters.js'
import { buildStructure } from './structures.js'
import { createTerrain } from './terrain.js'
import { createOcclusionFader } from './occlusion.js'
import { createEnvironment } from './environment.js'
import { createPeople } from './people.js'
import { createResources } from './resources.js'
import { createMaterialLibrary } from './materials.js'
import { disposeGroup } from './dispose.js'
import { hoverPlate } from '../../ui/interaction.js'
import { anchorForSprite } from '../tooltip.js'
import { syncCamera, WORLD_PX } from './projection.js'

export function createThreeWorld(
  root: HTMLElement,
  view: Scene,
  store: WorldStore,
  chars: CharacterLayer,
  callbacks: {
    select(id: string): void
    door(id: string): void
    pick(pick: WorldPick): void
    ground(): void
  },
) {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.info.autoReset = false
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.domElement.className = 'town-three-canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  Object.assign(renderer.domElement.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  })
  root.prepend(renderer.domElement)
  view.app.canvas.style.position = 'relative'
  const scene = new ThreeScene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  const terrain = createTerrain(scene)
  const environment = createEnvironment(scene)
  const people = createPeople(scene)
  const resources = createResources(scene)
  const library = createMaterialLibrary()
  const fader = createOcclusionFader(camera)
  const structures = new Map<string, { key: string; group: Group }>()
  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.24, 0.6, 1.05)
  const output = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(bloom)
  composer.addPass(output)
  let dirty = true
  let artSeq = -1
  let width = 0
  let height = 0
  let seconds = 0
  let destroyed = false
  const off = store.subscribe(() => {
    dirty = true
  })
  const ray = new Raycaster()
  const hitAt = (
    x: number,
    y: number,
  ): { kind: 'agent' | WorldPick['kind']; id: string } | null => {
    ray.setFromCamera(new Vector2((x / width) * 2 - 1, 1 - (y / height) * 2), camera)
    const hits = ray.intersectObjects(
      [
        ...people.pickables(),
        ...[...structures.values()].map((s) => s.group),
        ...resources.pickables(),
      ],
      true,
    )
    for (const hit of hits) {
      let object: Object3D | null = hit.object
      let visible = true
      for (let p: Object3D | null = object; p; p = p.parent) if (!p.visible) visible = false
      if (!visible) continue
      while (object && !object.userData.pick) object = object.parent
      if (object) return object.userData.pick as { kind: 'agent' | WorldPick['kind']; id: string }
    }
    return null
  }
  const pick = (event: FederatedPointerEvent) => {
    if (event.target !== view.app.stage || view.wasDrag() || view.interior?.isActive()) return
    const chosen = hitAt(event.global.x, event.global.y)
    if (!chosen) callbacks.ground()
    else if (chosen.kind === 'agent') callbacks.select(chosen.id)
    else if (
      chosen.kind === 'structure' &&
      entersOnClick(store.getConfig(), store.getState(), chosen.id)
    )
      callbacks.door(chosen.id)
    else
      callbacks.pick({
        kind: chosen.kind,
        id: chosen.id,
        screenX: event.client.x,
        screenY: event.client.y,
      })
  }
  const hover = (event: FederatedPointerEvent) => {
    if (event.target !== view.app.stage || event.buttons !== 0 || view.interior?.isActive()) return
    const chosen = hitAt(event.global.x, event.global.y)
    view.app.canvas.style.cursor = chosen ? 'pointer' : 'grab'
    if (!chosen) {
      view.tags.hide('hover')
      return
    }
    const at =
      chosen.kind === 'agent' || chosen.kind === 'structure'
        ? view.pointOf(chosen.kind, chosen.id)
        : null
    const x = at?.sx ?? (event.global.x - view.world.x) / view.getZoom()
    const y = at?.sy ?? (event.global.y - view.world.y) / view.getZoom()
    view.tags.show(
      'hover',
      hoverPlate(store.getState(), chosen.kind, chosen.id, view.pickedId === chosen.id),
      anchorForSprite({ x, y }, { width: 32, height: 45 }),
    )
  }
  const leave = () => {
    view.tags.hide('hover')
  }
  view.app.stage.on('pointermove', hover)
  view.app.canvas.addEventListener('pointerleave', leave)
  view.app.stage.on('pointertap', pick)
  return {
    tick(dtMs: number) {
      if (destroyed) return
      const state = store.getState()
      if (!state) return
      const config = store.getConfig() ?? DEFAULT_CONFIG
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000))
      if (view.wantsMotion() && store.timeMoving() && !store.getPaused()) seconds += dt
      const w = view.app.screen.width,
        h = view.app.screen.height
      if (w < 1 || h < 1) return
      if (w !== width || h !== height) {
        width = w
        height = h
        renderer.setSize(w, h, false)
        composer.setSize(w, h)
      }
      if (dirty) {
        dirty = false
        const records = store.assetRecords()
        const changedArt = artSeq !== store.assetsSeq()
        artSeq = store.assetsSeq()
        terrain.sync(state, records)
        resources.sync(state, records)
        for (const [id, entry] of structures)
          if (!state.structures[id]) {
            disposeGroup(entry.group)
            structures.delete(id)
          }
        for (const s of Object.values(state.structures)) {
          const key = `${s.kind}:${s.x}:${s.y}:${s.w}:${s.h}:${s.facing}:${s.stage}:${Math.floor(s.progressTicks / 120)}`
          let entry = structures.get(s.id)
          if (entry?.key !== key) {
            if (entry) disposeGroup(entry.group)
            const group = buildStructure(s, config)
            scene.add(group)
            entry = { key, group }
            structures.set(s.id, entry)
            library.apply(group, s.kind, records)
          } else if (changedArt) library.apply(entry.group, s.kind, records)
        }
        fader.sync([...structures.values()].map((e) => e.group).concat(terrain.occluders()))
      }
      fader.sync([...structures.values()].map((e) => e.group).concat(terrain.occluders()))
      const center = syncCamera(
        camera,
        width,
        height,
        view.world.x,
        view.world.y,
        view.world.scale.x,
      )
      const span = Math.max(width, height) / (WORLD_PX * view.world.scale.x)
      const climate = environment.update(state, config, center, span, seconds, dt, (id) =>
        Number(structures.get(id)?.group.userData.lightHeight ?? 0.85),
      )
      for (const [id, entry] of structures) {
        const lit = climate.active.has(id)
        const windows = entry.group.userData.windows as MeshStandardMaterial[] | undefined
        for (const material of windows ?? [])
          material.emissiveIntensity = lit
            ? state.structures[id]?.kind === 'lamp_post'
              ? 4
              : 0.45 + (1 - climate.daylight) * 1.8
            : 0
        if (state.structures[id]?.burning && !entry.group.userData.fire) {
          const fire = new Group()
          entry.group.updateWorldMatrix(true, true)
          const height = new Box3().setFromObject(entry.group).max.y
          const structure = state.structures[id]
          fire.position.set(structure.w / 2, Math.max(0.2, height - 0.55), structure.h / 2)
          for (let i = 0; i < 5; i++) {
            const flame = new Mesh(
              new ConeGeometry(0.16, 0.65 + i * 0.1, 5),
              new MeshStandardMaterial({
                color: 0xffbb66,
                emissive: 0xff8822,
                emissiveIntensity: 1.8,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
              }),
            )
            flame.position.set(Math.sin(i * 2.4) * 0.25, 0.3, Math.cos(i * 2.4) * 0.25)
            fire.add(flame)
          }
          entry.group.add(fire)
          entry.group.userData.fire = fire
        }
        const fire = entry.group.userData.fire as Group | undefined
        if (fire) {
          fire.visible = lit || state.structures[id]?.burning === true
          fire.scale.y = 0.95 + Math.sin(seconds * 8 + entry.group.id) * 0.09
          fire.children.forEach((part, i) => {
            if (part.name === 'ember') {
              const rise = (seconds * 0.45 + i * 0.173) % 1
              part.position.set(
                Math.sin(i * 2.4) * 0.18 + rise * 0.12,
                0.3 + rise * 1.5,
                Math.cos(i * 2.4) * 0.18,
              )
              part.scale.setScalar(1 - rise)
            } else if (part.name === 'smoke') {
              const rise = (seconds * 0.15 + i / 6) % 1
              part.position.set(rise * 0.35, 0.7 + rise * 2.1, rise * 0.14)
              part.scale.setScalar(0.12 + rise * 0.3)
              ;((part as Mesh).material as MeshStandardMaterial).opacity =
                0.07 * Math.sin(rise * Math.PI)
            } else if (typeof part.userData.flameHeight === 'number') {
              part.scale.y = part.userData.flameHeight * (1 + Math.sin(seconds * 9 + i) * 0.2)
              part.position.y = 0.4 + Math.sin(seconds * 7 + i) * 0.045
            }
          })
        }
      }
      terrain.tick(seconds, climate.wet, view.wantsMotion())
      const targets = people.sync(
        Object.values(state.agents)
          .filter(rendersOnMap)
          .map((a) => a.id),
        (id) => chars.getSprite(id),
      )
      scene.updateMatrixWorld()
      const faded = fader.update(targets, dt)
      renderer.domElement.style.opacity = String(view.app.stage.alpha)
      renderer.info.reset()
      composer.render()
      root.dataset.renderer = 'three'
      root.dataset.structures = String(structures.size)
      root.dataset.faded = String(faded)
      root.dataset.drawCalls = String(renderer.info.render.calls)
      store.setDressed()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      off()
      view.app.stage.off('pointertap', pick)
      view.app.stage.off('pointermove', hover)
      view.app.canvas.removeEventListener('pointerleave', leave)
      fader.destroy()
      people.destroy()
      resources.destroy()
      terrain.destroy()
      environment.destroy()
      for (const entry of structures.values()) disposeGroup(entry.group)
      structures.clear()
      library.destroy()
      bloom.dispose()
      output.dispose()
      renderPass.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      delete root.dataset.renderer
    },
  }
}
