import { type Application, Graphics, Sprite, type Texture } from 'pixi.js'

// U7's second half: a multiply vignette on its own sprite over the whole stage, so the 0.25
// overview's void reads as the edge of a picture rather than as an unfinished canvas.

const VIGNETTE_ALPHA = 0.18
const VIGNETTE_COLOR = 0x241f2b // --deep
/** Clear inside this fraction of the half-diagonal, full colour past this one. */
const VIGNETTE_INNER = 0.18
const VIGNETTE_OUTER = 0.72

const TEX_PX = 256
const RINGS = 96

function mix(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** A radial ramp authored once as flat rings — no gradient fill, no linear sampling. */
function vignetteTexture(app: Application): Texture {
  const g = new Graphics()
  g.rect(0, 0, TEX_PX, TEX_PX).fill(VIGNETTE_COLOR)
  const half = TEX_PX / 2
  const rIn = half * VIGNETTE_INNER * 2,
    rOut = half * VIGNETTE_OUTER * 2
  for (let i = RINGS; i >= 0; i--) {
    const t = i / RINGS
    g.circle(half, half, rIn + (rOut - rIn) * t).fill(mix(0xffffff, VIGNETTE_COLOR, t))
  }
  const tex = app.renderer.generateTexture({ target: g, resolution: 1 })
  g.destroy()
  return tex
}

export type Vignette = { tick(): void; destroy(): void }

export function createVignette(app: Application): Vignette {
  const tex = vignetteTexture(app)
  const sprite = new Sprite(tex)
  sprite.blendMode = 'multiply'
  sprite.alpha = VIGNETTE_ALPHA
  sprite.eventMode = 'none'
  app.stage.addChild(sprite)
  return {
    tick: () => {
      const { width, height } = app.screen
      if (sprite.width !== width) sprite.width = width
      if (sprite.height !== height) sprite.height = height
    },
    destroy: () => {
      sprite.destroy()
      tex.destroy(true)
    },
  }
}
