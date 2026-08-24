// THROWAWAY MOCK renderer. It re-draws the product's town in a 2D canvas so the four
// treatments can be switched independently on one frame. Everything geometric — the
// projection, the ground layers, the material sampling matrices, the road silhouettes, the
// building anchors and scales — comes out of scene.json, which gen.ts read from the product's
// own modules. Nothing here re-derives a number the renderer already owns.
//
// THE PROJECTION DOES NOT CHANGE: sx = (dx-dy)*16, sy = (dx+dy)*8, and every draw is at 1x
// native world pixels. The display scale is applied to the finished canvas with smoothing off,
// so nothing is ever upscaled before it is drawn.

// ── the sun, argued once ───────────────────────────────────────────────────────────────────
//
// AZIMUTH 250 deg (20 deg south of due west), ELEVATION 38 deg.
//
// The town has no light direction today and the art will not choose one: measured over the 20
// committed cells, mean(right half) - mean(left half) is +0.1 luma with a sign that flips
// between the two facings of the SAME kind (house +11.6 / house-se -12.2). So the sun cannot
// be read off the art; it has to be picked, and the two things in the codebase that DO state a
// direction disagree with each other:
//
//   ambient.ts:70   CANOPY_LIT ... "lit from the upper left, like everything else"
//   builtForm.ts    ramps put `right` lighter than `left` — lit from the upper RIGHT
//
// 250 deg backs the canopy, because (a) it is the one direction the codebase says in words,
// (b) upper-left is the convention Stardew and nearly every 2D game uses, and (c) builtForm
// draws for ZERO of the eleven structures in this town — all eleven have committed cells — so
// contradicting it costs nothing on screen today.
//
// ELEVATION 52 deg is chosen against the projection, not against a mood board. The ground
// plane in a 2:1 dimetric compresses y by half, so a cast shadow is already flat; at 38 deg it
// runs 1.28x the object's height and reads as a pale smear rather than as a shape. 52 deg puts
// it at 0.78x — short enough to stay a silhouette — and it also widens the face steps, because
// a higher sun lifts the roof further above two walls that are both turned away from it:
// roof 1.00, the SW wall 0.71, the SE wall 0.61.
export const SUN = { azimuthDeg: 250, elevationDeg: 52 }

const D2R = Math.PI / 180
// world-space unit vector pointing TOWARD the sun
const SUN_L = [Math.sin(SUN.azimuthDeg * D2R), -Math.cos(SUN.azimuthDeg * D2R)]
// how far a shadow runs per world tile of height, and that offset in screen px
const SHADOW_TILES_PER_TILE_H = 1 / Math.tan(SUN.elevationDeg * D2R)
const SH_DX = -SUN_L[0] * SHADOW_TILES_PER_TILE_H
const SH_DY = -SUN_L[1] * SHADOW_TILES_PER_TILE_H
/** screen px the shadow travels per screen px of object height (1 tile of height = TILE_W) */
export const SHADOW_STEP = { x: (SH_DX - SH_DY) * 16 / 32, y: (SH_DX + SH_DY) * 8 / 32 }

const lambert = (nx, ny, nz) => {
  const c = Math.cos(SUN.elevationDeg * D2R), s = Math.sin(SUN.elevationDeg * D2R)
  return Math.max(0, nx * SUN_L[0] * c + ny * SUN_L[1] * c + nz * s)
}
const AMBIENT = 0.55
const face = (nx, ny, nz) => AMBIENT + (1 - AMBIENT) * lambert(nx, ny, nz)
const ROOF_REF = face(0, 0, 1)
/** roof 1.00 · the +y (screen-left, SW) wall · the +x (screen-right, SE) wall */
export const FACE_MULT = {
  roof: 1,
  left: face(0, 1, 0) / ROOF_REF,
  right: face(1, 0, 0) / ROOF_REF,
}
export const CONTACT_SHADOW_ALPHA = 0.22   // the value interiors.ts already ships
export const CAST_SHADOW_ALPHA = 0.32
export const SHADOW_INK = '#241f2b'        // MASTER_PALETTE shadow dark

// ── treatment B, the palette map ───────────────────────────────────────────────────────────
//
// One curve on LUMA, hue and saturation untouched, applied to every source texture at LOAD.
// PIVOT is the measured mean of the baseline frame; GAIN is chosen so the frame's own
// 2nd-98th percentile band fills the range instead of sitting in the middle third of it. The
// page measures the before and after itself — the numbers in the stat strip are read off the
// pixels, not off this comment.
export const PALETTE_MAP = { pivot: 0.72, gain: 1.55, knee: 0.09 }

/** Continuous and C1 at both knees, asymptotic at both ends: real darks and real lights, and
 *  no clipped black or blown white anywhere. */
function softClip(u) {
  const k = PALETTE_MAP.knee
  if (u > 1 - k) return 1 - k * Math.exp(-(u - (1 - k)) / k)
  if (u < k) return k * Math.exp((u - k) / k)
  return u
}

function lumaCurve(y) {
  const { pivot, gain } = PALETTE_MAP
  return softClip(pivot + (y - pivot) * gain)
}

const LUT = new Float64Array(256)
for (let i = 0; i < 256; i++) LUT[i] = lumaCurve(i / 255) * 255

const REC709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The map, per pixel: move the luma, keep the chroma, desaturate rather than clip a hue. */
export function mapPixels(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    let r = data[i], g = data[i + 1], b = data[i + 2]
    const y = REC709(r, g, b)
    const y2 = LUT[Math.round(Math.max(0, Math.min(255, y)))]
    if (y < 0.5) { data[i] = data[i + 1] = data[i + 2] = y2; continue }
    const k = y2 / y
    r *= k; g *= k; b *= k
    const m = Math.max(r, g, b)
    if (m > 255) {
      const t = (m - 255) / (m - y2 + 1e-6)
      r += (y2 - r) * t; g += (y2 - g) * t; b += (y2 - b) * t
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b
  }
  return data
}

// ── treatment A, ground scatter ────────────────────────────────────────────────────────────
//
// Placed from a POSITION HASH, so the town is the same on every reload and the treatment holds
// no state at all. FNV-1a, the hash groundField.ts already uses for its material offsets.
export function hash2(x, y) {
  let h = 0x811c9dc5
  for (const c of `${x},${y}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return h >>> 0
}

/** MASTER_PALETTE members only. Props are drawn in code — no generated art, nothing forged. */
const P = {
  sageLit: '#93b573', sage: '#6f9455', sageDark: '#4f7040', pale: '#dce8c8',
  stoneLit: '#cfc6bc', stone: '#aba198', stoneDark: '#857d75',
  rose: '#e09e9b', roseLit: '#f2c6c2', honey: '#f2c879', cream: '#f6e8d5',
  earth: '#a66e38', earthLit: '#c68a48', ink: '#43394a',
}

/**
 * The prop table. Weights are out of 100 and the mix is a designed one: a verge is mostly
 * grass, a field edge has stones in it, and flowers are the rare mark that makes a screen
 * worth looking at twice. `w` is the weight, `d` the draw.
 */
// ★ EVERY PROP CARRIES ITS OWN VALUE RANGE. The first pass drew one-pixel blades in one green
// and they vanished into the grass at 2x — which is treatment B's whole complaint restated at
// prop scale. Each one now has a dark foot (#4F7040 / #857D75), a body, and a lit crown one to
// two steps up the same ramp, so it reads as an object at 1x and does not need B to be on.
const PROPS = [
  { id: 'tuft', w: 40, d: (c, h) => {
    const n = 3 + (h & 1)
    c.fillStyle = P.sageDark
    c.fillRect(-3, -2, 7, 2)
    for (let i = 0; i < n; i++) {
      const x = -3 + i * 2 + ((h >>> (i * 2)) & 1)
      const t = 3 + ((h >>> (i * 3 + 4)) & 3)
      c.fillStyle = P.sage
      c.fillRect(x, -t, 1, t)
      c.fillStyle = i % 2 ? P.sageLit : P.pale
      c.fillRect(x, -t, 1, 1)
    }
  } },
  { id: 'clump', w: 17, d: (c, h) => {
    c.fillStyle = P.sageDark
    c.fillRect(-5, -3, 10, 3)
    c.fillRect(-3, -5, 6, 2)
    c.fillStyle = P.sage
    c.fillRect(-4, -4, 7, 1)
    c.fillRect(-2 + (h & 3), -6, 3, 1)
    c.fillStyle = P.sageLit
    c.fillRect(-4, -4, 3, 1)
    c.fillRect(-2 + (h & 3), -6, 2, 1)
  } },
  { id: 'stone', w: 14, d: (c, h) => {
    const w = 4 + (h & 1) * 3
    const x0 = -(w >> 1)
    c.fillStyle = P.ink
    c.fillRect(x0, -1, w, 1)
    c.fillStyle = P.stoneDark
    c.fillRect(x0, -3, w, 2)
    c.fillStyle = P.stone
    c.fillRect(x0, -4, w, 1)
    c.fillStyle = P.stoneLit
    c.fillRect(x0, -4, 2, 1)
    c.fillRect(x0 + 1, -5, w - 3, 1)
  } },
  { id: 'flower', w: 12, d: (c, h) => {
    const head = [P.rose, P.honey, P.roseLit, P.cream][(h >>> 5) & 3]
    c.fillStyle = P.sageDark
    c.fillRect(-2, -2, 5, 2)
    c.fillRect(0, -6, 1, 5)
    c.fillStyle = head
    c.fillRect(-1, -8, 3, 2)
    c.fillRect(0, -9, 1, 1)
    c.fillStyle = P.sage
    c.fillRect(-3, -3, 2, 2)
    c.fillRect(3, -4, 1, 3)
  } },
  { id: 'fern', w: 10, d: (c, h) => {
    c.fillStyle = P.sageDark
    c.fillRect(-4, -2, 9, 2)
    for (let i = 0; i < 5; i++) {
      const x = -4 + i * 2, t = 4 + (2 - Math.abs(2 - i)) * 2 + ((h >>> i) & 1)
      c.fillStyle = i === 2 ? P.sage : P.sageDark
      c.fillRect(x, -t, 1, t)
      c.fillStyle = P.sageLit
      c.fillRect(x, -t, 1, 1)
    }
    c.fillStyle = P.pale
    c.fillRect(0, -9, 1, 1)
  } },
  { id: 'twig', w: 7, d: (c) => {
    c.fillStyle = P.ink
    c.fillRect(-4, -1, 8, 1)
    c.fillStyle = P.earth
    c.fillRect(-4, -2, 8, 1)
    c.fillRect(1, -3, 3, 1)
    c.fillStyle = P.earthLit
    c.fillRect(-4, -2, 3, 1)
  } },
]
const WEIGHT_TOTAL = PROPS.reduce((n, p) => n + p.w, 0)
const pickProp = (h) => {
  let r = (h >>> 8) % WEIGHT_TOTAL
  for (const p of PROPS) { if (r < p.w) return p; r -= p.w }
  return PROPS[0]
}

/** Verge multiplier: ground beside a road carries more than open field, because that is where
 *  feet and wheels put things. Argued, not tuned — it is the one place a town shows wear. */
export const VERGE_BOOST = 1.9

// ── the scene ──────────────────────────────────────────────────────────────────────────────

export async function loadScene(url = 'scene.json') {
  const scene = await (await fetch(url)).json()
  const files = new Set()
  for (const l of scene.layers) if (l.material) files.add(l.material)
  for (const s of scene.structures) if (s.cell) files.add(s.cell)
  const imgs = new Map()
  await Promise.all([...files].map((f) => new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => { imgs.set(f, im); res() }
    im.onerror = () => rej(new Error(`cannot load ${f}`))
    im.src = f
  })))
  scene.images = imgs
  scene.mapped = new Map()   // treatment B copies, made once, at load
  for (const [f, im] of imgs) scene.mapped.set(f, remap(im))
  scene.terrainGrid = scene.terrain.map((row) => [...row].map((c) => parseInt(c, 36)))
  scene.built = builtTiles(scene)
  scene.silhouettes = new Map()
  return scene
}

function canvasOf(w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d', { willReadFrequently: true })
  x.imageSmoothingEnabled = false
  return { c, x }
}

function remap(im) {
  const { c, x } = canvasOf(im.width, im.height)
  x.drawImage(im, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height)
  mapPixels(d.data)
  x.putImageData(d, 0, 0)
  return c
}

/** Tiles a building stands on — scatter never grows through a wall. */
function builtTiles(scene) {
  const set = new Set()
  for (const s of scene.structures)
    for (let y = s.y - 1; y < s.y + s.h + 1; y++)
      for (let x = s.x - 1; x < s.x + s.w + 1; x++) set.add(`${x},${y}`)
  return set
}

const ROAD = 7
function nearRoad(g, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
    if (g[y + dy]?.[x + dx] === ROAD) return true
  return false
}

/** Weeds in the cracks: a plaza with nothing growing in it reads as a car park. A quarter of
 *  the field rate, tufts and twigs only. */
export const COBBLE_RATE = 0.25

/** Every prop this town would carry at `density`. Pure in (scene, density). */
export function scatterPlan(scene, density) {
  const out = []
  if (density <= 0) return out
  const g = scene.terrainGrid
  for (let y = 0; y < g.length; y++) {
    const row = g[y]
    for (let x = 0; x < row.length; x++) {
      const grass = row[x] === 0, road = row[x] === ROAD
      if (!grass && !road) continue
      if (scene.built.has(`${x},${y}`)) continue
      const h = hash2(x, y)
      const verge = grass && nearRoad(g, x, y)
      // ★ CLUMPED, NOT SPRINKLED. A uniform hash gives confetti: the same count spread evenly
      // over every tile, which reads as noise rather than as ground. A second hash on a 4x4
      // patch biases the rate between 0.35x and 1.65x, mean 1.0, so the count is unchanged and
      // the town gets thickets and bare stretches instead of an even dusting.
      const patch = 0.35 + 1.3 * ((hash2(x >> 2, y >> 2) & 4095) / 4096)
      const p = Math.min(0.95, density * patch * (road ? COBBLE_RATE : verge ? VERGE_BOOST : 1))
      if ((h % 10000) / 10000 >= p) continue
      const prop = road ? (((h >>> 19) & 3) === 0 ? PROPS[5] : PROPS[0])
        : verge && ((h >>> 19) & 3) === 0 ? PROPS[2] : pickProp(h)
      // sub-tile jitter, inside the diamond, from bits nothing else uses
      const u = (((h >>> 3) & 31) / 31 - 0.5) * 0.72
      const v = (((h >>> 11) & 31) / 31 - 0.5) * 0.72
      out.push({
        x, y, prop, h, verge, road,
        sx: (x + u - (y + v)) * 16,
        sy: (x + u + y + v) * 8 + 8,
      })
    }
  }
  return out
}

// ── treatment A, part two: the worn path ───────────────────────────────────────────────────
//
// The named fourth thing in the brief, and the only part of the scatter that belongs in the
// BAKE rather than in a sprite: it is ground, not an object standing on it. A grass tile
// touching paving is trodden; the more paved neighbours it has the barer it is. Two tones of
// the earth material's own palette, dithered on the position hash so the edge is not a curve
// somebody drew.
export const WORN = { near: '#a9946b', bare: '#c68a48' }

export function wornPlan(scene) {
  const g = scene.terrainGrid, out = []
  for (let y = 0; y < g.length; y++) {
    for (let x = 0; x < g[y].length; x++) {
      if (g[y][x] !== 0) continue
      if (scene.built.has(`${x},${y}`)) continue
      const dirs = []
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (g[y + dy]?.[x + dx] === ROAD) dirs.push([dx, dy])
      if (dirs.length === 0) continue
      out.push({ x, y, n: dirs.length, dirs, h: hash2(x + 7919, y + 104729),
        sx: (x - y) * 16, sy: (x + y) * 8 })
    }
  }
  return out
}

/** Baked once per palette state into its own transparent overlay: it is ground, so it costs
 *  nothing per frame and it sorts under every object that stands on it. */
export function bakeWorn(scene, useB) {
  const { c, x } = canvasOf(scene.fieldW, scene.fieldH)
  const off = scene.offsetX
  let quads = 0
  for (const w of scene.worn) {
    const cx = w.sx + off, cy = w.sy
    // 64 dither cells over the diamond. A cell survives on three things: the hash, how trodden
    // the tile is, and HOW CLOSE IT IS TO THE PAVING — the first pass dropped that last term
    // and the wear floated in the middle of the grass instead of hugging the kerb, which is
    // where feet actually put it.
    const base = w.n >= 3 ? 0.95 : w.n === 2 ? 0.8 : 0.62
    for (let i = 0; i < 64; i++) {
      const u = ((i & 7) + 0.5) / 8 - 0.5, v = ((i >> 3) + 0.5) / 8 - 0.5
      if (Math.abs(u) + Math.abs(v) > 0.5) continue
      let prox = 0
      for (const [dx, dy] of w.dirs) prox = Math.max(prox, 0.5 + u * dx + v * dy)
      const p = base * prox * prox * prox
      if (((hash2(w.x * 64 + i, w.y) >>> 7) & 255) / 256 >= p) continue
      const px = cx + (u - v) * 32, py = cy + (u + v) * 16 + 8
      x.fillStyle = toneCss(parseInt((prox > 0.8 ? WORN.bare : WORN.near).slice(1), 16), useB)
      x.globalAlpha = 0.55 + 0.35 * prox
      x.fillRect(Math.round(px) - 3, Math.round(py) - 2, 5, 3)
      quads++
    }
  }
  x.globalAlpha = 1
  c.quads = quads
  return c
}

// ── drawing ────────────────────────────────────────────────────────────────────────────────

const DIAMOND = (x, sx, sy) => {
  x.moveTo(sx, sy); x.lineTo(sx + 16, sy + 8); x.lineTo(sx, sy + 16); x.lineTo(sx - 16, sy + 8)
  x.closePath()
}

function patternFor(x, img, six) {
  const p = x.createPattern(img, 'repeat')
  p.setTransform(new DOMMatrix([six[0], six[1], six[2], six[3], six[4], six[5]]))
  return p
}

/** The baked ground, at 1x, for the whole field. Cached per treatment-B state. */
export function bakeGround(scene, useB) {
  const { c, x } = canvasOf(scene.fieldW, scene.fieldH)
  const off = scene.offsetX
  const src = useB ? scene.mapped : scene.images
  const geo = scene.roadGeom
  scene.layers.forEach((l, li) => {
    if (l.shapes.length === 0) return
    if (l.kind === 'road') {
      for (const [tone, pick] of [[scene.roadShoulderLight, 'light'], [scene.roadShoulderDark, 'dark']]) {
        // the product lays LIGHT then DARK; both are flat palette tones, so B moves them too
        x.beginPath()
        for (const [sx, sy, k] of l.shapes) {
          if (k < 0) continue
          for (const poly of geo[k][pick]) {
            x.moveTo(sx + off + poly[0], sy + poly[1])
            for (let i = 2; i < poly.length; i += 2) x.lineTo(sx + off + poly[i], sy + poly[i + 1])
            x.closePath()
          }
        }
        x.fillStyle = toneCss(tone, useB)
        x.fill()
      }
    }
    const trace = () => {
      x.beginPath()
      for (const [sx, sy, k] of l.shapes) {
        if (k < 0) { DIAMOND(x, sx + off, sy); continue }
        for (const poly of geo[k].ribbon) {
          x.moveTo(sx + off + poly[0], sy + poly[1])
          for (let i = 2; i < poly.length; i += 2) x.lineTo(sx + off + poly[i], sy + poly[i + 1])
          x.closePath()
        }
      }
    }
    const img = l.material === null ? null : src.get(l.material)
    trace()
    if (img === null) { x.fillStyle = toneCss(l.fallback, useB); x.fill(); return }
    x.fillStyle = patternFor(x, img, l.matrix)
    x.fill()
    trace()
    x.globalAlpha = scene.octaveAlpha
    x.fillStyle = patternFor(x, img, l.octave)
    x.fill()
    x.globalAlpha = 1
  })
  return c
}

const toneCss = (n, useB) => {
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  if (useB) { const d = new Uint8ClampedArray([r, g, b, 255]); mapPixels(d); r = d[0]; g = d[1]; b = d[2] }
  return `rgb(${r|0},${g|0},${b|0})`
}

/** The sprite's silhouette in flat ink, cached — the cast shadow and nothing else uses it. */
function silhouette(scene, s, src) {
  const key = `${s.cell}:${src === scene.mapped}`
  let hit = scene.silhouettes.get(key)
  if (hit === undefined) {
    const im = src.get(s.cell)
    const { c, x } = canvasOf(im.width, im.height)
    x.drawImage(im, 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = SHADOW_INK
    x.fillRect(0, 0, c.width, c.height)
    hit = c
    scene.silhouettes.set(key, hit)
  }
  return hit
}

/**
 * The eaves line: the row at which the silhouette is widest. Above it is roof, below it is
 * wall. It is a stand-in for a face mask the art does not carry, and the report says so —
 * shipping C properly means either a per-cell mask or the light authored into the cell.
 */
function eavesRow(scene, s, src) {
  const key = `eaves:${s.cell}`
  let hit = scene.silhouettes.get(key)
  if (hit === undefined) {
    const im = src.get(s.cell)
    const { c, x } = canvasOf(im.width, im.height)
    x.drawImage(im, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let best = 0, bestW = -1
    for (let y = 0; y < c.height; y++) {
      let lo = -1, hi = -1
      for (let px = 0; px < c.width; px++) {
        if (d[(y * c.width + px) * 4 + 3] > 40) { if (lo < 0) lo = px; hi = px }
      }
      if (hi - lo > bestW) { bestW = hi - lo; best = y }
    }
    hit = { row: best, lo: 0, hi: c.width }
    scene.silhouettes.set(key, hit)
  }
  return hit
}

/** Treatment C on one cell: roof kept, the screen-right wall taken down to FACE_MULT.right. */
function litCell(scene, s, src) {
  const key = `lit:${s.cell}:${src === scene.mapped}`
  let hit = scene.silhouettes.get(key)
  if (hit === undefined) {
    const im = src.get(s.cell)
    const { c, x } = canvasOf(im.width, im.height)
    const ev = eavesRow(scene, s, src)
    x.drawImage(im, 0, 0)
    x.globalCompositeOperation = 'multiply'
    // walls: a horizontal ramp from the lit SW face to the shaded SE face
    const wall = x.createLinearGradient(0, 0, c.width, 0)
    const L = Math.round(255 * FACE_MULT.left), R = Math.round(255 * FACE_MULT.right)
    wall.addColorStop(0, `rgb(255,255,255)`)
    wall.addColorStop(0.42, `rgb(${L},${L},${L})`)
    wall.addColorStop(1, `rgb(${R},${R},${R})`)
    x.fillStyle = wall
    x.fillRect(0, ev.row, c.width, c.height - ev.row)
    // roof: the same direction at a quarter of the strength, so it is not a flat card
    const roof = x.createLinearGradient(0, 0, c.width, 0)
    const RR = Math.round(255 * (1 - (1 - FACE_MULT.right) * 0.28))
    roof.addColorStop(0, 'rgb(255,255,255)')
    roof.addColorStop(1, `rgb(${RR},${RR},${RR})`)
    x.fillStyle = roof
    x.fillRect(0, 0, c.width, ev.row)
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(im, 0, 0)
    hit = c
    scene.silhouettes.set(key, hit)
  }
  return hit
}

const CANOPY_LIT_MULT = 0.82   // a canopy is a billboard: one flat step, no eaves to find

/**
 * Draw the whole frame at 1x into `x`, already translated so that world (0,0) is at the
 * canvas origin. `t` is the treatment state.
 */
export function drawFrame(scene, x, t, timeMs) {
  const src = t.b ? scene.mapped : scene.images
  const off = scene.offsetX

  // 1. ground
  x.drawImage(t.b ? scene.groundB : scene.groundA, -off, 0)
  if (t.a) x.drawImage(t.b ? scene.wornB : scene.wornA, -off, 0)

  // 2. groundDecal — shimmer, then scatter, then canopies (the product's own order)
  for (const d of scene.decorations) {
    if (d.kind !== 'shimmer') continue
    const sway = t.m ? Math.sin(timeMs / 900 + d.x * 0.7 + d.y) * 0.5 : 0
    x.fillStyle = t.b ? '#ffffff' : '#ffffff'
    x.globalAlpha = t.m ? 0.55 + 0.45 * Math.sin(timeMs / 700 + d.x + d.y) : 1
    x.fillRect(Math.round(d.sx + sway), d.sy, scene.canopy.shimmerPx.w, scene.canopy.shimmerPx.h)
    x.globalAlpha = 1
  }

  if (t.a) {
    for (const p of scene.scatter) {
      x.save()
      const sway = t.m ? Math.sin(timeMs / 1100 + (p.h & 63)) * 0.9 : 0
      x.translate(Math.round(p.sx + sway), Math.round(p.sy))
      if (t.c) {
        x.globalAlpha = CONTACT_SHADOW_ALPHA * 0.8
        x.fillStyle = SHADOW_INK
        x.fillRect(-3, -1, 7, 2)
        x.globalAlpha = 1
      }
      p.prop.d(x, p.h)
      x.restore()
    }
  }

  // 3. shadow layer — ONE pass, under every body, which is what `layers.ts` already reserves
  //    it for ("every contact shadow, for every body and every structure"). Drawing a cast
  //    shadow beside its own sprite instead would let a near building's shadow fall across a
  //    far one, which is the bug this layer exists to prevent.
  if (t.c) {
    for (const s of scene.structures) {
      if (s.cell === null) continue
      const im = src.get(s.cell)
      const w = im.width * s.scale, h = im.height * s.scale
      castShadow(x, silhouette(scene, s, src), s.sx - s.anchorX * w, s.sy - s.anchorY * h,
        w, h, s.sy, CAST_SHADOW_ALPHA)
    }
    for (const d of scene.decorations) {
      if (d.kind !== 'tree') continue
      castShadow(x, treeSilhouette(scene), d.sx - scene.canopy.px.w / 2,
        d.sy - scene.canopy.px.h, scene.canopy.px.w, scene.canopy.px.h, d.sy,
        CAST_SHADOW_ALPHA * 0.85)
    }
    x.globalAlpha = CONTACT_SHADOW_ALPHA
    x.fillStyle = SHADOW_INK
    for (const s of scene.structures) {
      const rx = (s.w + s.h) * 8 * 0.48
      x.beginPath()
      x.ellipse(s.sx, s.sy - 2, rx, rx / 2, 0, 0, Math.PI * 2)
      x.fill()
    }
    for (const d of scene.decorations) {
      if (d.kind !== 'tree') continue
      x.beginPath()
      x.ellipse(d.sx, d.sy - 1, 6, 3, 0, 0, Math.PI * 2)
      x.fill()
    }
    x.globalAlpha = 1
  }

  // 4. entities — the only depth-sorted layer
  const items = [
    ...scene.structures.map((s) => ({ s, key: s.sy * 4 + s.sx / 1000, tree: false })),
    ...scene.decorations.filter((d) => d.kind === 'tree')
      .map((d) => ({ s: d, key: d.sy * 4 + d.sx / 1000, tree: true })),
  ].sort((p, q) => p.key - q.key)

  for (const it of items) {
    if (it.tree) { drawTree(scene, x, it.s, t, timeMs); continue }
    const s = it.s
    if (s.cell === null) continue
    const im = src.get(s.cell)
    const w = im.width * s.scale, h = im.height * s.scale
    const left = s.sx - s.anchorX * w, top = s.sy - s.anchorY * h
    x.drawImage(t.c ? litCell(scene, s, src) : im, left, top, w, h)
  }
}

/**
 * One silhouette, laid flat on the ground plane. A point `dh` screen px above the foot line
 * lands `dh · SHADOW_STEP` away from it, which is the whole of the projection: the shear is
 * the sun, and nothing else in the frame has to agree to anything.
 */
function castShadow(x, sil, left, top, w, h, footY, alpha) {
  const Sx = SHADOW_STEP.x, Sy = SHADOW_STEP.y
  x.save()
  x.globalAlpha = alpha
  x.transform(1, 0, -Sx, -Sy, Sx * footY, footY * (1 + Sy))
  x.drawImage(sil, left, top, w, h)
  x.restore()
}

let TREE_SIL = null
function treeSilhouette(scene) {
  if (TREE_SIL === null) {
    const { c, x } = canvasOf(scene.canopy.px.w, scene.canopy.px.h)
    x.fillStyle = SHADOW_INK
    for (const b of scene.canopy.blocks) x.fillRect(b.x, b.y, b.w, b.h)
    TREE_SIL = c
  }
  return TREE_SIL
}

function drawTree(scene, x, d, t, timeMs) {
  const sway = t.m ? Math.sin(timeMs / 1600 + d.x * 0.6 + d.y * 0.3) * 0.8 : 0
  const x0 = Math.round(d.sx - scene.canopy.px.w / 2 + sway)
  const y0 = d.sy - scene.canopy.px.h
  for (const b of scene.canopy.blocks) {
    let col = b.color
    if (t.b) { const u = new Uint8ClampedArray([(col >> 16) & 255, (col >> 8) & 255, col & 255, 255]); mapPixels(u); col = (u[0] << 16) | (u[1] << 8) | u[2] }
    if (t.c) {
      const k = b.x + b.w / 2 > scene.canopy.px.w / 2 ? CANOPY_LIT_MULT : 1
      const r = (((col >> 16) & 255) * k) | 0, g = (((col >> 8) & 255) * k) | 0, bl = ((col & 255) * k) | 0
      x.fillStyle = `rgb(${r},${g},${bl})`
    } else {
      x.fillStyle = `#${col.toString(16).padStart(6, '0')}`
    }
    x.fillRect(x0 + b.x, y0 + b.y, b.w, b.h)
  }
}

// ── measuring the frame ────────────────────────────────────────────────────────────────────

/** What the stat strip reports, read off the pixels of the frame that is on screen. */
export function frameStats(imageData) {
  const d = imageData.data
  const hist = new Uint32Array(256)
  let n = 0
  // Transparent pixels are the VOID past the painted ground, not black ground. Counting them
  // put "below 25 %" at 50.3 % on the whole-town camera and made the baseline look like it had
  // deep shadows in it.
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    hist[Math.round(REC709(d[i], d[i + 1], d[i + 2]))]++
    n++
  }
  if (n === 0) return { p2: 0, p50: 0, p98: 0, mean: 0, sd: 0, darkFrac: 0, liteFrac: 0 }
  const at = (q) => {
    let acc = 0
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v }
    return 255
  }
  let sum = 0, sum2 = 0
  for (let v = 0; v < 256; v++) { sum += v * hist[v]; sum2 += v * v * hist[v] }
  const mean = sum / n
  return {
    p2: at(0.02), p50: at(0.5), p98: at(0.98), mean,
    sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    darkFrac: hist.slice(0, 64).reduce((a, b) => a + b, 0) / n,
    liteFrac: hist.slice(200).reduce((a, b) => a + b, 0) / n,
  }
}
