// The seven interior floor and wall pieces, written as COMMITTED content.
// Controls: INT_ONLY, INT_ATTEMPTS, INT_DRY=1, INT_REJECTED.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { paletteSwatchPng } from '../src/referenceSheet.js'
import { decodePng, encodePng, encodeWebp, type RawImage } from '../src/post/raw.js'
import { keyBg } from '../src/post/chromaKey.js'
import { erodeAlpha, opaqueBbox } from '../src/sheet.js'
import { INTERIORS_CONTENT_DIR, INTERIOR_PIECES, type InteriorPiece } from '../src/interiorArt.js'
import { cropToGrid, seamReport, seamlessMaterial, toMaterialGrid } from '../src/terrainGen.js'
import { PALETTE_DISTANCE_MAX, paletteDistance } from '../src/pixelGates.js'
import { refusalMessage } from '../src/gate.js'
import { GEN_MODEL, PALETTE_WORDS, imageGen } from './lib/cells.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.INT_CAP ?? '2.50')
const ATTEMPTS = Math.max(1, Number(process.env.INT_ATTEMPTS ?? '2'))
const DRY = process.env.INT_DRY === '1'
const ONLY = (process.env.INT_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// A candidate named here was refused by eye, so it is never chosen however clean its numbers are.
const REJECTED = new Set(
  (process.env.INT_REJECTED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

const S = scratch('int')
const RAWS = `${S}/raws`
// Square, and four times the widest piece: every cut below is then a whole factor of it.
const GEN_PX = 1024
// The same blend band `spriteCell` erodes: a JPEG magenta field rings into the subject's edge.
const CHROMA_BAND_PX = 4

const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)

// A wall is an ELEVATION seen square-on; a floor is a material sampled continuously, so the two
// need opposite instructions.
const ROLE_CLAUSE: Record<InteriorPiece['role'], string> = {
  'floor-material':
    'A seamless, edge-wrapping, top-down FLOOR material, drawn flat and filling the whole ' +
    'frame corner to corner. Flat overhead view of the floor itself — no walls, no furniture, ' +
    'no objects standing on it, no shadows cast from outside, no vignette, no border, no ' +
    'frame. The left edge must continue into the right edge and the top edge into the bottom. ' +
    'Even lighting everywhere, and nothing distinctive the eye can lock onto and follow.',
  wall:
    'A SQUARE-ON ELEVATION of the inside face of one interior wall, drawn perfectly flat and ' +
    'face-on with NO perspective and NO angle — as if the wall were photographed straight on. ' +
    'It fills the frame from left edge to right edge, and stands the full height of the room: ' +
    'the ceiling line is at the very top of the frame and the floor line at the very bottom. ' +
    'NO floor is visible, NO ceiling is visible, NO side walls, NO furniture standing in front ' +
    'of it, NO people. Lit evenly from the upper left. ' +
    // Measured: without this clause the plaster came back at a mean of 184,97,115, on the
    // dusty-rose ramp.
    'The plaster is CREAM and the timber is HONEY-BROWN: warm, but on the cream-and-wood side ' +
    'of the palette. NOT pink, NOT rose, NOT mauve, NOT salmon, NOT terracotta anywhere.',
}

function prompt(p: InteriorPiece): string {
  return (
    `${STYLE_PROMPT} ${ROLE_CLAUSE[p.role]} ` +
    `Subject: ${p.desc}. ` +
    'The reference image is a COLOUR CHART, not a picture to copy. It carries the palette and ' +
    `nothing else. ${PALETTE_WORDS} ` +
    'NO text, NO words, NO labels, NO captions, NO watermark anywhere.'
  )
}

const cutPlan = (p: InteriorPiece, gen: RawImage): { factor: number; window: string } => {
  const factor = Math.max(1, Math.min(Math.floor(gen.width / p.w), Math.floor(gen.height / p.h)))
  return { factor, window: `${p.w * factor}x${p.h * factor}` }
}

// STYLE_PROMPT puts every subject on a magenta field and a window centred on the frame takes
// that field in with it, so the face is bboxed after keying and eroding.
function wallFace(gen: RawImage): { img: RawImage; x0: number; y0: number } {
  let keyed: RawImage
  try {
    keyed = erodeAlpha(keyBg(gen), CHROMA_BAND_PX)
  } catch {
    return { img: gen, x0: 0, y0: 0 } // the model filled the frame: nothing to trim to
  }
  const b = opaqueBbox(keyed)
  if (b === null) return { img: gen, x0: 0, y0: 0 }
  const w = b.x1 - b.x0 + 1,
    h = b.y1 - b.y0 + 1
  const img: RawImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  for (let y = 0; y < h; y++) {
    const src = ((y + b.y0) * gen.width + b.x0) * 4
    img.data.set(gen.data.subarray(src, src + w * 4), y * w * 4)
  }
  return { img, x0: b.x0, y0: b.y0 }
}

// Whole-factor division of the generation's own pixels, never resampled.
function cut(p: InteriorPiece, gen: RawImage): RawImage {
  if (p.role === 'floor-material')
    return seamlessMaterial(toMaterialGrid(cropToGrid(gen, p.w), p.w))
  const face = wallFace(gen)
  const { factor } = cutPlan(p, face.img)
  const ww = p.w * factor,
    wh = p.h * factor
  const x0 = (face.img.width - ww) >> 1,
    y0 = (face.img.height - wh) >> 1
  const window: RawImage = { width: ww, height: wh, data: new Uint8ClampedArray(ww * wh * 4) }
  for (let y = 0; y < wh; y++) {
    const src = ((y + y0) * face.img.width + x0) * 4
    window.data.set(face.img.data.subarray(src, src + ww * 4), y * ww * 4)
  }
  const out: RawImage = { width: p.w, height: p.h, data: new Uint8ClampedArray(p.w * p.h * 4) }
  const mid = (v: number[]): number => v.sort((a, b) => a - b)[v.length >> 1]!
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const rs: number[] = [],
        gs: number[] = [],
        bs: number[] = []
      for (let sy = y * factor; sy < (y + 1) * factor; sy++)
        for (let sx = x * factor; sx < (x + 1) * factor; sx++) {
          const i = (sy * ww + sx) * 4
          rs.push(window.data[i]!)
          gs.push(window.data[i + 1]!)
          bs.push(window.data[i + 2]!)
        }
      out.data.set([mid(rs), mid(gs), mid(bs), 255], (y * p.w + x) * 4)
    }
  return out
}

function gateOf(p: InteriorPiece, img: RawImage): string[] {
  const fails: string[] = []
  if (img.width !== p.w || img.height !== p.h)
    fails.push(`size ${img.width}x${img.height}, wants ${p.w}x${p.h}`)
  for (let i = 3; i < img.data.length; i += 4)
    if (img.data[i] !== 255) {
      fails.push('alpha is not fully opaque')
      break
    }
  if (p.role === 'floor-material' && !seamReport(img).pass) fails.push('the wrap has a seam')
  let magenta = 0
  for (let i = 0; i < img.data.length; i += 4)
    if (img.data[i]! > 200 && img.data[i + 1]! < 70 && img.data[i + 2]! > 200) magenta++
  if (magenta > 0) fails.push(`${magenta} background pixels survived the cut`)
  // Measured: the pieces sit at 12.2-22.5 once the background is out of the cut.
  const dist = paletteDistance(img)
  if (dist > PALETTE_DISTANCE_MAX)
    fails.push(`palette distance ${dist.toFixed(1)} over ${PALETTE_DISTANCE_MAX}`)
  return fails
}

const pieces = INTERIOR_PIECES.filter((p) => ONLY.length === 0 || ONLY.includes(p.id))
if (pieces.length === 0) throw new Error(`INT_ONLY=${ONLY.join(',')} matches no interior piece`)
console.log(
  `gen-interiors ${DRY ? 'DRY' : 'LIVE'} — ${pieces.length} pieces, gen ${GEN_PX}, cap $${CAP}`,
)

const swatch = await paletteSwatchPng()
mkdirSync(RAWS, { recursive: true })
mkdirSync(`${S}/cells`, { recursive: true })

const rows: string[] = []
const lines: string[] = []
// Collected, not thrown on the spot: the unit of work is ONE PIECE, and a report of every
// attempt is worth more than an early exit.
const refused: string[] = []

for (const p of pieces) {
  console.log(`\n== ${p.id} (${p.role}, ${p.w}x${p.h}) ==`)
  const assetId = `interior:${p.id}`
  const spentBefore = ledger.totalFor(assetId)
  type Cand = { key: string; img: RawImage; factor: number; window: string; fails: string[] }
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
      const reserve = 0.12
      if (budget.total + reserve > CAP)
        throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${CAP})`)
      const r = await imageGen({
        key: KEY,
        prompt: prompt(p),
        size: `${GEN_PX}x${GEN_PX}`,
        refs: [swatch],
      })
      const cost = r.cost ?? reserve
      budget.spend(cost)
      ledger.append({ assetId, kind: 'image_gen', model: GEN_MODEL, usd: cost }) // $5 anomaly stop
      ledger.flush()
      writeFileSync(path, r.raw)
      buf = r.raw
      console.log(`  ${key}: generated $${cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
    }
    try {
      const gen = await decodePng(buf)
      const img = cut(p, gen)
      const plan = cutPlan(p, gen)
      const fails = gateOf(p, img)
      const rejected = REJECTED.has(key)
      if (!rejected) cands.push({ key, img, ...plan, fails })
      writeFileSync(`${S}/cells/${key}.png`, await encodePng(img))
      const msg =
        `${p.id}: ${key} gen ${gen.width}x${gen.height}, factor ${plan.factor}, ` +
        `window ${plan.window}, palette distance ${paletteDistance(img).toFixed(1)}, ` +
        (fails.length === 0 ? 'gates clean' : fails.join('; ')) +
        (rejected ? ' — REFUSED BY EYE' : '')
      lines.push(msg)
      console.log(`  ${msg}`)
      if (fails.length === 0 && !rejected) break
    } catch (e) {
      const msg = `${p.id}: ${key} process FAILED — ${String(e).slice(0, 200)}`
      lines.push(msg)
      console.log(`  ${msg}`)
    }
  }

  const clean = cands.filter((c) => c.fails.length === 0)
  const win = clean[0]
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

  mkdirSync(INTERIORS_CONTENT_DIR, { recursive: true })
  writeFileSync(join(INTERIORS_CONTENT_DIR, `${p.id}.webp`), await encodeWebp(win.img))
  rows.push(
    `| ${p.id} | ${p.role} | ${p.w}x${p.h} | ${GEN_PX}/${win.factor} (window ${win.window}) | ` +
      `${paletteDistance(win.img).toFixed(1)} | ${win.key} | ` +
      `$${(ledger.totalFor(assetId) - spentBefore).toFixed(4)} |`,
  )
}

const md = [
  '# the seven interior pieces, on the new chain',
  '',
  '| piece | role | px | integer path | palette distance | chosen | spend |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  '## every attempt',
  '',
  ...lines.map((l) => `- ${l}`),
  '',
  `spend: $${budget.total.toFixed(4)} of $${CAP} cap`,
].join('\n')
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/interiors.md`, md)
console.log(`\n${md}`)

// The report is written before the throw: its margins are what separate a threshold from a bad
// drawing, and a failure that eats them is worthless.
if (refused.length > 0)
  throw new Error(
    `${refused.length} piece(s) shipped nothing: ${refused.join(', ')}\n  Raise INT_ATTEMPTS ` +
      `to draw more, INT_REJECTED to refuse a candidate by eye, or change a threshold on ` +
      `purpose. Nothing was committed for a refused piece.`,
  )
