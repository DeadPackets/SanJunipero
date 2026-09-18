import { Filter, GlProgram, defaultFilterVert } from 'pixi.js'
import type { Container } from 'pixi.js'
import { TILE_H, TILE_W } from './iso.js'
import type { Scene } from './scene.js'

/** ★ The band the eye is inside, measured out from the cast the WORLD says is in a scene. Six
 *  tiles, and nothing outside it is dimmed, blurred or faded: it is only less coloured. */
export const BAND_TILES = 6
/** How much colour the outside gives up. Blur reads as damage on nearest-neighbour art and an
 *  alpha drop composites toward the ground colour and reads as fog, so neither is here. */
export const DESATURATE = 0.35
/** The band's soft edge, as a fraction of its own radius. */
const BAND_FEATHER = 0.35
/** A cast arriving or leaving takes this long to reach full strength, so a cut never snaps. */
export const ATTENTION_FADE_MS = 400

/** Where the cast is and how wide it stands, in the space `tileToScreen` returns. THE one
 *  answer to "who is the camera about", read off the world's own open scene. */
export function castBand(scene: Scene): { sx: number; sy: number; r: number } | null {
  const ring = scene.ring.bounds()
  if (ring !== null) {
    const spread = Math.max(ring.rx, (ring.ry * TILE_W) / TILE_H)
    return { sx: ring.sx, sy: ring.sy, r: spread + BAND_TILES * TILE_W }
  }
  const id = scene.pickedId ?? scene.cameraSubject
  if (id === null) return null
  const at = scene.pointOf('agent', id)
  return at === null ? null : { sx: at.sx, sy: at.sy, r: BAND_TILES * TILE_W }
}

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// highp, not the preamble's mediump: pixi's filter vertex declares these at highp and a
// precision that disagrees across the two stages fails to LINK, with a blank subtree for it.
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec4 uBand;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float ISO = ${TILE_H / TILE_W};
const float FEATHER = ${BAND_FEATHER};

void main(void) {
    vec4 c = texture(uTexture, vTextureCoord);
    vec2 at = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
    vec2 d = (at - uBand.xy) / vec2(uBand.z, uBand.z * ISO);
    float k = smoothstep(1.0, 1.0 + FEATHER, length(d)) * uBand.w;
    finalColor = vec4(mix(c.rgb, vec3(dot(c.rgb, LUMA)), k), c.a);
}
`

export type Attention = {
  tick(): void
  /** the chain's first rung: the whole pass, and the round trip it forces on a clear day */
  setEnabled(on: boolean): void
  destroy(): void
}

/** ★ Outside the band the picture keeps its brightness and gives up its colour. It inherits the
 *  renderer's own resolution, so the world is never resampled on a screen whose DPR is not 1. */
export function createAttention(scene: Scene, node: Container): Attention {
  // The uniform is held here rather than fetched back off `filter.resources`: pixi keeps this
  // exact array, and the round trip through an untyped record is the only thing that needs a cast.
  const uBand = new Float32Array([0, 0, 1, 0])
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'sj-attention' }),
    resources: { bandUniforms: { uBand: { value: uBand, type: 'vec4<f32>' } } },
    resolution: 'inherit',
    antialias: 'off',
  })

  let held: { sx: number; sy: number; r: number } | null = null
  let amount = 0
  let lastMs = -1
  let on = true
  let attached = false

  const detach = (): void => {
    if (!attached) return
    node.filters = []
    attached = false
  }

  return {
    tick() {
      const band = castBand(scene)
      if (band !== null) held = band
      const nowMs = scene.app.ticker.lastTime
      const dt = lastMs < 0 ? 0 : nowMs - lastMs
      lastMs = nowMs
      const want = on && band !== null ? DESATURATE : 0
      const step = scene.wantsMotion() ? (DESATURATE * dt) / ATTENTION_FADE_MS : DESATURATE
      amount = want > amount ? Math.min(want, amount + step) : Math.max(want, amount - step)
      if (amount <= 0 || held === null) {
        detach()
        return
      }
      if (!attached) {
        node.filters = [filter]
        attached = true
      }
      const k = scene.world.scale.x
      uBand[0] = held.sx * k + scene.world.position.x
      uBand[1] = held.sy * k + scene.world.position.y
      uBand[2] = Math.max(1, held.r * k)
      uBand[3] = amount
    },
    setEnabled(next) {
      on = next
    },
    destroy() {
      detach()
      filter.destroy()
    },
  }
}
