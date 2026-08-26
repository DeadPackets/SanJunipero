import type { Footprint } from '@sj/shared'
import { MASTER_PALETTE } from '../palette.js'
import type { RawImage } from '../post/raw.js'
import { CRITERIA, type Criterion } from './verdict.js'
import { TILING_CRITERION_PROMPT } from '../terrainGen.js'

export const RUBRIC_VERSION = 'v1'
export const CANONICAL_PITCH = { character: 5.12, building: 4.0 } as const
export const PITCH_TOLERANCE = 0.2
export const CHECKER_PX = 8,
  CARD_PAD = 8,
  SWATCH_PX = 12
export const CHECKER_LIGHT = '#E9E2DA',
  CHECKER_DARK = '#CFC6BC' // palette greys, never magenta

const PALETTE_COLS = 8,
  PALETTE_ROWS = 5,
  CHECKER_MARGIN = 16

function rgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

function fill(
  img: RawImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  c: [number, number, number],
): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = c[0]
      img.data[i + 1] = c[1]
      img.data[i + 2] = c[2]
      img.data[i + 3] = 255
    }
}

export function paletteCard(): RawImage {
  const width = PALETTE_COLS * SWATCH_PX + 2 * CARD_PAD
  const height = PALETTE_ROWS * SWATCH_PX + 2 * CARD_PAD
  const img: RawImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  MASTER_PALETTE.forEach((hex, i) => {
    const col = i % PALETTE_COLS,
      row = (i / PALETTE_COLS) | 0
    fill(
      img,
      CARD_PAD + col * SWATCH_PX,
      CARD_PAD + row * SWATCH_PX,
      SWATCH_PX,
      SWATCH_PX,
      rgb(hex),
    )
  })
  return img
}

export function checkerBackground(width: number, height: number): RawImage {
  const img: RawImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const light = rgb(CHECKER_LIGHT),
    dark = rgb(CHECKER_DARK)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const odd = (((x / CHECKER_PX) | 0) + ((y / CHECKER_PX) | 0)) % 2 === 1
      const i = (y * width + x) * 4,
        c = odd ? dark : light
      img.data[i] = c[0]
      img.data[i + 1] = c[1]
      img.data[i + 2] = c[2]
      img.data[i + 3] = 255
    }
  return img
}

export function compositeOver(dst: RawImage, art: RawImage, ox: number, oy: number): void {
  for (let y = 0; y < art.height; y++)
    for (let x = 0; x < art.width; x++) {
      const s = (y * art.width + x) * 4,
        a = art.data[s + 3]!
      if (a === 0) continue
      const d = ((y + oy) * dst.width + x + ox) * 4
      for (let k = 0; k < 3; k++)
        dst.data[d + k] = Math.round((art.data[s + k]! * a + dst.data[d + k]! * (255 - a)) / 255)
      dst.data[d + 3] = 255
    }
}

export function checkerCard(art: RawImage): RawImage {
  const img = checkerBackground(art.width + 2 * CHECKER_MARGIN, art.height + 2 * CHECKER_MARGIN)
  compositeOver(img, art, CHECKER_MARGIN, CHECKER_MARGIN)
  return img
}

function criterionAsk(k: Criterion, a: { klass: string; expectedFacing?: string }): string {
  const pitch = CANONICAL_PITCH[a.klass as keyof typeof CANONICAL_PITCH]
  switch (k) {
    case 'palette':
      return 'palette — every opaque colour is a member of the palette card shown above. No colour outside it, no gradient bands, no soft anti-aliased edges.'
    case 'singleFigure':
      return 'singleFigure — exactly one subject in the frame. No duplicate copy, no inset thumbnail, no second view, no background scene. Binary: fail outright if more than one subject is present.'
    case 'transparency':
      return 'transparency — the background is entirely clear. No magenta residue, no coloured halo, no grey fringe hugging the subject. Binary: fail outright on any residue. The checker behind the artwork makes residue visible.'
    case 'proportion':
      return pitch !== undefined
        ? `proportion — the artwork's apparent block size is ${pitch.toFixed(2)} screen units per source unit, within ±20% of that target. Blocks larger or smaller than the tolerance fail.`
        : "proportion — the subject's parts are in believable relative size to one another and to the rest of the set."
    case 'facing':
      return `facing — the subject faces ${a.expectedFacing ?? 'the commissioned direction'}. Judge only the obvious: a subject turned the wrong way round fails; a small angular drift does not.`
    case 'density':
      return 'density — the artwork reads cleanly at its intended small size: crisp silhouette, no mush, no crowding of fine detail, no smear.'
    case 'tiling':
      return `tiling — ${TILING_CRITERION_PROMPT}`
    case 'alignment':
      return 'alignment — the subject sits ON the ground diamond of its footprint: its base row meets the near vertex of the diamond, nothing floats above it, nothing sinks below it, and the base does not overhang the diamond sideways.'
  }
}

const NA_REASON: Record<string, string> = {
  tiling: 'this class is a single object, not a repeating surface',
  transparency: 'this class is full-bleed ground with no background to clear',
  facing: 'this class has no commissioned direction',
  alignment: 'this class never meets the ground',
  proportion: 'this class has no canonical block target',
  singleFigure: 'this class is ground cover, not a subject',
}

export function buildRubricPrompt(args: {
  klass: string
  commission: string
  footprint?: Footprint
  expectedFacing?: string
  naFor?: readonly string[]
}): string {
  const na = new Set(args.naFor ?? [])
  const live = CRITERIA.filter((c) => !na.has(c))
  const naNames = (args.naFor ?? []).filter((c) => (CRITERIA as readonly string[]).includes(c))
  const lines: string[] = [
    `You are the art reviewer for a cozy hand-drawn town game. Review one piece of artwork of class "${args.klass}".`,
    'You are shown, in order: the locked reference artwork, then the palette card, then the artwork under review on a neutral checker background.',
    '',
    `Commission: ${args.commission}`,
  ]
  if (args.footprint) lines.push(`Footprint: ${args.footprint.w}x${args.footprint.h} tiles.`)
  if (args.expectedFacing) lines.push(`Commissioned facing: ${args.expectedFacing}.`)
  lines.push('', 'Judge these criteria, each 0-10 with one sentence of evidence:')
  live.forEach((c, i) => lines.push(`${i + 1}. ${criterionAsk(c, args)}`))
  if (naNames.length) {
    lines.push(
      '',
      `Not judged for this class: ${naNames.join(', ')} — ` +
        naNames.map((c) => `${c}: ${NA_REASON[c] ?? 'it carries no meaning here'}`).join('; ') +
        '. Do not report them; they are filled in downstream.',
    )
  }
  lines.push(
    '',
    'Return one object carrying, for each criterion named above, a pass flag, a 0-10 score, and one sentence of evidence, ' +
      'plus a single feedback string naming exactly what to change on a redraw. Write the feedback as a drawing instruction, not as a critique.',
    'Score only what you can see. If a criterion cannot be judged from the images, score it 0 and say why in evidence.',
  )
  return lines.join('\n')
}
