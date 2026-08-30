import { Container, Sprite, Texture } from 'pixi.js'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { screenToTile } from './iso.js'
import { bakeTexture } from './textures.js'
import type { Scene } from './scene.js'
import type { ViewRect } from './cull.js'

/** Density, not count: 220 drops on a 1440×900 stage was 4× thinner on a 3840×2160 one. */
export const PARTICLES = {
  rain: { perMpx: 170, vy: 380, vx: -60, len: 6, color: 0x7fb0c9 },
  snow: { perMpx: 108, vy: 40, vx: -12, len: 2, color: 0xfff6e9 },
  storm: { perMpx: 247, vy: 480, vx: -110, len: 8, color: 0x5a8cab },
} as const
export type ParticleKind = keyof typeof PARTICLES

/** Three depths: far drops are small, faint and slow; near ones long, bright and fast. */
export const BANDS: readonly { scale: number; alpha: number; speed: number }[] = [
  { scale: 0.6, alpha: 0.35, speed: 0.7 },
  { scale: 1, alpha: 0.6, speed: 1 },
  { scale: 1.4, alpha: 0.85, speed: 1.4 },
]
const SNOW_WOBBLE_PX_S = 42 // a flake falls in a sway, never dead straight

/** The count a stage of `w`×`h` CSS px gets, halved when the viewer asked for less motion. */
export function particleCount(kind: ParticleKind, w: number, h: number, still: boolean): number {
  const n = Math.round((PARTICLES[kind].perMpx * w * h) / 1e6)
  return still ? Math.round(n / 2) : n
}

/** One strike: 0 → 0.45 → 0 over 130 ms and a fainter second flash in the 60 ms after it,
 *  under the night quad — so a 2 a.m. strike lights a night and not a noon. */
export const FLASH_MS = 190
export const FLASH_PEAK_ALPHA = 0.45
const FLASH_COLOR = 0xf4e289
const FLASH_MIN_GAP_S = 6
const FLASH_MAX_GAP_S = 14
export function flashAlpha(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= FLASH_MS) return 0
  const p = elapsedMs / FLASH_MS
  const main = Math.sin(Math.PI * Math.min(1, p / 0.68)) * FLASH_PEAK_ALPHA
  const second = p > 0.72 ? Math.sin(Math.PI * ((p - 0.72) / 0.28)) * 0.22 : 0
  return Math.max(main, second)
}

/** Rain that lands: pooled sprites on the ground decal layer, in WORLD space, each a 180 ms
 *  two-frame pop at a random visible ground point, or a widening ring on water. */
export const SPLASH_COUNT = 40
export const SPLASH_MS = 180
const WATER: TileId = 2

export type WeatherLayer = {
  setKind(kind: string): void
  setSuppressed(v: boolean): void
  tick(dtMs: number): void
  destroy(): void
}

type Drop = { sprite: Sprite; x: number; y: number; band: number; wobble: number }
type Splash = { sprite: Sprite; ageMs: number; water: boolean }

export function createWeatherLayer(scene: Scene, store: WorldStore): WeatherLayer {
  const layer = scene.screen.weather
  const flash = new Sprite(Texture.WHITE)
  flash.tint = FLASH_COLOR
  flash.blendMode = 'add'
  flash.visible = false
  flash.eventMode = 'none'
  scene.screen.flash.addChild(flash)
  const ground = new Container()
  ground.eventMode = 'none'
  scene.layers.groundDecal.addChild(ground)
  const still = !scene.wantsMotion()

  let kind: ParticleKind | null = null
  let suppressed = false
  const drops: Drop[] = []
  const splashes: Splash[] = []
  let flashAtMs = -1
  let nextFlashMs = 0
  let t = 0
  const streaks = new Map<string, Texture>()

  // the two frames of a splash, and the ring a drop leaves on water
  const splashTex = [
    bakeTexture(scene, (g) => g.rect(0, 0, 3, 2).fill(0xcfe3ee)),
    bakeTexture(scene, (g) => g.rect(0, 0, 5, 1).fill(0xcfe3ee)),
  ]
  const ringTex = bakeTexture(scene, (g) =>
    g.ellipse(4, 2, 3.5, 1.5).stroke({ width: 1, color: 0xfff6e9 }),
  )

  const streakTexture = (k: ParticleKind, band: number): Texture => {
    const key = `${k}:${band}`
    let hit = streaks.get(key)
    if (hit === undefined) {
      const spec = PARTICLES[k]
      const s = BANDS[band]!.scale
      hit = bakeTexture(scene, (g) =>
        g
          .moveTo(0, 0)
          .lineTo((spec.vx / 60) * s, spec.len * s)
          .stroke({ width: Math.max(1, Math.round((k === 'snow' ? 2 : 1) * s)), color: 0xffffff }),
      )
      streaks.set(key, hit)
    }
    return hit
  }

  // viewer-side Math.random is FINE here: presentation only, never simulation
  const rollFlashGap = (): number =>
    (FLASH_MIN_GAP_S + Math.random() * (FLASH_MAX_GAP_S - FLASH_MIN_GAP_S)) * 1000

  /** Grow or shrink the pool to the stage's count and dress every drop for the kind. */
  const dress = (): void => {
    const w = scene.app.screen.width
    const h = scene.app.screen.height
    const want = kind === null || suppressed ? 0 : particleCount(kind, w, h, still)
    while (drops.length < want) {
      const sprite = new Sprite()
      sprite.eventMode = 'none'
      sprite.autoGarbageCollect = false
      layer.addChild(sprite)
      drops.push({
        sprite,
        x: Math.random() * w,
        y: Math.random() * h,
        band: drops.length % BANDS.length,
        wobble: Math.random() * Math.PI * 2,
      })
    }
    for (let i = drops.length - 1; i >= want; i--) drops.pop()!.sprite.destroy()
    if (kind === null) return
    for (const d of drops) {
      d.sprite.texture = streakTexture(kind, d.band)
      d.sprite.tint = PARTICLES[kind].color
      d.sprite.alpha = BANDS[d.band]!.alpha
      d.sprite.position.set(Math.round(d.x), Math.round(d.y))
    }
    if (kind === 'storm') nextFlashMs = rollFlashGap()
  }

  const wet = (): boolean => kind === 'rain' || kind === 'storm'

  /** A splash lands where the camera can see ground; off the map it waits a cycle, hidden. */
  const respawn = (s: Splash, view: ViewRect, terrain: TileId[][] | undefined): void => {
    const sx = view.x + Math.random() * view.w
    const sy = view.y + Math.random() * view.h
    const tile = screenToTile(sx, sy)
    const id = terrain?.[tile.y]?.[tile.x]
    s.ageMs = 0
    s.sprite.visible = id !== undefined
    if (id === undefined) return
    s.water = id === WATER
    s.sprite.position.set(Math.round(sx), Math.round(sy))
  }

  const dressSplashes = (): void => {
    const want = wet() && !suppressed && !still ? SPLASH_COUNT : 0
    const view = scene.viewRect()
    const terrain = store.getState()?.terrain
    while (splashes.length < want) {
      const sprite = new Sprite(splashTex[0])
      sprite.anchor.set(0.5, 0.5)
      sprite.eventMode = 'none'
      sprite.autoGarbageCollect = false
      ground.addChild(sprite)
      const s = { sprite, ageMs: 0, water: false }
      respawn(s, view, terrain)
      s.ageMs = Math.random() * SPLASH_MS // staggered, so the first frame is not forty pops
      splashes.push(s)
    }
    for (let i = splashes.length - 1; i >= want; i--) splashes.pop()!.sprite.destroy()
  }

  return {
    setKind(k) {
      const next = k in PARTICLES ? (k as ParticleKind) : null
      if (next === kind) return
      kind = next
      dress()
      dressSplashes()
    },
    setSuppressed(v) {
      if (v === suppressed) return
      suppressed = v
      flash.visible = false
      flashAtMs = -1
      dress()
      dressSplashes()
    },
    tick(dtMs) {
      if (kind === null || suppressed || still) return
      t += dtMs
      const spec = PARTICLES[kind]
      const w = scene.app.screen.width
      const h = scene.app.screen.height
      const dt = dtMs / 1000
      for (const d of drops) {
        const band = BANDS[d.band]!
        d.x += spec.vx * band.speed * dt
        d.y += spec.vy * band.speed * dt
        if (kind === 'snow') d.x += Math.sin(t / 500 + d.wobble) * SNOW_WOBBLE_PX_S * dt
        if (d.y > h) {
          d.y -= h + spec.len
          d.x = Math.random() * w
        }
        if (d.x < 0) d.x += w
        if (d.x > w) d.x -= w
        // on the pixel grid: a streak at a fractional position is a soft one
        d.sprite.position.set(Math.round(d.x), Math.round(d.y))
      }
      const view = scene.viewRect()
      const terrain = store.getState()?.terrain
      for (const s of splashes) {
        s.ageMs += dtMs
        if (s.ageMs >= SPLASH_MS) {
          respawn(s, view, terrain)
          continue
        }
        const p = s.ageMs / SPLASH_MS
        if (s.water) {
          s.sprite.texture = ringTex
          s.sprite.scale.set(1 + p * 2)
          s.sprite.alpha = 0.55 * (1 - p)
        } else {
          s.sprite.texture = splashTex[p < 0.5 ? 0 : 1]!
          s.sprite.scale.set(1)
          s.sprite.alpha = 0.65 * (1 - p)
        }
      }
      if (kind === 'storm') {
        if (flashAtMs >= 0) {
          const a = flashAlpha(t - flashAtMs)
          flash.alpha = a
          flash.visible = a > 0
          if (!flash.visible) flashAtMs = -1
        } else {
          nextFlashMs -= dtMs
          if (nextFlashMs <= 0) {
            flash.width = w
            flash.height = h
            flashAtMs = t
            nextFlashMs = rollFlashGap()
          }
        }
      }
    },
    destroy() {
      for (const d of drops) d.sprite.destroy()
      for (const s of splashes) s.sprite.destroy()
      flash.destroy()
      ground.destroy()
      for (const x of [...streaks.values(), ...splashTex, ringTex]) x.destroy(true)
    },
  }
}
