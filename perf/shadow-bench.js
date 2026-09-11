// The page half of the shadow bench. Same scene the frame bench builds (render/layers.ts and
// render/atmosphere.ts by hand), plus N built-form Graphics — what entities.ts:215 draws for a
// structure with no art. `formsOld` paints the six faces the form had; `formsNew` paints the two
// ground marks under them. The delta is the whole cost of this lane.
import {
  Application,
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Texture,
  TextureSource,
} from '/pixi.mjs'

const WEATHER_DIAG = { cloudy: [0.94, 0.96, 1.0], rain: [0.84, 0.92, 1.0] }
const GRADED_LAYERS = ['ground', 'groundDecal', 'shadow', 'entities', 'overhead']
const UNGRADED_LAYERS = ['worldText', 'bubbles', 'overlay']
const SKY_TEX_H = 64
const SKY_MAX_ALPHA = 0.16
const MOON_COLOR = 0xcdd8ff
const CHUNK_PX_W = 1024
const CHUNK_PX_H = 512

// render/iso.ts and render/builtForm.ts, restated: the bench may not import app source.
const TILE_W = 32
const TILE_H = 16
const INSET = 0.18
const ACCENT_INSET = 0.34
const AO_SPREAD = 0.22
const AO_ALPHA = 0.1
const CAST_ALPHA = 0.25

const q = new URLSearchParams(location.search)
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d)
const WIDTH = num('w', 2560)
const HEIGHT = num('h', 1440)
const SPRITES = num('sprites', 400)
const FORMS = num('forms', 200)

function diamond(w, h) {
  return [
    [0.5 - w / 2, 0.5 - h / 2],
    [w / 2 + 0.5, 0.5 - h / 2],
    [w / 2 + 0.5, h / 2 + 0.5],
    [0.5 - w / 2, h / 2 + 0.5],
  ].flatMap(([dx, dy]) => [(dx - dy) * (TILE_W / 2), (dx + dy) * (TILE_H / 2)])
}
const inset = (w, h, by) => diamond(Math.max(w - by * 2, 0.1), Math.max(h - by * 2, 0.1))
const raise = (p, dy) => p.map((v, i) => (i % 2 === 1 ? v + dy : v))
const pt = (p, i) => [p[i * 2], p[i * 2 + 1]]

// render/groundShadow.ts `ring`, verbatim in shape: scale about the centre, offset in x.
function ring(poly, sx, sy, dx) {
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i += 2) {
    cx += poly[i]
    cy += poly[i + 1]
  }
  cx /= poly.length / 2
  cy /= poly.length / 2
  const out = []
  for (let i = 0; i < poly.length; i += 2) {
    out.push(cx + (poly[i] - cx) * sx + dx, cy + (poly[i + 1] - cy) * sy)
  }
  return out
}

// The golden-band worst case, and SHADOW_REST — the sun at every other hour of the day.
const GOLDEN = { scaleX: 2.6, scaleY: 1 + 1.6 / 3, dx: -13, alpha: 0.62 }
const REST = { scaleX: 1, scaleY: 1, dx: 0, alpha: 1 }

function paintForm(g, w, h, heightPx, withGround, SUN = GOLDEN) {
  const stands = diamond(w, h)
  g.clear()
  if (withGround) {
    g.poly(ring(stands, 1 + AO_SPREAD, 1 + AO_SPREAD, 0))
    g.fill({ color: 0x000000, alpha: AO_ALPHA })
    g.poly(ring(stands, SUN.scaleX, SUN.scaleY, SUN.dx * (heightPx / TILE_W)))
    g.fill({ color: 0x000000, alpha: CAST_ALPHA * SUN.alpha })
  }
  const ground = inset(w, h, INSET)
  const top = raise(ground, -heightPx)
  const gE = pt(ground, 1)
  const gS = pt(ground, 2)
  const gW = pt(ground, 3)
  const tE = pt(top, 1)
  const tS = pt(top, 2)
  const tW = pt(top, 3)
  const tN = pt(top, 0)
  const faces = [
    [[...gW, ...gS, ...tS, ...tW], 0x9c6b47],
    [[...gS, ...gE, ...tE, ...tS], 0xd9a876],
    [top, 0xf5d3b3],
  ]
  g.poly(stands)
  g.fill(0x5d5751)
  for (const [poly, color] of faces) {
    g.poly(poly)
    g.fill(color)
  }
  g.poly(raise(inset(w, h, ACCENT_INSET), -heightPx))
  g.fill(0xe0a95e)
  for (const poly of [stands, [...gW, ...gS, ...gE, ...tE, ...tN, ...tW]]) {
    g.poly(poly)
    g.stroke({ width: 1, color: 0x43394a, alignment: 0.5 })
  }
  g.poly([gS[0], gS[1], tS[0], tS[1]])
  g.stroke({ width: 1, color: 0x43394a, alignment: 0.5 })
}

function noiseTexture(w, h, hue) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  for (let y = 0; y < h; y += 16)
    for (let x = 0; x < w; x += 16) {
      const v = 40 + Math.floor(Math.random() * 90)
      g.fillStyle = `rgb(${v * hue[0]},${v * hue[1]},${v * hue[2]})`
      g.fillRect(x, y, 16, 16)
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

  // The stand-ins. Every form is a child Graphics of a Sprite in `entities`, which is exactly
  // how `standIn` hangs one off the structure sprite.
  const plans = []
  const forms = []
  for (let i = 0; i < FORMS; i++) {
    const host = new Sprite(Texture.EMPTY)
    host.position.set(Math.random() * WIDTH, Math.random() * HEIGHT)
    const g = new Graphics()
    g.eventMode = 'none'
    host.addChild(g)
    layers.entities.addChild(host)
    const w = 1 + (i % 3)
    const h = 1 + ((i >> 1) % 3)
    plans.push([w, h, (0.4 + ((i % 7) / 7) * 0.7) * TILE_W])
    forms.push(g)
  }
  const paintAll = (withGround, sun) => {
    forms.forEach((g, i) => {
      paintForm(g, plans[i][0], plans[i][1], plans[i][2], withGround, sun)
    })
  }
  paintAll(false)

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

  const filter = new ColorMatrixFilter()
  const setWeather = (kind) => {
    const diag = WEATHER_DIAG[kind]
    if (diag === undefined) {
      graded.filters = []
      return
    }
    const m = new Float32Array(20)
    m[0] = diag[0]
    m[6] = diag[1]
    m[12] = diag[2]
    m[18] = 1
    filter.matrix = Array.from(m)
    graded.filters = [filter]
  }

  const variants = new Map()
  variants.set('formsOld', { on: () => paintAll(false), off: () => paintAll(false) })
  variants.set('formsNew', { on: () => paintAll(true, GOLDEN), off: () => paintAll(false) })
  variants.set('formsRest', { on: () => paintAll(true, REST), off: () => paintAll(false) })
  variants.set('formsOldRain', {
    on: () => {
      paintAll(false)
      setWeather('rain')
    },
    off: () => {
      paintAll(false)
      setWeather('sunny')
    },
  })
  variants.set('formsNewRain', {
    on: () => {
      paintAll(true)
      setWeather('rain')
    },
    off: () => {
      paintAll(false)
      setWeather('sunny')
    },
  })
  // Calibration, the same unit the frame bench prices a pass in.
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
  for (const n of [1, 2])
    variants.set(`blit${String(n)}`, { on: () => showBlits(n), off: () => showBlits(0) })

  const gl = app.renderer.gl
  const px = new Uint8Array(4)
  const batch = (frames) => {
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) {
      const b = bodies[i % Math.max(1, bodies.length)]
      if (b !== undefined) b.x += b.x > WIDTH ? -WIDTH : 1
      app.render()
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return (performance.now() - t0) / frames
  }

  const run = ({ names, samples = 7, frames = 10, warmup = 30 }) => {
    const out = {}
    for (const n of names) {
      if (!variants.has(n)) throw new Error(`no variant ${n}`)
      out[n] = []
    }
    for (const n of names) {
      variants.get(n).on()
      batch(warmup)
      variants.get(n).off()
    }
    for (let s = 0; s < samples; s++) {
      for (const n of names) {
        const v = variants.get(n)
        v.on()
        out[n].push(batch(frames))
        v.off()
      }
    }
    return out
  }

  const probe = (name) => {
    const v = variants.get(name)
    let draws = 0
    let binds = 0
    const de = gl.drawElements.bind(gl)
    const da = gl.drawArrays.bind(gl)
    const bf = gl.bindFramebuffer.bind(gl)
    v.on()
    app.render()
    gl.drawElements = (...a) => {
      draws++
      de(...a)
    }
    gl.drawArrays = (...a) => {
      draws++
      da(...a)
    }
    gl.bindFramebuffer = (...a) => {
      binds++
      bf(...a)
    }
    app.render()
    gl.drawElements = de
    gl.drawArrays = da
    gl.bindFramebuffer = bf
    v.off()
    return { draws, binds, viewports: [] }
  }

  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  window.sjBench = {
    run,
    probe,
    info: {
      renderer: dbg === null ? '?' : gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
      gl: gl.getParameter(gl.VERSION),
      size: [WIDTH, HEIGHT],
      sprites: SPRITES,
      forms: FORMS,
      drawables: layers.ground.children.length + SPRITES * 2 + FORMS * 2 + 3,
    },
  }
  window.sjBenchReady = true
}

build().catch((e) => {
  window.sjBenchError = String(e?.stack ?? e)
})
