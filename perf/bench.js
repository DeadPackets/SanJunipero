// The page half of the frame bench. Mirrors render/layers.ts and render/atmosphere.ts by hand:
// the app's own modules need a town feed over a websocket, which a bench must not need.
import {
  Application,
  ColorMatrixFilter,
  Container,
  Filter,
  GlProgram,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
  TextureSource,
  defaultFilterVert,
} from '/pixi.mjs'

// render/tints.ts WEATHER_DIAG, verbatim. 'sunny' is absent there and gets no filter.
const WEATHER_DIAG = {
  cloudy: [0.94, 0.96, 1.0],
  rain: [0.84, 0.92, 1.0],
  storm: [0.72, 0.84, 1.0],
  snow: [0.9, 0.95, 1.0],
}
const GRADED_LAYERS = ['ground', 'groundDecal', 'shadow', 'entities', 'overhead']
const UNGRADED_LAYERS = ['worldText', 'bubbles', 'overlay']
const SKY_TEX_H = 64
const SKY_MAX_ALPHA = 0.16
const MOON_COLOR = 0xcdd8ff
const CHUNK_PX_W = 1024
const CHUNK_PX_H = 512

const q = new URLSearchParams(location.search)
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d)
const WIDTH = num('w', 2560)
const HEIGHT = num('h', 1440)
const SPRITES = num('sprites', 400)

function noiseTexture(w, h, hue) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  const cell = 16
  for (let y = 0; y < h; y += cell)
    for (let x = 0; x < w; x += cell) {
      const v = 40 + Math.floor(Math.random() * 90)
      g.fillStyle = `rgb(${v * hue[0]},${v * hue[1]},${v * hue[2]})`
      g.fillRect(x, y, cell, cell)
    }
  return Texture.from(c)
}

function rampTexture() {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = SKY_TEX_H
  const g = c.getContext('2d')
  for (let i = 0; i < SKY_TEX_H; i++) {
    g.fillStyle = `rgba(255,255,255,${1 - i / (SKY_TEX_H - 1)})`
    g.fillRect(0, i, 1, 1)
  }
  const tex = Texture.from(c)
  tex.source.scaleMode = 'linear'
  return tex
}

async function build() {
  TextureSource.defaultOptions.scaleMode = 'nearest'
  const app = new Application()
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    resolution: 1,
    autoDensity: true,
    antialias: false,
    roundPixels: true,
    background: 0x0b0d12,
    preference: 'webgl',
    autoStart: false,
  })
  document.getElementById('root').appendChild(app.canvas)

  const world = new Container()
  const attention = new Container()
  const graded = new Container()
  world.addChild(attention)
  attention.addChild(graded)
  const layers = {}
  for (const name of [...GRADED_LAYERS, ...UNGRADED_LAYERS]) {
    const c = new Container()
    if (name === 'entities') c.sortableChildren = true
    else c.eventMode = 'none'
    ;(GRADED_LAYERS.includes(name) ? graded : world).addChild(c)
    layers[name] = c
  }
  app.stage.addChild(world)
  const screen = {}
  for (const name of ['flash', 'weather', 'night', 'lights', 'bloom']) {
    const c = new Container()
    c.eventMode = 'none'
    app.stage.addChild(c)
    screen[name] = c
  }

  // The ground the camera can see: 1024x512 chunks, the size render/groundChunks.ts bakes.
  const groundTex = noiseTexture(CHUNK_PX_W, CHUNK_PX_H, [0.7, 1, 0.6])
  const cols = Math.ceil(WIDTH / CHUNK_PX_W) + 1
  const rows = Math.ceil(HEIGHT / CHUNK_PX_H) + 1
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const s = new Sprite(groundTex)
      s.position.set(c * CHUNK_PX_W - 200, r * CHUNK_PX_H - 100)
      layers.ground.addChild(s)
    }

  const bodyTex = noiseTexture(32, 48, [1, 0.9, 0.8])
  const shadowTex = noiseTexture(32, 12, [0.3, 0.3, 0.4])
  const bodies = []
  for (let i = 0; i < SPRITES; i++) {
    const s = new Sprite(bodyTex)
    s.position.set(Math.random() * WIDTH, Math.random() * HEIGHT)
    layers.entities.addChild(s)
    const sh = new Sprite(shadowTex)
    sh.alpha = 0.5
    sh.position.set(s.x, s.y + 40)
    layers.shadow.addChild(sh)
    bodies.push(s)
  }

  // render/atmosphere.ts: a multiply quad over the whole screen, then a screened ramp and a
  // screened moon on the same ramp, both behind one Graphics mask.
  const quad = new Sprite(Texture.WHITE)
  quad.blendMode = 'multiply'
  quad.eventMode = 'none'
  quad.width = WIDTH
  quad.height = HEIGHT
  quad.tint = 0x8095f2
  screen.night.addChild(quad)
  const ramp = rampTexture()
  const sky = new Sprite(ramp)
  sky.blendMode = 'screen'
  sky.alpha = SKY_MAX_ALPHA
  const moon = new Sprite(ramp)
  moon.blendMode = 'screen'
  moon.tint = MOON_COLOR
  moon.alpha = 0.14
  const skyMask = new Graphics()
  skyMask.poly([0, 0, WIDTH, 0, WIDTH, HEIGHT, 0, HEIGHT]).fill(0xffffff)
  sky.mask = skyMask
  moon.mask = skyMask
  for (const s of [sky, moon]) {
    s.position.set(0, 0)
    s.width = WIDTH
    s.height = HEIGHT
  }
  screen.lights.addChild(skyMask, sky, moon)

  const scene = { app, world, attention, graded, layers, screen, bodies }

  const filter = new ColorMatrixFilter()
  const setWeather = (kind) => {
    const diag = WEATHER_DIAG[kind]
    if (diag === undefined) {
      scene.graded.filters = []
      return
    }
    const m = new Float32Array(20)
    m[0] = diag[0]
    m[6] = diag[1]
    m[12] = diag[2]
    m[18] = 1
    filter.matrix = Array.from(m)
    scene.graded.filters = [filter]
  }

  const variants = new Map()
  variants.set('empty', {
    on: () => {
      world.visible = false
      for (const c of Object.values(screen)) c.visible = false
    },
    off: () => {
      world.visible = true
      for (const c of Object.values(screen)) c.visible = true
    },
  })
  variants.set('sunny', { on: () => setWeather('sunny'), off: () => setWeather('sunny') })
  for (const kind of Object.keys(WEATHER_DIAG))
    variants.set(kind, { on: () => setWeather(kind), off: () => setWeather('sunny') })

  // Calibration: an extra opaque full-screen sprite. The unit a pass is priced in, so a number
  // off a software rasteriser still says something to a box with a real GPU.
  const blitTex = noiseTexture(256, 256, [1, 1, 1])
  const blits = []
  for (let i = 0; i < 4; i++) {
    const s = new Sprite(blitTex)
    s.width = WIDTH
    s.height = HEIGHT
    s.visible = false
    layers.overlay.addChild(s)
    blits.push(s)
  }
  const showBlits = (n) => blits.forEach((s, i) => (s.visible = i < n))
  for (const n of [1, 2, 4])
    variants.set(`blit${String(n)}`, { on: () => showBlits(n), off: () => showBlits(0) })

  // ── render/bloom.ts and render/attention.ts, mirrored ──────────────────────────────────
  // Shaders copied verbatim from the modules. The bloom captures `screen.lights` into a half
  // resolution target, thresholds and blurs it there, and screens it back over the frame.
  const BLOOM_SCALE = 0.25
  const BLOOM_THRESHOLD = 0.26
  const BLOOM_KNEE = 0.2
  const BLOOM_STRENGTH = 0.55
  const BLOOM_RADIUS_TEXELS = 10
  const BLOOM_TAPS = 16
  const BLOOM_TAPS_REDUCED = 8
  const DESATURATE = 0.35
  const BAND_FEATHER = 0.35

  const bloomFrag = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
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
    for (int i = 1; i <= taps; i++) {
        float a = 2.39996323 * float(i);
        vec2 o = vec2(cos(a), sin(a)) * reach * sqrt(float(i) / float(taps));
        sum += lit(vTextureCoord + o);
        n += 1.0;
    }
    finalColor = vec4(sum / n, 1.0);
}
`
  const bandFrag = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uBand;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float ISO = 0.5;
const float FEATHER = ${BAND_FEATHER};

void main(void) {
    vec4 c = texture(uTexture, vTextureCoord);
    vec2 at = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
    vec2 d = (at - uBand.xy) / vec2(uBand.z, uBand.z * ISO);
    float k = smoothstep(1.0, 1.0 + FEATHER, length(d)) * uBand.w;
    finalColor = vec4(mix(c.rgb, vec3(dot(c.rgb, LUMA)), k), c.a);
}
`

  const bloomFilter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: bloomFrag, name: 'sj-bloom' }),
    resources: {
      bloomUniforms: {
        uBloom: {
          value: new Float32Array([BLOOM_THRESHOLD, BLOOM_KNEE, BLOOM_RADIUS_TEXELS, BLOOM_TAPS]),
          type: 'vec4<f32>',
        },
      },
    },
    resolution: 1,
    antialias: 'off',
  })
  const bandFilter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: bandFrag, name: 'sj-band' }),
    resources: {
      bandUniforms: {
        uBand: {
          value: new Float32Array([WIDTH * 0.5, HEIGHT * 0.5, 6 * 32, DESATURATE]),
          type: 'vec4<f32>',
        },
      },
    },
    resolution: 1,
    antialias: 'off',
  })

  const rtOf = (scale) =>
    RenderTexture.create({
      width: Math.ceil(WIDTH * scale) / scale,
      height: Math.ceil(HEIGHT * scale) / scale,
      resolution: scale,
      antialias: false,
    })
  const litRt = rtOf(BLOOM_SCALE)
  const blurRt = rtOf(BLOOM_SCALE)
  const litQt = rtOf(0.25)
  const blurHost = new Container()
  const blurSprite = new Sprite(litRt)
  blurSprite.filters = [bloomFilter]
  blurHost.addChild(blurSprite)
  const bloomOut = new Sprite(blurRt)
  bloomOut.blendMode = 'screen'
  bloomOut.alpha = BLOOM_STRENGTH
  bloomOut.setSize(
    Math.ceil(WIDTH * BLOOM_SCALE) / BLOOM_SCALE,
    Math.ceil(HEIGHT * BLOOM_SCALE) / BLOOM_SCALE,
  )
  bloomOut.visible = false
  screen.bloom.addChild(bloomOut)

  const bloomTick = () => {
    app.renderer.render({ container: screen.lights, target: litRt, clear: true })
    app.renderer.render({ container: blurHost, target: blurRt, clear: true })
  }
  const captureHalf = () => {
    app.renderer.render({ container: screen.lights, target: litRt, clear: true })
  }
  const captureQuarter = () => {
    app.renderer.render({ container: screen.lights, target: litQt, clear: true })
  }
  const only = (fn) => ({
    on: () => {
      preRender.add(fn)
      bloomOut.visible = false
    },
    off: () => {
      preRender.delete(fn)
    },
  })
  const setBloom = (on, taps) => {
    bloomFilter.resources.bloomUniforms.uniforms.uBloom[3] = taps
    bloomOut.visible = on
    if (on) preRender.add(bloomTick)
    else preRender.delete(bloomTick)
  }
  variants.set('bloom', {
    on: () => setBloom(true, BLOOM_TAPS),
    off: () => setBloom(false, BLOOM_TAPS),
  })
  // Where the bloom's bill goes: the capture alone, then the capture plus the copy, the
  // threshold and the composite, then the taps on top of that.
  variants.set('bloomCapture', only(captureHalf))
  variants.set('bloomCaptureQuarter', only(captureQuarter))
  variants.set('bloomNoTaps', {
    on: () => setBloom(true, 0),
    off: () => setBloom(false, BLOOM_TAPS),
  })
  variants.set('bloomHalfTaps', {
    on: () => setBloom(true, BLOOM_TAPS_REDUCED),
    off: () => setBloom(false, BLOOM_TAPS),
  })
  const setBand = (on) => {
    attention.filters = on ? [bandFilter] : []
  }
  variants.set('attention', { on: () => setBand(true), off: () => setBand(false) })
  variants.set('attentionCloudy', {
    on: () => {
      setBand(true)
      setWeather('rain')
    },
    off: () => {
      setBand(false)
      setWeather('sunny')
    },
  })
  variants.set('chain', {
    on: () => {
      setBand(true)
      setBloom(true, BLOOM_TAPS)
      setWeather('rain')
    },
    off: () => {
      setBand(false)
      setBloom(false, BLOOM_TAPS)
      setWeather('sunny')
    },
  })
  variants.set('gradeOnly', { on: () => setWeather('rain'), off: () => setWeather('sunny') })

  const gl = app.renderer.gl
  const px = new Uint8Array(4)
  // One readPixels a batch, not a frame: it is the only sync point a WebGL context offers, and
  // one a frame would bill its own stall to every pass equally.
  // A pass that captures before the frame is drawn is billed with it, the way the real chain
  // runs on the ticker ahead of Application's own render.
  const preRender = new Set()
  const batch = (frames) => {
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) {
      const b = bodies[i % Math.max(1, bodies.length)]
      if (b !== undefined) b.x += b.x > WIDTH ? -WIDTH : 1
      for (const fn of preRender) fn()
      app.render()
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return (performance.now() - t0) / frames
  }

  const run = ({ names, samples = 9, frames = 20, warmup = 30 }) => {
    const out = {}
    for (const n of names) {
      out[n] = []
      const v = variants.get(n)
      if (v === undefined) throw new Error(`no variant ${n}`)
    }
    for (const n of names) {
      variants.get(n).on()
      batch(warmup)
      variants.get(n).off()
    }
    // Round robin, so a box that gets busier halfway spreads the drift over every variant.
    for (let s = 0; s < samples; s++)
      for (const n of names) {
        const v = variants.get(n)
        v.on()
        out[n].push(batch(frames))
        v.off()
      }
    return out
  }

  // What one frame ASKS OF THE DRIVER, which is the same on every box: draw calls, framebuffer
  // binds, and the viewport each bind renders at. An offscreen round trip cannot hide from this.
  const probe = (name) => {
    const v = variants.get(name)
    v.on()
    for (const fn of preRender) fn()
    app.render()
    const counts = { draws: 0, binds: 0, viewports: [] }
    const wrap = (fn, tally) => {
      const orig = gl[fn].bind(gl)
      gl[fn] = (...a) => {
        tally(a)
        return orig(...a)
      }
      return () => (gl[fn] = orig)
    }
    const undo = [
      wrap('drawElements', () => counts.draws++),
      wrap('drawArrays', () => counts.draws++),
      wrap('bindFramebuffer', (a) => counts.binds++ && a),
      wrap('viewport', (a) => counts.viewports.push(`${String(a[2])}x${String(a[3])}`)),
    ]
    for (const fn of preRender) fn()
    app.render()
    for (const u of undo) u()
    v.off()
    counts.viewports = [...new Set(counts.viewports)]
    return counts
  }

  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  window.sjBench = {
    run,
    probe,
    addVariant: (name, v) => variants.set(name, v),
    resize: (w, h) => {
      app.renderer.resize(w, h)
      quad.width = w
      quad.height = h
    },
    info: {
      pixi: '8.19.0',
      renderer: app.renderer.name,
      gl: dbg === null ? gl.getParameter(gl.VERSION) : gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
      size: [app.screen.width, app.screen.height],
      sprites: SPRITES,
      drawables: layers.ground.children.length + SPRITES * 2 + 3,
    },
  }
  window.sjBenchReady = true
}

build().catch((e) => {
  window.sjBenchError = String(e && e.stack ? e.stack : e)
})
