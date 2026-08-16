import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Scene } from './scene.js'

export const PARTICLES = {
  rain: { n: 220, vy: 380, vx: -60, len: 6, color: 0x7fb0c9, alpha: 0.7 },
  snow: { n: 140, vy: 40, vx: -12, len: 2, color: 0xfff6e9, alpha: 0.9 },
  storm: { n: 320, vy: 480, vx: -110, len: 8, color: 0x5a8cab, alpha: 0.8 },
} as const

export const FLASH_MS = 90
export const FLASH_COLOR = 0xf4e289
export const FLASH_MIN_GAP_S = 6
export const FLASH_MAX_GAP_S = 14

export type WeatherLayer = { setKind(kind: string): void; setSuppressed(v: boolean): void; tick(dtMs: number): void; destroy(): void }

type Drop = { sprite: Sprite; x: number; y: number }

export function createWeatherLayer(scene: Scene): WeatherLayer {
  const layer = new Container()
  scene.app.stage.addChild(layer)
  const flash = new Sprite(Texture.WHITE)
  flash.tint = FLASH_COLOR
  flash.alpha = 0.6
  flash.visible = false
  scene.app.stage.addChild(flash)

  let kind: keyof typeof PARTICLES | null = null
  let suppressed = false
  let drops: Drop[] = []
  let flashLeftMs = 0
  let nextFlashMs = 0
  const streakTextures = new Map<string, Texture>()

  // viewer-side Math.random is FINE here: presentation only, never simulation
  const rollFlashGap = (): number => (FLASH_MIN_GAP_S + Math.random() * (FLASH_MAX_GAP_S - FLASH_MIN_GAP_S)) * 1000

  const clear = (): void => {
    for (const d of drops) d.sprite.destroy()
    drops = []
    flash.visible = false
  }

  const spawnAll = (): void => {
    clear()
    if (kind === null || suppressed) return
    const spec = PARTICLES[kind]
    let tex = streakTextures.get(kind)
    if (tex === undefined) {
      const g = new Graphics()
      g.moveTo(0, 0)
      g.lineTo(spec.vx / 60, spec.len)
      g.stroke({ width: kind === 'snow' ? 2 : 1, color: 0xffffff })
      tex = scene.app.renderer.generateTexture(g)
      g.destroy()
      streakTextures.set(kind, tex)
    }
    const w = scene.app.screen.width
    const h = scene.app.screen.height
    for (let i = 0; i < spec.n; i++) {
      const sprite = new Sprite(tex)
      sprite.tint = spec.color
      sprite.alpha = spec.alpha
      const d = { sprite, x: Math.random() * w, y: Math.random() * h }
      sprite.position.set(d.x, d.y)
      layer.addChild(sprite)
      drops.push(d)
    }
    if (kind === 'storm') nextFlashMs = rollFlashGap()
  }

  return {
    setKind(k) {
      const next = k in PARTICLES ? (k as keyof typeof PARTICLES) : null
      if (next === kind) return
      kind = next
      spawnAll()
    },
    setSuppressed(v) {
      if (v === suppressed) return
      suppressed = v
      if (v) clear() // suppression clears live particles and blocks spawns
      else spawnAll()
    },
    tick(dtMs) {
      if (kind === null || suppressed) return
      const spec = PARTICLES[kind]
      const w = scene.app.screen.width
      const h = scene.app.screen.height
      const dt = dtMs / 1000
      for (const d of drops) {
        d.x += spec.vx * dt
        d.y += spec.vy * dt
        if (d.y > h) {
          d.y -= h + spec.len
          d.x = Math.random() * w
        }
        if (d.x < 0) d.x += w
        d.sprite.position.set(d.x, d.y)
      }
      if (kind === 'storm') {
        if (flashLeftMs > 0) {
          flashLeftMs -= dtMs
          if (flashLeftMs <= 0) flash.visible = false
        } else {
          nextFlashMs -= dtMs
          if (nextFlashMs <= 0) {
            flash.width = w
            flash.height = h
            flash.visible = true
            flashLeftMs = FLASH_MS
            nextFlashMs = rollFlashGap()
          }
        }
      }
    },
    destroy() {
      clear()
      layer.destroy({ children: true })
      flash.destroy()
      for (const t of streakTextures.values()) t.destroy(true)
    },
  }
}
