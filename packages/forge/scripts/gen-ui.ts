// LIVE — the Signpost UI's rasters (stage 7). Cap $UI_CAP. Every piece lands twice: in
// `content/ui` beside its manifest, and in `packages/web/src/ui/px`, which is the directory the
// web bundler resolves `frame-cream.png` and its siblings from.
// Controls: UI_ONLY=<comma ids>, UI_ATTEMPTS, UI_DRY=1, UI_REJECTED=<candidate keys>.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { paletteSwatchPng } from '../src/referenceSheet.js'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { keyBg } from '../src/post/chromaKey.js'
import { erodeAlpha, opaqueBbox } from '../src/sheet.js'
import { spriteCell } from '../src/reCell.js'
import { PALETTE_DISTANCE_MAX, magentaPixels, paletteDistance } from '../src/pixelGates.js'
import { refusalMessage } from '../src/gate.js'
import { UI_CONTENT_DIR, UI_PIECE_IDS, UI_PX_DIR } from '../src/uiAssets.js'
import { GEN_MODEL, PALETTE_WORDS, imageGen } from './lib/cells.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.UI_CAP ?? '1.20')
const ATTEMPTS = Math.max(1, Number(process.env.UI_ATTEMPTS ?? '2'))
const DRY = process.env.UI_DRY === '1'
const ONLY = (process.env.UI_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// A candidate named here is one a human LOOKED AT and refused, so it is never chosen however
// clean its numbers are. The eye is the gate the gates cannot be.
const REJECTED = new Set(
  (process.env.UI_REJECTED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

const S = scratch('ui')
const RAWS = `${S}/raws`
// The long axis of the widest generated piece is 128, so 1024 is eight whole pixels per one.
const GEN_PX = 1024
// A subject drawn smaller than this fraction of its piece came back too small to cut.
const FILL_MIN = 0.7
// The same blend band `spriteCell` erodes: a JPEG magenta field rings into the subject's edge.
const CHROMA_BAND_PX = 4

// ── the palette, as the approved sketch uses it ───────────────────────────────────────────
type RGBA = readonly [number, number, number, number]
const INK: RGBA = [0x32, 0x2b, 0x38, 255]
const PARCHMENT: RGBA = [0xf6, 0xe8, 0xd5, 255]
const INNER_CREAM: RGBA = [0xe8, 0xd5, 0xbc, 255]
const PLATE: RGBA = [0x7e, 0x51, 0x2b, 255]
const PLATE_LIP: RGBA = [0x5d, 0x3f, 0x20, 255]
const PLATE_TOP: RGBA = [0xa6, 0x6e, 0x38, 255]
const HONEY: RGBA = [0xc6, 0x8a, 0x48, 255]
const HONEY_LIT: RGBA = [0xf2, 0xc8, 0x79, 255]

// ── the painters ──────────────────────────────────────────────────────────────────────────
const canvas = (w: number, h: number): RawImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h * 4),
})

function put(img: RawImage, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  img.data.set(c, (y * img.width + x) * 4)
}

/** A nine-slice panel: an ink border, an optional inner ring and a flat field, with a corner
 *  notch as deep as the border — the notch is what makes a pixel frame read as rounded. */
function panel(
  w: number,
  h: number,
  o: { border: number; edge: RGBA; fill: RGBA; inner?: { width: number; colour: RGBA } },
): RawImage {
  const img = canvas(w, h)
  const ring = o.inner
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = Math.min(x, w - 1 - x, y, h - 1 - y)
      if (Math.min(x, w - 1 - x) < o.border && Math.min(y, h - 1 - y) < o.border) continue
      const inRing = ring !== undefined && n < o.border + ring.width
      put(img, x, y, n < o.border ? o.edge : inRing ? ring.colour : o.fill)
    }
  return img
}

/** One row of a panel's field, inside its one-pixel border. */
function band(img: RawImage, y: number, c: RGBA): void {
  for (let x = 1; x < img.width - 1; x++) put(img, x, y, c)
}

/** The ring marker: the town's 2:1 diamond — `size` across and half that tall — ink-edged, its
 *  top facet catching the north-west light every other diamond on the stage catches. */
function pip(size: number): RawImage {
  const img = canvas(size, size)
  const rows = size / 2
  for (let r = 0; r < rows; r++) {
    const hw = 2 * (Math.min(r, rows - 1 - r) + 1)
    for (let x = size / 2 - hw; x < size / 2 + hw; x++) {
      const edge = x < size / 2 - hw + 2 || x >= size / 2 + hw - 2 || r < 1 || r >= rows - 1
      put(img, x, size / 4 + r, edge ? INK : r < rows / 2 ? HONEY_LIT : HONEY)
    }
  }
  return img
}

/** The nameplate: a plate with a lit top row and a darker bottom lip inside its ink border. */
function nameplate(w: number, h: number): RawImage {
  const img = panel(w, h, { border: 1, edge: INK, fill: PLATE })
  band(img, 1, PLATE_TOP)
  band(img, h - 3, PLATE_LIP)
  band(img, h - 2, PLATE_LIP)
  return img
}

// ── pieces ────────────────────────────────────────────────────────────────────────────────
/** A piece is EITHER drawn by the model from a `gen` subject or code-painted here, never both:
 *  the two halves of the run below are the two halves of this union. */
type UiPiece = { id: string; w: number; h: number; slice?: number; note: string } & (
  | { gen: string; paint?: never }
  | { gen?: never; paint: () => RawImage }
)

const PIECES: readonly UiPiece[] = [
  {
    id: 'signpost-arm',
    w: 128,
    h: 32,
    gen:
      'a single SIGNPOST ARM: one straight machine-cut plank of honey-brown wood lying ' +
      'HORIZONTAL, four times as wide as it is tall, with its RIGHT-HAND end cut to a blunt ' +
      'ARROW POINT and its left end cut square. Plain sawn timber with a soft lengthwise grain ' +
      'and a slightly darker chamfered lower edge. Its face is COMPLETELY BLANK',
    note: 'the four signpost arms; the label is rendered text, never baked in',
  },
  {
    id: 'signpost-post',
    w: 16,
    h: 96,
    gen:
      'a single SIGNPOST POST: ONE long NARROW VERTICAL bar of honey-brown wood standing on ' +
      'end. It is SIX TIMES AS TALL AS IT IS WIDE — a slender upright column, NOT a plank, NOT ' +
      'a beam, NOT a log. It stands nearly the full HEIGHT of the frame, top to bottom, and it ' +
      'is so narrow that WIDE EMPTY MAGENTA MARGINS are left to its left and to its right. Its ' +
      'top is cut flat and its foot is cut square. Plain sawn timber with a soft lengthwise ' +
      'grain and a slightly darker right-hand side. Nothing is fixed to it, no arm, no sign, ' +
      'no board, and its faces are COMPLETELY BLANK',
    note: 'the post the arms hang from',
  },
  {
    id: 'paper',
    w: 96,
    h: 96,
    slice: 24,
    note: 'the sheet that rises; stretch, never tile',
    // 3 px of ink over a 3 px cream ring: the sketch's `border: 3px` and `inset 0 0 0 3px`.
    paint: () =>
      panel(96, 96, {
        border: 3,
        edge: INK,
        fill: PARCHMENT,
        inner: { width: 3, colour: INNER_CREAM },
      }),
  },
  {
    id: 'nameplate',
    w: 32,
    h: 16,
    slice: 4,
    note: 'under a hovered or selected figure',
    paint: () => nameplate(32, 16),
  },
  {
    id: 'ring-pip',
    w: 24,
    h: 24,
    note: 'optional: the subject ring marker',
    paint: () => pip(24),
  },
]

// The roster W1 and W2 import and the subjects drawn here are one decision, so a piece that
// drifts off either list is a failure of this script and not a surprise in the gate later.
if (PIECES.map((p) => p.id).join() !== UI_PIECE_IDS.join())
  throw new Error(`PIECES: ${PIECES.map((p) => p.id).join()} is not UI_PIECE_IDS`)

// ── the generated pieces ──────────────────────────────────────────────────────────────────
// STYLE_PROMPT draws the town in 2:1 dimetric. A signpost the chrome hangs in a corner is a flat
// cut-out, so this overrides the projection the way the interior wall clause does.
const FLAT_CLAUSE =
  'A SQUARE-ON, FACE-ON view of ONE small wooden object, drawn perfectly FLAT with NO ' +
  'perspective, NO isometric angle and NO three-dimensional turn — the object is seen straight ' +
  'on, as a flat cut-out. It is centred, lies along the frame, and fills about two thirds of ' +
  'the frame on its long axis. NOTHING else is in the frame: no ground, no post, no signboard, ' +
  'no second object, no scenery, no cast shadow.'

// The setting, positively and in detail — naming the period is what stands between a swatch and
// a fairytale signpost. Verbatim from gen-structures-v5.ts, which is where it was measured.
const PERIOD = [
  'PRESENT DAY, not historical: this is a small remote modern farming village, the kind of',
  'place that still mends its own tools but has electric light and glazed windows.',
  'Anything built must look CONTEMPORARY and lived-in: machine-cut timber, galvanised metal,',
  'painted trim, plain modern hardware.',
  'ABSOLUTELY NOT medieval, NOT fairytale, NOT a ruin.',
  'NO thatch, NO half-timbering, NO arched or round-topped openings, NO iron strap hinges,',
  'NO rough undressed fieldstone, NO wattle, NO daub, NO rope-and-log lashings on sawn timber.',
  'Weathered and warm and a little worn, but built in the last century.',
].join(' ')

function prompt(p: UiPiece): string {
  return (
    `${STYLE_PROMPT} ${FLAT_CLAUSE} ` +
    `Subject: ${p.gen}. ${PERIOD} ` +
    'The reference image is a COLOUR CHART, not an object. It carries the palette and nothing ' +
    'else. There is NO object to copy anywhere in this request — invent the form from the ' +
    `description alone. ${PALETTE_WORDS} ` +
    'NO text, NO words, NO letters, NO numbers, NO labels, NO carving, NO watermark anywhere.'
  )
}

/** The audited chain cuts a SQUARE cell and takes its factor from the subject's LONG side; a
 *  signpost arm is 4:1, so that factor overflows the short side. The factor a non-square piece
 *  needs is whichever axis wants the bigger one, and `spriteCell` yields it for a cell of
 *  `subjectPx / factor`. Then trim to the subject and centre it — still one whole division. */
function cut(p: UiPiece, gen: RawImage): { img: RawImage; factor: number; fill: number } {
  const keyed = keyBg(gen)
  const src = opaqueBbox(erodeAlpha(keyed, CHROMA_BAND_PX))
  if (!src) throw new Error('cut: the chroma band erased the subject')
  const sw = src.x1 - src.x0 + 1,
    sh = src.y1 - src.y0 + 1
  const factor = Math.max(1, Math.ceil(sw / p.w), Math.ceil(sh / p.h))
  const r = spriteCell(keyed, {
    cellPx: Math.ceil(Math.max(sw, sh) / factor),
    anchor: 'centre',
  })
  const b = opaqueBbox(r.cell)
  if (!b) throw new Error('cut: nothing opaque in the cell')
  const bw = b.x1 - b.x0 + 1,
    bh = b.y1 - b.y0 + 1
  if (bw > p.w || bh > p.h) throw new Error(`cut: subject ${bw}x${bh} does not fit ${p.w}x${p.h}`)
  const img = canvas(p.w, p.h)
  const dx = (p.w - bw) >> 1,
    dy = (p.h - bh) >> 1
  for (let y = 0; y < bh; y++) {
    const off = ((y + b.y0) * r.cell.width + b.x0) * 4
    img.data.set(r.cell.data.subarray(off, off + bw * 4), ((y + dy) * p.w + dx) * 4)
  }
  return { img, factor: r.plan.factor, fill: Math.min(bw / p.w, bh / p.h) }
}

/** What may refuse a generated piece, and the distance the report prints either way. A painted
 *  piece is refused by the eye, not by arithmetic. */
function gateOf(img: RawImage, fill: number): { fails: string[]; dist: number } {
  const fails: string[] = []
  if (fill < FILL_MIN)
    fails.push(`subject fills ${(fill * 100).toFixed(1)}% of the piece, floor ${FILL_MIN * 100}%`)
  const magenta = magentaPixels(img)
  if (magenta > 0) fails.push(`${magenta} background pixels survived the cut`)
  const dist = paletteDistance(img)
  if (dist > PALETTE_DISTANCE_MAX)
    fails.push(`palette distance ${dist.toFixed(1)} over ${PALETTE_DISTANCE_MAX}`)
  return { fails, dist }
}

// ── the contact sheet ─────────────────────────────────────────────────────────────────────
function blit(dst: RawImage, src: RawImage, x0: number, y0: number, zoom: number): void {
  for (let y = 0; y < src.height * zoom; y++)
    for (let x = 0; x < src.width * zoom; x++) {
      const s = (Math.floor(y / zoom) * src.width + Math.floor(x / zoom)) * 4
      if (src.data[s + 3] === 0) continue
      dst.data.set(src.data.subarray(s, s + 4), ((y0 + y) * dst.width + x0 + x) * 4)
    }
}

/** A nine-slice drawn at a size it will really be used at: corners fixed, edges and middle
 *  stretched, which is what makes a seam in the art show up as a seam on the sheet. */
function stretch(src: RawImage, slice: number, w: number, h: number): RawImage {
  const out = canvas(w, h)
  const map = (i: number, n: number, sn: number): number =>
    i < slice
      ? i
      : i >= n - slice
        ? sn - (n - i)
        : slice + ((i - slice) * (sn - 2 * slice)) / (n - 2 * slice)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s =
        (Math.min(src.height - 1, Math.floor(map(y, h, src.height))) * src.width +
          Math.min(src.width - 1, Math.floor(map(x, w, src.width)))) *
        4
      out.data.set(src.data.subarray(s, s + 4), (y * w + x) * 4)
    }
  return out
}

/** Every shipped piece at 6x beside, for a nine-slice, the same art stretched to a size it will
 *  really be drawn at and then doubled. The eye judges this before anything is signed. */
function contactSheet(shipped: readonly { p: UiPiece; img: RawImage }[]): RawImage {
  const ZOOM = 6
  const PAD = 16
  const rows = shipped.map(({ p, img }) => {
    // A stretched preview only means anything at a size that has some middle to stretch.
    const used =
      p.slice === undefined ? null : stretch(img, p.slice, 2 * p.slice + 120, 2 * p.slice + 16)
    return {
      img,
      used,
      w: img.width * ZOOM + (used === null ? 0 : used.width * 2 + PAD),
      h: Math.max(img.height * ZOOM, (used?.height ?? 0) * 2) + PAD,
    }
  })
  const sheet = canvas(
    Math.max(...rows.map((r) => r.w)) + 2 * PAD,
    rows.reduce((a, r) => a + r.h, 0) + PAD,
  )
  // A mid grey with a darker check, so a hole in the alpha shows and a fringe is not hidden.
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++)
      put(sheet, x, y, ((x >> 3) + (y >> 3)) % 2 === 0 ? [96, 96, 96, 255] : [72, 72, 72, 255])
  let y = PAD
  for (const r of rows) {
    blit(sheet, r.img, PAD, y, ZOOM)
    if (r.used !== null) blit(sheet, r.used, PAD + r.img.width * ZOOM + PAD, y, 2)
    y += r.h
  }
  return sheet
}

// ── the run ───────────────────────────────────────────────────────────────────────────────
type Provenance =
  | { source: 'code-painted'; painter: string }
  | {
      source: 'generated'
      model: string
      genPx: number
      factor: number
      promptSha256: string
      usd: number
      candidate: string
    }

const pieces = PIECES.filter((p) => ONLY.length === 0 || ONLY.includes(p.id))
if (pieces.length === 0) throw new Error(`UI_ONLY=${ONLY.join(',')} matches no piece`)
const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)
console.log(`gen-ui ${DRY ? 'DRY' : 'LIVE'} — ${pieces.length} pieces, gen ${GEN_PX}, cap $${CAP}`)

const swatch = await paletteSwatchPng()
mkdirSync(RAWS, { recursive: true })
mkdirSync(`${S}/cells`, { recursive: true })
mkdirSync(UI_CONTENT_DIR, { recursive: true })

const manifest: Record<string, unknown> = {}
const shipped: { p: UiPiece; img: RawImage }[] = []
const rows: string[] = []
const lines: string[] = []
const refused: string[] = []

for (const p of pieces) {
  console.log(`\n== ${p.id} (${p.w}x${p.h}${p.slice === undefined ? '' : `, slice ${p.slice}`}) ==`)
  let img: RawImage
  let prov: Provenance

  if (p.gen === undefined) {
    img = p.paint()
    prov = { source: 'code-painted', painter: 'gen-ui.ts' }
    lines.push(`${p.id}: code-painted`)
  } else {
    const assetId = `ui:${p.id}`
    const text = prompt(p)
    type Cand = { key: string; img: RawImage; factor: number; fails: string[] }
    const cands: Cand[] = []

    for (let i = 0; i < ATTEMPTS; i++) {
      const key = `${p.id}-c${i}`
      const path = `${RAWS}/${key}.png`
      let buf: Buffer
      if (existsSync(path)) {
        buf = readFileSync(path)
        console.log(`  ${key}: cached`)
      } else {
        if (DRY) {
          console.log(`  ${key}: DRY, skipped`)
          continue
        }
        const reserve = 0.08
        if (budget.total + reserve > CAP)
          throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${CAP})`)
        const r = await imageGen({
          key: KEY,
          prompt: text,
          size: `${GEN_PX}x${GEN_PX}`,
          refs: [swatch],
        })
        const cost = r.cost ?? reserve
        budget.spend(cost)
        ledger.append({ assetId, kind: 'image_gen', model: GEN_MODEL, usd: cost }) // $5 stop
        ledger.flush()
        writeFileSync(path, r.raw)
        buf = r.raw
        console.log(`  ${key}: generated $${cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
      }
      try {
        const c = cut(p, await decodePng(buf))
        const { fails, dist } = gateOf(c.img, c.fill)
        const rej = REJECTED.has(key)
        if (!rej) cands.push({ key, img: c.img, factor: c.factor, fails })
        writeFileSync(`${S}/cells/${key}.png`, await encodePng(c.img))
        const msg =
          `${p.id}: ${key} factor ${c.factor}, fill ${(c.fill * 100).toFixed(1)}%, ` +
          `palette distance ${dist.toFixed(1)}, ` +
          (fails.length === 0 ? 'gates clean' : fails.join('; ')) +
          (rej ? ' — REFUSED BY EYE' : '')
        lines.push(msg)
        console.log(`  ${msg}`)
        if (fails.length === 0 && !rej) break
      } catch (e) {
        const msg = `${p.id}: ${key} process FAILED — ${String(e).slice(0, 200)}`
        lines.push(msg)
        console.log(`  ${msg}`)
      }
    }

    // Among the CLEAN candidates only (the ruling and its reason are in src/gate.ts).
    const win = cands.find((c) => c.fails.length === 0)
    if (!win) {
      const why =
        refusalMessage(
          p.id,
          cands.map((c) => ({ key: c.key, failures: c.fails })),
        ) || `${p.id}: NO CANDIDATE — every attempt failed to process`
      lines.push(why)
      console.log(`  ${why}`)
      refused.push(p.id)
      continue
    }
    img = win.img
    prov = {
      source: 'generated',
      model: GEN_MODEL,
      genPx: GEN_PX,
      factor: win.factor,
      promptSha256: createHash('sha256').update(text).digest('hex'),
      // What the SHIPPED piece cost, which is every attempt it took and not only the winner.
      usd: Number(ledger.totalFor(assetId).toFixed(4)),
      candidate: win.key,
    }
  }

  const file = `${p.id}.png`
  const png = await encodePng(img)
  writeFileSync(join(UI_CONTENT_DIR, file), png)
  writeFileSync(join(UI_PX_DIR, file), png)
  manifest[p.id] = { file, w: p.w, h: p.h, slice: p.slice ?? null, note: p.note, provenance: prov }
  shipped.push({ p, img })
  rows.push(
    `| ${p.id} | ${p.w}x${p.h} | ${p.slice ?? '—'} | ${prov.source} | ` +
      `${prov.source === 'generated' ? `$${prov.usd.toFixed(4)}` : '$0'} |`,
  )
}

// A partial manifest would name a piece the web cannot find, so it is rewritten only whole.
if (refused.length === 0)
  writeFileSync(
    join(UI_CONTENT_DIR, 'manifest.json'),
    `${JSON.stringify({ version: 'v1-signpost-ui', pieces: manifest }, null, 2)}\n`,
  )
writeFileSync(`${S}/contact-sheet.png`, await encodePng(contactSheet(shipped)))

const md = [
  '# the Signpost UI rasters',
  '',
  '| piece | px | slice | source | spend |',
  '|---|---|---|---|---|',
  ...rows,
  '',
  '## every attempt',
  '',
  ...lines.map((l) => `- ${l}`),
  '',
  `spend: $${budget.total.toFixed(4)} of $${CAP} cap`,
  `contact sheet: ${S}/contact-sheet.png`,
].join('\n')
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/ui.md`, md)
console.log(`\n${md}`)

// The report is written FIRST and then the run fails: the margins are what tell an operator a
// threshold from a bad drawing, and they are worthless if the failure eats them.
if (refused.length > 0)
  throw new Error(
    `${refused.length} piece(s) shipped nothing: ${refused.join(', ')}\n  Raise UI_ATTEMPTS ` +
      'to draw more, UI_REJECTED to refuse a candidate by eye, or code-paint the piece. The ' +
      'manifest was NOT rewritten.',
  )
