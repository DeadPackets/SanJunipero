import { flamesAt, isRoofedKind, type SimConfig } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  PointLight,
  Scene,
  Vector3,
} from 'three'
import { moonAltitude, skyToken, sunLight } from '../../ui/skyModel.js'

export function createEnvironment(scene: Scene) {
  const sun = new DirectionalLight(0xffecd0, 3)
  const sky = new HemisphereLight(0xc9e4ee, 0x596443, 1.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.normalBias = 0.035
  sun.shadow.bias = -0.0002
  sun.shadow.radius = 2
  sun.shadow.intensity = 0.7
  sun.shadow.camera.near = 0.1
  sun.shadow.camera.far = 350
  scene.add(sun, sun.target, sky)
  const lights = Array.from({ length: 8 }, (_, i) => {
    const light = new PointLight(0xffb45e, 0, 9, 2)
    light.castShadow = i < 4
    light.shadow.mapSize.set(512, 512)
    light.shadow.radius = 3
    light.shadow.intensity = 0.6
    light.shadow.normalBias = 0.025
    light.shadow.bias = -0.0007
    light.shadow.camera.near = 0.15
    scene.add(light)
    return { light, id: '', strength: 0, power: 0 }
  })
  scene.background = new Color(0x99ac98)
  scene.fog = new FogExp2(0x99ac98, 0.0018)
  const warm = new Color(0xffc178)
  const day = new Color(0xffecd0)
  const moon = new Color(0x91b5ef)
  const background = new Color()
  return {
    flash(strength: number) {
      sky.intensity += strength
      sun.intensity += strength * 1.5
      sun.color.lerp(new Color(0xdce8ff), Math.min(1, strength))
      ;(scene.background as Color).lerp(new Color(0xb6c9e7), Math.min(0.35, strength * 0.12))
    },
    update(
      state: WorldState,
      config: SimConfig,
      center: Vector3,
      span: number,
      seconds: number,
      dt: number,
      heightOf: (id: string) => number,
    ) {
      const token = skyToken(state.tick)
      const light = sunLight(state.tick)
      const wet = state.weather.kind === 'rain' || state.weather.kind === 'storm'
      const daylight = token.kind === 'sun' ? Math.min(1, light.elevation * 5) : 0
      const golden = token.kind === 'sun' ? 1 - MathUtils.smoothstep(light.elevation, 0.25, 0.8) : 0
      const moonlight = moonAltitude(state.tick)
      sun.intensity = daylight * (wet ? 0.85 : 3.1 + golden * 0.7) + moonlight * (wet ? 0.35 : 0.65)
      sun.shadow.intensity = wet ? 0.35 : 0.7
      sun.shadow.radius = wet ? 3 : 2
      sun.color.copy(token.kind === 'sun' ? day : moon).lerp(warm, golden)
      sun.position.set(
        center.x - 14 + (token.kind === 'sun' ? token.along * 2 : -4),
        token.kind === 'sun' ? 20 - golden * 11 : 12 + moonlight * 12,
        center.z + (token.kind === 'sun' ? 8 + golden * 8 : -16),
      )
      sun.target.position.copy(center)
      const extent = Math.min(110, Math.max(18, span * 0.7))
      Object.assign(sun.shadow.camera, {
        left: -extent,
        right: extent,
        top: extent,
        bottom: -extent,
      })
      sun.shadow.camera.updateProjectionMatrix()
      sky.intensity = 0.28 + daylight * (wet ? 0.82 : 1.2 - golden * 0.15)
      sky.color.set(wet || token.kind === 'moon' ? 0x92acd2 : 0xc9e4ee)
      sky.groundColor.set(daylight > 0.5 ? 0x596443 : 0x343840).lerp(new Color(0x74563e), golden)
      background.set(0x283649).lerp(new Color(wet ? 0x78868a : 0x99ac98), daylight)
      ;(scene.background as Color).copy(background)
      ;(scene.fog as FogExp2).color.copy(background)
      ;(scene.fog as FogExp2).density =
        state.weather.kind === 'storm'
          ? 0.0022
          : wet || state.weather.kind === 'snow'
            ? 0.0016
            : 0.0008
      const flames = flamesAt(state, state.tick, config)
      const active = new Set(flames.map((f) => f.id))
      const nearby = flames
        .filter(
          (f) =>
            f.source !== 'structure' || !isRoofedKind(config, state.structures[f.id]?.kind ?? ''),
        )
        .map((f) => ({
          f,
          distance: Math.hypot(f.x + f.w / 2 - center.x, f.y + f.h / 2 - center.z),
          priority: state.structures[f.id]?.kind === 'lamp_post' ? 1 : 0,
        }))
        .filter((f) => f.distance < span + 12)
        .sort((a, b) => a.priority - b.priority || a.distance - b.distance)
        .slice(0, lights.length)
      const wanted = new Map(nearby.map(({ f }) => [f.id, f]))
      const assigned = new Set(lights.map((l) => l.id))
      for (const slot of lights) {
        if (!wanted.has(slot.id) && slot.strength < 0.02) {
          const next = nearby.find(({ f }) => !assigned.has(f.id))?.f
          if (next) {
            assigned.delete(slot.id)
            slot.id = next.id
            assigned.add(next.id)
          }
        }
        const f = wanted.get(slot.id)
        slot.strength += ((f ? 1 : 0) - slot.strength) * Math.min(1, dt * 4)
        if (f) {
          slot.light.position.set(f.x + f.w / 2, heightOf(f.id), f.y + f.h / 2)
          slot.light.distance = Math.min(8, f.radius * 2)
          slot.light.color.set(state.structures[f.id]?.kind === 'lamp_post' ? 0xffb35a : 0xff832e)
          slot.power = state.structures[f.id]?.kind === 'lamp_post' ? 8 : 12
        }
        slot.light.intensity =
          slot.strength * slot.power * (0.96 + Math.sin(seconds * 7 + slot.light.id) * 0.04)
      }
      return { active, wet, daylight }
    },
    destroy() {
      sun.shadow.map?.dispose()
      sun.dispose()
      scene.remove(sun, sun.target, sky, ...lights.map((l) => l.light))
      for (const { light } of lights) {
        light.shadow.map?.dispose()
        light.dispose()
      }
    },
  }
}
