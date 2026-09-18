import { Container, Filter, GlProgram, RenderTexture, Sprite, defaultFilterVert } from 'pixi.js'
import type { WorldStore } from '../state/worldStore.js'
import { poolStrengthAt } from './lightPools.js'
import type { Scene } from './scene.js'

/** ★ MEASURED: the capture of `screen.lights` cost 2.79 full screen blits at 1/2 and 0.57 at
 *  1/4, and a glow is low frequency either way. */
export const BLOOM_SCALE = 0.25

/** ★ MEASURED off the town's own lights: a lamp pool tops out at 0.225 of luminance and the sky
 *  ramp at 0.160, a lit window reaches 0.373 and a fire 0.502. The briefed 0.72 is above all. */
export const BLOOM_THRESHOLD = 0.26
/** How far over the threshold a light is fully bloomed. A fire always is, a window breathes in
 *  and out of it, and that breath is the tell that somebody is awake behind the glass. */
const BLOOM_KNEE = 0.2
/** Screened back over the frame. */
export const BLOOM_STRENGTH = 0.55
/** The glow's reach. `uInputSize` is in CSS pixels whatever the buffer scale, so this is 10 of
 *  them, a third of a tile. */
const BLOOM_RADIUS_TEXELS = 10
/** Samples over the disc. Measured at 1, 7 and 13 fetches the tap count moved the pass by less
 *  than the box's own noise, so the reach is bought with taps rather than with a bigger buffer. */
export const BLOOM_TAPS = 16
export const BLOOM_TAPS_REDUCED = 8

/** How much of a light of this luminance reaches the bloom. The same curve the shader runs, so
 *  a test can ask whether a lamp or a window is over the line without a canvas. */
export function litFraction(luma: number): number {
  const t = Math.min(Math.max((luma - BLOOM_THRESHOLD) / BLOOM_KNEE, 0), 1)
  return t * t * (3 - 2 * t)
}

/** The bloom buffer in whole texels, and the size the sprite is drawn back at. Rounded UP, so
 *  one texel is a whole number of device pixels at every size a window can be dragged to. */
export function bloomBuffer(
  screenW: number,
  screenH: number,
  resolution: number,
): { texW: number; texH: number; cssW: number; cssH: number } {
  const scale = resolution * BLOOM_SCALE
  const texW = Math.max(1, Math.ceil(screenW * scale))
  const texH = Math.max(1, Math.ceil(screenH * scale))
  return { texW, texH, cssW: texW / scale, cssH: texH / scale }
}

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// highp, not the preamble's mediump: pixi's filter vertex declares these at highp and a
// precision that disagrees across the two stages fails to LINK, and the pass draws nothing.
uniform highp vec4 uInputSize;
uniform highp vec4 uInputClamp;
uniform vec4 uBloom;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 lit(vec2 uv) {
    vec4 c = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
    return c.rgb * smoothstep(uBloom.x, uBloom.x + uBloom.y, dot(c.rgb, LUMA));
}

void main(void) {
    vec2 reach = uBloom.z * uInputSize.zw;
    vec3 sum = lit(vTextureCoord);
    float n = 1.0;
    int taps = int(uBloom.w);
    // Golden angle, radius by sqrt: an even disc, not a ring. The bound is a literal because
    // pixi compiles a filter as GLSL ES 1.00, where a loop may not be compared against a uniform.
    for (int i = 1; i <= ${BLOOM_TAPS}; i++) {
        if (i > taps) break;
        float a = 2.39996323 * float(i);
        vec2 o = vec2(cos(a), sin(a)) * reach * sqrt(float(i) / float(taps));
        sum += lit(vTextureCoord + o);
        n += 1.0;
    }
    finalColor = vec4(sum / n, 1.0);
}
`

export type Bloom = {
  /** Capture the lights and blur them, before the frame that screens them back is drawn. */
  tick(): void
  /** the chain's first bloom rung: half the taps */
  setRadius(full: boolean): void
  /** the chain's second: the whole pass, and every texture it reads */
  setEnabled(on: boolean): void
  destroy(): void
}

/** ★ The lights, thresholded and blurred, screened back over the frame. A lit window means
 *  somebody is home and awake, read from across the valley with no label and no bubble. */
export function createBloom(scene: Scene, store: WorldStore): Bloom {
  // The uniform is held here rather than fetched back off `filter.resources`: pixi keeps this
  // exact array, and the round trip through an untyped record is the only thing that needs a cast.
  const uBloom = new Float32Array([BLOOM_THRESHOLD, BLOOM_KNEE, BLOOM_RADIUS_TEXELS, BLOOM_TAPS])
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'sj-bloom' }),
    resources: { bloomUniforms: { uBloom: { value: uBloom, type: 'vec4<f32>' } } },
    resolution: 'inherit',
    antialias: 'off',
  })

  // The blurred copy is drawn on its own, off the stage. The sprite that reads it lives in a
  // layer over the lights, so a capture can never see the glow it made last frame.
  const blurHost = new Container()
  const blurSprite = new Sprite()
  blurSprite.filters = [filter]
  blurHost.addChild(blurSprite)

  const composite = new Sprite()
  composite.eventMode = 'none'
  composite.blendMode = 'screen'
  composite.alpha = BLOOM_STRENGTH
  composite.autoGarbageCollect = false
  scene.screen.bloom.addChild(composite)

  let lights: RenderTexture | null = null
  let blurred: RenderTexture | null = null
  let sizedW = -1,
    sizedH = -1,
    sizedRes = -1
  let on = true

  // Nothing in the town is over the threshold while the sun is up and nothing is alight, and a
  // pass that captures a black screen still pays for every pixel of it.
  let anyLight = false
  const relight = (): void => {
    const s = store.getState()
    anyLight =
      s !== null &&
      (poolStrengthAt(s.tick) > 0 || Object.values(s.structures).some((x) => x.burning))
  }
  relight()
  const offSub = store.subscribe(relight)

  const resize = (w: number, h: number, res: number): void => {
    sizedW = w
    sizedH = h
    sizedRes = res
    const { cssW, cssH } = bloomBuffer(w, h, res)
    const make = (): RenderTexture =>
      RenderTexture.create({
        width: cssW,
        height: cssH,
        resolution: res * BLOOM_SCALE,
        antialias: false,
      })
    lights?.destroy(true)
    blurred?.destroy(true)
    lights = make()
    blurred = make()
    blurSprite.texture = lights
    composite.texture = blurred
    // Drawn at exactly 1 / BLOOM_SCALE, so one texel covers a whole number of device pixels.
    composite.setSize(cssW, cssH)
  }

  return {
    tick() {
      composite.visible = on && anyLight
      if (!on || !anyLight) return
      const { width, height } = scene.app.screen
      const res = scene.app.renderer.resolution
      if (width !== sizedW || height !== sizedH || res !== sizedRes) resize(width, height, res)
      scene.app.renderer.render({ container: scene.screen.lights, target: lights!, clear: true })
      scene.app.renderer.render({ container: blurHost, target: blurred!, clear: true })
    },
    setRadius(full) {
      uBloom[3] = full ? BLOOM_TAPS : BLOOM_TAPS_REDUCED
    },
    setEnabled(next) {
      on = next
    },
    destroy() {
      offSub()
      composite.destroy()
      blurSprite.destroy()
      blurHost.destroy()
      lights?.destroy(true)
      blurred?.destroy(true)
      filter.destroy()
    },
  }
}
