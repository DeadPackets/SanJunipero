import { createThreeInterior } from './interior.js'
import { createOrchardGardens } from './orchard.js'
import { effectiveConfig } from '@sj/engine/laws'
import { DEFAULT_CONFIG, isRoofedKind } from '@sj/shared'
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
  WebGLRenderTarget,
  Material,
  Vector3,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js'
import type { WorldStore } from '../../state/worldStore.js'
import type { Scene } from '../scene.js'
import { entersOnClick, type WorldPick } from '../entities.js'
import { rendersOnMap, type CharacterLayer } from '../characters.js'
import { buildStructure, structureKey } from './structures.js'
import { createTerrain } from './terrain.js'
import { createOcclusionFader } from './occlusion.js'
import { createEnvironment } from './environment.js'
import { createNightBackdrop } from './nightBackdrop.js'
import { createPeople } from './people.js'
import { createThreeWeather } from './weather.js'
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
  const interior = createThreeInterior(view, store, renderer, callbacks.select)
  const scene = new ThreeScene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  const terrain = createTerrain(scene)
  const gardens = createOrchardGardens(scene)
  const environment = createEnvironment(scene)
  const nightBackdrop = createNightBackdrop(scene)
  const weather = createThreeWeather(scene, view)
  const people = createPeople(scene)
  const resources = createResources(scene)
  const library = createMaterialLibrary()
  const fader = createOcclusionFader(camera)
  const structures = new Map<string, { key: string; group: Group }>()
  const awakeBuildings = new Set<string>()
  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.08, 0.5, 1.6)
  const output = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(bloom)
  const backdropBlur = [6, 12].map((radius) => {
    const horizontal = new ShaderPass(HorizontalBlurShader)
    const vertical = new ShaderPass(VerticalBlurShader)
    composer.addPass(horizontal)
    composer.addPass(vertical)
    return { radius, horizontal, vertical }
  })
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
  view.capturePlace = (id) => {
    const structure = store.getState()?.structures[id]
    if (destroyed || !structure || !structures.has(id)) return null
    const w = 480
    const h = 300
    const target = new WebGLRenderTarget(w, h, { colorSpace: SRGBColorSpace })
    const previous = renderer.getRenderTarget()
    const span = Math.max(5.2, Math.max(structure.w, structure.h) * 1.9)
    const photoCamera = new OrthographicCamera(
      (-span * w) / h / 2,
      (span * w) / h / 2,
      span / 2,
      -span / 2,
      0.1,
      1000,
    )
    const center = new Vector3(structure.x + structure.w / 2, 0.65, structure.y + structure.h / 2)
    photoCamera.position.set(center.x + 120, center.y + 120 * Math.sqrt(2 / 3), center.z + 120)
    photoCamera.lookAt(center)
    photoCamera.updateProjectionMatrix()
    const buffer = new Uint8Array(w * h * 4)
    const faded = new Map<Material, number>()
    for (const entry of structures.values())
      entry.group.traverse((object) => {
        if (!(object instanceof Mesh)) return
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (!material.userData.solidOccluder || faded.has(material)) continue
          faded.set(material, material.opacity)
          material.opacity = 1
        }
      })
    try {
      renderer.setRenderTarget(target)
      renderer.render(scene, photoCamera)
      renderer.readRenderTargetPixels(target, 0, 0, w, h, buffer)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const context = canvas.getContext('2d')
      if (!context) return null
      const pixels = context.createImageData(w, h)
      for (let row = 0; row < h; row++)
        pixels.data.set(buffer.subarray(row * w * 4, (row + 1) * w * 4), (h - row - 1) * w * 4)
      context.putImageData(pixels, 0, 0)
      return canvas.toDataURL('image/webp', 0.88)
    } finally {
      for (const [material, opacity] of faded) material.opacity = opacity
      renderer.setRenderTarget(previous)
      target.dispose()
    }
  }
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
      entersOnClick(
        effectiveConfig(store.getConfig() ?? DEFAULT_CONFIG, store.getState()?.laws),
        store.getState(),
        chosen.id,
      )
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
    weather: weather.controls,
    interior,
    tick(dtMs: number) {
      if (destroyed) return
      const state = store.getState()
      if (!state) return
      const config = effectiveConfig(store.getConfig() ?? DEFAULT_CONFIG, state.laws)
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
        awakeBuildings.clear()
        for (const agent of Object.values(state.agents))
          if (agent.alive && !agent.asleep && agent.insideId) awakeBuildings.add(agent.insideId)
        const records = store.assetRecords()
        const changedArt = artSeq !== store.assetsSeq()
        artSeq = store.assetsSeq()
        terrain.sync(state, records)
        gardens.sync(state)
        resources.sync(state, records)
        for (const [id, entry] of structures)
          if (!state.structures[id]) {
            disposeGroup(entry.group)
            structures.delete(id)
          }
        for (const s of Object.values(state.structures)) {
          const key = structureKey(s, config)
          let entry = structures.get(s.id)
          if (entry?.key !== key) {
            if (entry) disposeGroup(entry.group)
            const group = buildStructure(s, config)
            scene.add(group)
            entry = { key, group }
            structures.set(s.id, entry)
            void library.apply(group, s.kind, records)
          } else if (changedArt) void library.apply(entry.group, s.kind, records)
        }
        weather.sync([...structures.values()].map((e) => e.group))
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
      const climate = environment.update(
        state,
        config,
        center,
        span,
        seconds,
        dt,
        (id) => Number(structures.get(id)?.group.userData.lightHeight ?? 0.85),
        view.wantsMotion() && store.timeMoving() && !store.getPaused(),
      )
      for (const [id, entry] of structures) {
        const lit = climate.active.has(id)
        const kind = state.structures[id]?.kind ?? ''
        const roofed = isRoofedKind(config, kind)
        const windowsLit = roofed ? awakeBuildings.has(id) : lit
        const windows = entry.group.userData.windows as MeshStandardMaterial[] | undefined
        const windowIntensity = windowsLit
          ? kind === 'lamp_post'
            ? 1.4
            : 0.45 + (1 - climate.daylight) * 1.8
          : 0
        for (const material of windows ?? [])
          material.emissiveIntensity +=
            (windowIntensity - material.emissiveIntensity) *
            (roofed && view.wantsMotion() ? Math.min(1, dt * 6) : 1)
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
        climate.daylight,
      )
      const flash = weather.update(state, center, span, dt)
      nightBackdrop.update(
        state.tick,
        climate.daylight,
        state.weather.kind,
        dt,
        view.wantsMotion() && store.timeMoving() && !store.getPaused(),
        width / height,
      )
      environment.flash(flash)
      scene.updateMatrixWorld()
      const faded = fader.update(targets, dt)
      renderer.domElement.style.opacity = String(view.app.stage.alpha)
      renderer.info.reset()
      for (const { radius, horizontal, vertical } of backdropBlur) {
        horizontal.enabled = vertical.enabled = interior.isActive()
        horizontal.uniforms.h!.value = radius / width
        vertical.uniforms.v!.value = radius / height
      }
      composer.render()
      const indoors = interior.render(dt, climate)
      root.dataset.renderer = indoors ? 'three-interior' : 'three'
      root.dataset.structures = String(structures.size)
      root.dataset.faded = String(faded)
      root.dataset.drawCalls = String(renderer.info.render.calls)
      store.setDressed()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      interior.destroy()
      delete view.capturePlace
      off()
      view.app.stage.off('pointertap', pick)
      view.app.stage.off('pointermove', hover)
      view.app.canvas.removeEventListener('pointerleave', leave)
      fader.destroy()
      people.destroy()
      resources.destroy()
      terrain.destroy()
      gardens.destroy()
      environment.destroy()
      nightBackdrop.destroy()
      weather.destroy()
      for (const entry of structures.values()) disposeGroup(entry.group)
      structures.clear()
      library.destroy()
      bloom.dispose()
      for (const { horizontal, vertical } of backdropBlur) {
        horizontal.dispose()
        vertical.dispose()
      }
      output.dispose()
      renderPass.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      delete root.dataset.renderer
    },
  }
}
