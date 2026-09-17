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
    // Allocate each shadow map once, even when its light starts dark.
    light.shadow.needsUpdate = light.castShadow
    light.shadow.mapSize.set(512, 512)
    light.shadow.radius = 3
    light.shadow.intensity = 0.6
    light.shadow.normalBias = 0.025
    light.shadow.bias = -0.0007
    light.shadow.camera.near = 0.15
    scene.add(light)
    return { light, id: '', strength: 0, power: 0 }
  })
  const streetLights = new Map<string, PointLight>()
  scene.background = new Color(0x99ac98)
  scene.fog = new FogExp2(0x99ac98, 0.0018)
  const warm = new Color(0xffc178)
  const day = new Color(0xffecd0)
  const moon = new Color(0x91b5ef)
  const daySky = new Color(0xc9e4ee)
  const nightSky = new Color(0x92acd2)
  const dayGround = new Color(0x596443)
  const nightGround = new Color(0x343840)
  const warmGround = new Color(0x74563e)
  const clearBackground = new Color(0x99ac98)
  const wetBackground = new Color(0x78868a)
  const daylightBackground = new Color()
  const background = new Color()
  let lightTick = -1
  let wetness = -1
  let fogDensity = 0.0008
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
      moving = true,
    ) {
      const seeking = lightTick < 0 || Math.abs(state.tick - lightTick) > 5 || !moving
      if (seeking) lightTick = state.tick
      else lightTick += (state.tick - lightTick) * (1 - Math.exp(-dt * 5))
      const token = skyToken(lightTick)
      const light = sunLight(lightTick)
      const wet = state.weather.kind === 'rain' || state.weather.kind === 'storm'
      const targetFog =
        state.weather.kind === 'storm'
          ? 0.0022
          : wet || state.weather.kind === 'snow'
            ? 0.0016
            : 0.0008
      const weatherBlend = seeking || wetness < 0 ? 1 : 1 - Math.exp(-dt / 3)
      wetness += ((wet ? 1 : 0) - wetness) * weatherBlend
      fogDensity += (targetFog - fogDensity) * weatherBlend
      const daylight = MathUtils.smoothstep(light.elevation, 0, 0.2)
      const golden = token.kind === 'sun' ? 1 - MathUtils.smoothstep(light.elevation, 0.25, 0.8) : 0
      const moonlight = moonAltitude(lightTick)
      sun.intensity =
        daylight * MathUtils.lerp(3.1 + golden * 0.7, 0.85, wetness) +
        moonlight * MathUtils.lerp(0.65, 0.35, wetness)
      sun.shadow.intensity = MathUtils.lerp(0.7, 0.35, wetness)
      sun.shadow.radius = MathUtils.lerp(2, 3, wetness)
      sun.color
        .copy(moon)
        .lerp(day, daylight)
        .lerp(warm, golden * daylight)
      sun.position.set(
        center.x - Math.cos(token.along * Math.PI) * 22,
        center.y + 4 + Math.sin(token.along * Math.PI) * 26,
        center.z - 12,
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
      sky.intensity = 0.28 + daylight * MathUtils.lerp(1.2 - golden * 0.15, 0.82, wetness)
      sky.color.copy(nightSky).lerp(daySky, daylight * (1 - wetness))
      sky.groundColor
        .copy(nightGround)
        .lerp(dayGround, daylight)
        .lerp(warmGround, golden * daylight)
      daylightBackground.copy(clearBackground).lerp(wetBackground, wetness)
      background.set(0x283649).lerp(daylightBackground, daylight)
      ;(scene.background as Color).copy(background)
      ;(scene.fog as FogExp2).color.copy(background)
      ;(scene.fog as FogExp2).density = fogDensity
      const flames = flamesAt(state, state.tick, config)
      const active = new Set(flames.map((f) => f.id))
      const lampIds = new Set<string>()
      for (const structure of Object.values(state.structures)) {
        if (structure.kind !== 'lamp_post' || structure.stage !== 'complete') continue
        lampIds.add(structure.id)
        let lamp = streetLights.get(structure.id)
        if (!lamp) {
          lamp = new PointLight(0xffb35a, 0, 8, 2)
          streetLights.set(structure.id, lamp)
          scene.add(lamp)
        }
        lamp.position.set(
          structure.x + structure.w / 2,
          heightOf(structure.id),
          structure.y + structure.h / 2,
        )
        const power = active.has(structure.id) ? 8 : 0
        lamp.intensity += (power - lamp.intensity) * (moving ? Math.min(1, dt * 4) : 1)
      }
      for (const [id, lamp] of streetLights) {
        if (lampIds.has(id)) continue
        scene.remove(lamp)
        lamp.dispose()
        streetLights.delete(id)
      }
      const nearby = flames
        .filter(
          (f) =>
            f.source !== 'structure' ||
            (!isRoofedKind(config, state.structures[f.id]?.kind ?? '') &&
              state.structures[f.id]?.kind !== 'lamp_post'),
        )
        .map((f) => ({
          f,
          distance: Math.hypot(f.x + f.w / 2 - center.x, f.y + f.h / 2 - center.z),
        }))
        .filter((f) => f.distance < span + 12)
        .sort((a, b) => a.distance - b.distance)
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
          slot.light.color.set(0xff832e)
          slot.power = 12
        }
        slot.light.intensity =
          slot.strength * slot.power * (0.96 + Math.sin(seconds * 7 + slot.light.id) * 0.04)
        slot.light.shadow.autoUpdate = slot.light.intensity > 0
      }
      return { active, wet, daylight, sun, sky }
    },
    destroy() {
      for (const lamp of streetLights.values()) {
        scene.remove(lamp)
        lamp.dispose()
      }
      streetLights.clear()
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
