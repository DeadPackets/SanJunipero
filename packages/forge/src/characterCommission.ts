// The character pipeline, lifted out of `scripts/gen-cast-v5.ts` so a person the TOWN makes is
// drawn by the same gates the sixteen authored founders went through. Nothing here knows about
// money or the network: `deps.generate` buys the picture, and a budget stop leaves by the caller.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CharacterAtlasManifest } from '@sj/shared'
import { BudgetExceededError } from './budget.js'
import { CAST_CONTENT_DIR } from './castArt.js'
import { PROPORTION_ANCHOR_ID, type CastLook } from './castLooks.js'
import { PALETTE_WORDS, SWATCH_CLAUSE } from './palette.js'
import { STYLE_PROMPT } from './styleBible.js'
import { paletteSwatchPng } from './referenceSheet.js'
import { chromaKey } from './post/chromaKey.js'
import { quantize } from './post/quantize.js'
import { decodePng, downscaleNearest, encodePng, encodeWebp, type RawImage } from './post/raw.js'
import {
  CELL_V2,
  FEET_Y_V2,
  anchorToCanvas,
  cellDistance,
  downscaleMajority,
  estimatePitch,
  opaqueBbox,
  sliceStrip,
  type GateFailure,
} from './sheet.js'
import {
  AUTHORED_FACINGS,
  coherenceGateV4,
  deriveSheet,
  sleepCoherenceGateV4,
  stanceGate,
  strideGateV4,
  type AuthoredFacing,
  type StripPoseV4,
} from './mirror.js'
import { CHAR_CELL_PX, spriteCell } from './reCell.js'
import { trimToFigure } from './hires.js'
import { packCharacterAtlas } from './atlasV4.js'
import { alphaBinaryGate, paletteDistance, soleSilhouetteGate } from './pixelGates.js'
import {
  MAGENTA_RESIDUE_MAX,
  TORSO_DRIFT_MAX,
  WALK_CELLS,
  magentaResidue,
  torsoDrift,
  walkRowGate,
} from './walkGates.js'
import { refusalMessage } from './gate.js'

/** The figure is asked for at four fifths of the frame, so this decides the whole factor the
 *  cell is cut on — and with it how far two generations' figures can land apart. */
export const CHARACTER_GEN_PX = 2048
export const CHARACTER_SIZE = `${CHARACTER_GEN_PX}x${CHARACTER_GEN_PX}`
/** What one 2048² generation is reserved at, before the provider's own bill comes back. */
export const CHARACTER_RESERVE_USD = 0.15
/** How many candidates a cell may be drawn as before the run gives up. Every extra attempt is
 *  a paid generation. */
export const CHARACTER_ATTEMPTS = 3
/** Master + six walk frames + sleep: what a person costs when every cell passes first time. */
export const CHARACTER_IMAGES_MIN = 8
/** 2048 / 256: the whole factor a master's figure is cut down by on its way into a cell. */
const RAW_FACTOR = CHARACTER_GEN_PX / CHAR_CELL_PX
const MASTER_MIN_PITCH = 6
const CALIBRATED_MEDIAN = 0.31

export type CharacterImage = { png: Buffer; model: string; costUsd: number }

/** Buys one picture. Throwing `BudgetExceededError` stops the whole commission and leaves by
 *  the caller; any other throw costs this candidate and nothing else. */
export type CharacterGenerate = (req: {
  /** Names the cell and the attempt, e.g. `walk-mira-se-passing-c1`. A cache keys on it. */
  key: string
  prompt: string
  refs: Buffer[]
  size: string
  reserveUsd: number
}) => Promise<CharacterImage>

export type CharacterDeps = {
  generate: CharacterGenerate
  attempts?: number
  /** Candidate keys an operator refused by eye. */
  rejected?: ReadonlySet<string>
  /** Another villager's master pair, for proportion and layout. `undefined` reads the committed
   *  anchor off disk; `null` draws without one, which measured five heads against a three-head
   *  anchor. */
  proportionRef?: Buffer | null | undefined
  /** Every measurement the run made, in order — the report an operator reads. */
  onNote?: (line: string) => void
  /** Why nothing is being written for this character. */
  onRefused?: (reason: string) => void
}

export type CharacterSheet = {
  cells: Map<string, RawImage>
  image: RawImage
  /** The packed atlas as webp — the codex png for `character:<id>`. */
  atlas: Buffer
  manifest: CharacterAtlasManifest
  figureH: number
}

// ── prompts ──────────────────────────────────────────────────────────────────────────────────

const VIEW: Record<AuthoredFacing, string> = {
  se: 'front three-quarter view, facing bottom-right',
  ne: 'back three-quarter view seen from behind, facing top-right, back of the head visible, NO face visible',
}
// The reference is ONE figure, not the master sheet: the model copies the reference's LAYOUT as
// readily as its identity, and a word naming which half to use does not outrank a picture.
const VIEW_REF = 'the reference image'
type WalkPose = Exclude<StripPoseV4, 'idle'>
const WALK_POSES: readonly WalkPose[] = ['contact-a', 'passing', 'contact-b']
// From behind you cannot tell one foot from the other, so "the OTHER foot planted forward"
// renders as a body standing still. The stride has to be stated as a geometry, not an identity.
const STRIDE_CLAUSE =
  ' THE FEET ARE WIDE APART: the gap between the two feet is at least as wide as the ' +
  'shoulders, with clear background visible between the legs. This is the WIDEST frame of ' +
  'the walk cycle. It is NOT a standing pose and the feet are NOT together.'
const POSE_V4: Record<WalkPose, string> = {
  'contact-a':
    'walk cycle CONTACT pose A: legs at full stride spread, one foot planted forward, the other back with heel lifting, opposite arm swung forward.' +
    STRIDE_CLAUSE,
  passing:
    'walk cycle PASSING pose: legs close together, one foot lifted and passing under the body, the other leg planted straight, arms near the sides',
  'contact-b':
    'walk cycle CONTACT pose B: legs at full stride spread, the OTHER foot planted forward this time, its opposite arm swung forward.' +
    STRIDE_CLAUSE,
}

export const BIG_PIXEL =
  'Rendered as chunky low-resolution pixel art: the entire figure is drawn from large visible square pixels ' +
  '(as if a 32x32 sprite enlarged), flat solid colors from a limited palette, absolutely no smooth shading, ' +
  'no painterly detail, no anti-aliasing, thick 1-pixel dark outline around the silhouette.'

// The masters kept coming back five heads tall beside a three-head anchor, and the reference
// picture alone did not hold it — so the proportion is stated in words as well.
export const PROPORTION_CLAUSE =
  'chibi proportions like the reference cast: exactly three heads tall, large round head about ' +
  'one third of the total height, short legs'

/** PRESENT DAY. The same clause the dwellings carry, in the register a person needs. Without
 *  it a "villager" prompt returns a peasant, and the town's houses have glazed windows. */
const PERIOD = [
  'PRESENT DAY, not historical: these are modern people who have moved to a remote valley',
  'smallholding. Ordinary contemporary work clothes — fleeces, padded jackets, knitted',
  'cardigans, denim, canvas, work boots, zips and buttons.',
  'ABSOLUTELY NOT medieval, NOT fantasy, NOT a peasant, NOT a fairytale villager.',
  'NO tunics, NO robes, NO cloaks, NO smocks, NO leather jerkins, NO lace-up bodices,',
  'NO pointed shoes, NO wooden clogs, NO period costume of any kind.',
].join(' ')

const NO_SCENERY =
  'The ONLY content is the figure or figures on the flat magenta background: NO buildings, NO ' +
  'houses, NO scenery, NO ground plane, NO path, NO furniture, NO shadow under the figures. ' +
  'NO text, NO words, NO labels, NO captions anywhere.'

export function masterPrompt(m: CastLook, proportionRef: boolean): string {
  // The proportion reference is load-bearing: generated without it, every founder came back at
  // FIVE heads tall beside a three-heads anchor. Words alone did not hold it; the picture does.
  const proportionClause = proportionRef
    ? 'The SECOND reference image shows ANOTHER villager of this same game in the exact required ' +
      'layout: LEFT figure is the front three-quarter view facing bottom-right, RIGHT figure is ' +
      'the back three-quarter view facing top-right with NO face visible. Match that layout, the ' +
      'CHIBI body proportions, the big round head, the chunky pixel size and the simplification ' +
      'level EXACTLY. The head must be as large a fraction of the whole figure as it is in that ' +
      'reference — the whole body is only about THREE head-heights tall, NOT five, NOT a ' +
      "realistically proportioned adult. But do NOT copy that villager's costume, colours, hair " +
      'or identity, and do not draw that villager. '
    : ''
  return (
    `${STYLE_PROMPT} Exactly TWO figures of the SAME character side by side on the magenta ` +
    'background, evenly spaced with a clear magenta gap between them, whole body and feet ' +
    `visible on both. LEFT figure: ${VIEW.se}. RIGHT figure: ${VIEW.ne}. ` +
    'The two figures are identical in costume, colours and proportions — only the view changes. ' +
    proportionClause +
    `${NO_SCENERY} ` +
    `Subject: ${m.desc}. ${m.featureCap} ${PERIOD} ${SWATCH_CLAUSE} ${PALETTE_WORDS} ${BIG_PIXEL} ` +
    `${PROPORTION_CLAUSE}. ` +
    'Each figure stands about three quarters of the frame height tall, with clear magenta ' +
    'margin above and below; figures must NOT touch the edges of the image.'
  )
}

function framePrompt(m: CastLook, f: AuthoredFacing, p: WalkPose): string {
  return (
    `${STYLE_PROMPT} A single character sprite, exactly ONE figure (count: 1 figure), whole ` +
    'body and feet visible, centered on the magenta background. The figure is the ' +
    `${VIEW[f]} — exactly the same character, costume and colours as ${VIEW_REF}, with the ` +
    'same chunky pixel look: the visible square pixels must be the SAME SIZE relative to the ' +
    'body as in the reference figure. Draw EXACTLY ONE figure: the reference shows one figure ' +
    `and the answer must show one figure. Pose: ${POSE_V4[p]}. ${NO_SCENERY} ` +
    `Subject: ${m.desc}. ${m.featureCap} ${PERIOD} ${BIG_PIXEL} ` +
    'The figure stands about four fifths of the frame height tall, with clear magenta margin on ' +
    'all sides; the figure must NOT touch the edges of the image.'
  )
}

function sleepPrompt(m: CastLook): string {
  return (
    `${STYLE_PROMPT} A single character sprite, exactly ONE figure — exactly the same ` +
    'character, costume and colours as the figure in the reference image, at the same chunky ' +
    'pixel scale. The character is lying curled on their side fast asleep, seen from the same ' +
    // "body fully horizontal" asked for a body flat across the SCREEN and got it on three of
    // the five. On a 2:1 dimetric ground the body runs along the ground diagonal.
    'high three-quarter angle as the reference figures, the body lying ALONG THE GROUND going ' +
    'away up to the right — head at the upper right, knees drawn up and both feet at the lower ' +
    'left, NOT flat across the picture. Head resting on the ground in profile, cheek down, eyes ' +
    'closed, relaxed peaceful face; arms tucked in front of the chest and NOT propping the head ' +
    'up. Same outfit. Draw EXACTLY ONE figure. NO bed, NO pillow, NO props. ' +
    `${NO_SCENERY} ` +
    `Subject: ${m.desc}. ${m.featureCap} ${PERIOD} ${BIG_PIXEL}`
  )
}

// ── post ─────────────────────────────────────────────────────────────────────────────────────

// The master crop is chroma-keyed and trimmed, so attaching it bare shows the model a figure on
// nothing and it invents a background. The figure goes back onto a magenta field first.
const MAGENTA: readonly [number, number, number] = [255, 0, 255]
export function onMagenta(img: RawImage, pad = 0.18): RawImage {
  const m = Math.round(Math.max(img.width, img.height) * pad)
  const width = img.width + m * 2,
    height = img.height + m * 2
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...MAGENTA, 255], i)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4
      if (img.data[s + 3] === 0) continue
      data.set(img.data.subarray(s, s + 4), ((y + m) * width + x + m) * 4)
    }
  return { width, height, data }
}

function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  throw new Error('keyBg: <10% keyed even at tolerance 110')
}

// ONE WHOLE FACTOR PER CELL and no source correction: the figure lands where the factor puts it,
// and the report's figure spread is what says whether the walk cycle still reads.
const cutCell = (img: RawImage, anchor: 'feet' | 'centre' = 'feet'): RawImage =>
  spriteCell(img, { w: CHAR_CELL_PX, h: CHAR_CELL_PX, anchor }).cell

const figureHeight = (img: RawImage): number => {
  const b = opaqueBbox(img)
  return b === null ? 0 : b.y1 - b.y0 + 1
}

const MAX_ART_H = FEET_Y_V2 + 1
// Trimmed first, and that is what makes the fit below NORMALISE scale: a 256 canvas with the
// figure somewhere inside has the gates read the size difference as a broken head.
function gateView(cell: RawImage): RawImage {
  const img = trimToFigure(cell)
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  const fitted =
    k === 1
      ? img
      : downscaleMajority(
          img,
          Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
          Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))),
        )
  // MEASUREMENT ONLY, never a shipped pixel: cellDistance compares colours, and
  // CALIBRATED_MEDIAN was measured on snapped art.
  return quantize(anchorToCanvas(fitted, CELL_V2, CELL_V2, FEET_Y_V2))
}

// The ruling, and why it exists, live in `src/gate.ts` beside `refusalMessage`. This is the
// character pipeline's adapter onto it: a `GateFailure` rendered with its margin, because the
// margin is what tells an operator a threshold from a bad drawing.
const said = (x: GateFailure): string =>
  `${x.gate}: ${x.a} vs ${x.b} — ${x.value.toFixed(4)} against ${x.limit.toFixed(4)} ` +
  `(off by ${Math.abs(x.value - x.limit).toFixed(4)})`

/** The refusal for a set of candidates that all failed, or null when one of them may ship. */
function refusalFor(
  what: string,
  cands: readonly { key: string; failures: GateFailure[] }[],
): string | null {
  const msg = refusalMessage(
    what,
    cands.map((c) => ({ key: c.key, failures: c.failures.map(said) })),
  )
  return msg === ''
    ? null
    : `${msg}\n  Raise the attempt count to draw more, refuse a candidate by eye, or change the ` +
        'threshold on purpose. Nothing is written for this character.'
}

/** Omar's committed sheet stands in for his master: the same two figures, put back on magenta at
 *  the raw's scale, so a person drawn after the founding pays nothing for the anchor. */
export async function committedProportionRef(
  id: string = PROPORTION_ANCHOR_ID,
  root: string = CAST_CONTENT_DIR,
): Promise<Buffer | null> {
  const dir = join(root, id)
  if (!existsSync(join(dir, 'atlas.webp'))) return null
  const atlas = await decodePng(readFileSync(join(dir, 'atlas.webp')))
  const cells = (
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as CharacterAtlasManifest
  ).cells
  const figure = (name: string): RawImage => {
    const r = cells[name]!
    const out: RawImage = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) }
    for (let y = 0; y < r.h; y++) {
      const s = ((r.y + y) * atlas.width + r.x) * 4
      out.data.set(atlas.data.subarray(s, s + r.w * 4), y * r.w * 4)
    }
    // Back up to the factor the cell was cut on, so the visible pixels read as the raw's did.
    const t = trimToFigure(out)
    return downscaleNearest(t, t.width * RAW_FACTOR, t.height * RAW_FACTOR)
  }
  const se = figure('idle-se'),
    ne = figure('idle-ne')
  const gap = Math.round(Math.max(se.width, ne.width) * 0.5)
  const pair: RawImage = {
    width: se.width + gap + ne.width,
    height: Math.max(se.height, ne.height),
    data: new Uint8ClampedArray((se.width + gap + ne.width) * Math.max(se.height, ne.height) * 4),
  }
  for (const [img, ox] of [
    [se, 0],
    [ne, se.width + gap],
  ] as const) {
    const oy = pair.height - img.height
    for (let y = 0; y < img.height; y++)
      pair.data.set(
        img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4),
        ((oy + y) * pair.width + ox) * 4,
      )
  }
  return encodePng(onMagenta(pair))
}

// The swatch is the same picture for every character ever drawn, so it is built once a process.
let swatchOnce: Promise<Buffer> | null = null
const swatchPng = (): Promise<Buffer> =>
  (swatchOnce ??= paletteSwatchPng().catch((e: unknown) => {
    swatchOnce = null
    throw e
  }))

// ── the pipeline ─────────────────────────────────────────────────────────────────────────────

/** One person, drawn: master pair → six walk frames → sleep → the 24-cell contract → one packed
 *  atlas. `null` means a gate refused the sheet and NOTHING is written for this character. A
 *  budget stop is not a refusal — it leaves by the caller. */
export async function commissionCharacter(
  deps: CharacterDeps,
  look: CastLook,
): Promise<CharacterSheet | null> {
  const attempts = Math.max(1, deps.attempts ?? CHARACTER_ATTEMPTS)
  const rejected = deps.rejected ?? new Set<string>()
  const push = (line: string): void => {
    deps.onNote?.(line)
  }
  const refuse = (reason: string): null => {
    deps.onRefused?.(reason)
    return null
  }
  const proportionRef =
    deps.proportionRef === undefined ? await committedProportionRef() : deps.proportionRef
  const swatch = await swatchPng()

  const buy = async (key: string, prompt: string, refs: Buffer[]): Promise<Buffer | null> => {
    if (rejected.has(key)) {
      push(`${key}: REFUSED BY EYE`)
      return null
    }
    try {
      return (
        await deps.generate({
          key,
          prompt,
          refs,
          size: CHARACTER_SIZE,
          reserveUsd: CHARACTER_RESERVE_USD,
        })
      ).png
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e
      push(`${key}: generation FAILED — ${String(e).slice(0, 160)}`)
      return null
    }
  }

  // master pair — the swatch, plus (for everyone but the anchor) a committed villager's own
  // master as a proportion/layout reference. A villager is not "a different object".
  type Master = { key: string; raw: Buffer; se: RawImage; ne: RawImage; pitch: number }
  const masters: Master[] = []
  const refs = proportionRef ? [swatch, proportionRef] : [swatch]
  for (let i = 0; i < attempts; i++) {
    if (i === attempts - 1 && masters.some((x) => x.pitch >= MASTER_MIN_PITCH)) break
    const key = `master-${look.id}-c${i}`
    const raw = await buy(key, masterPrompt(look, proportionRef !== null), refs)
    if (raw === null) continue
    try {
      const segs = sliceStrip(keyBg(await decodePng(raw)), 2)
      const pitches = segs.map((s) => estimatePitch(s))
      const seHi = cutCell(segs[0]!)
      const neHi = cutCell(segs[1]!)
      const frontBack = cellDistance(gateView(seHi), gateView(neHi))
      const pitch = Math.min(...pitches)
      push(
        `${key}: sliced OK, pitch=${pitches.map((p) => p.toFixed(2)).join('/')}, front-back=${frontBack.toFixed(3)}`,
      )
      masters.push({ key, raw, se: seHi, ne: neHi, pitch })
      if (pitch >= MASTER_MIN_PITCH) break
    } catch (e) {
      push(`${key}: process FAILED — ${String(e).slice(0, 200)}`)
    }
  }
  if (masters.length === 0)
    return refuse(`${look.id}: every master candidate failed to slice into two figures`)
  masters.sort((a, b) => b.pitch - a.pitch)
  const master = masters[0]!
  push(`master chosen: ${master.key} (pitch ${master.pitch.toFixed(2)})`)

  const idleHi: Record<AuthoredFacing, RawImage> = { se: master.se, ne: master.ne }
  const seB = opaqueBbox(master.se)!
  const TARGET_H = seB.y1 - seB.y0 + 1
  const masterGate: Record<AuthoredFacing, RawImage> = {
    se: gateView(master.se),
    ne: gateView(master.ne),
  }
  // One figure per reference — see VIEW_REF. These are the master's own crops, so identity,
  // costume and pixel scale are the master's exactly.
  const soloRef: Record<AuthoredFacing, Buffer> = {
    se: await encodePng(onMagenta(master.se)),
    ne: await encodePng(onMagenta(master.ne)),
  }
  push(`figureH=${TARGET_H}`)

  // walk frames — the master sheet is the only reference: identity, not architecture
  type FrameCand = { key: string; hi: RawImage; gate: RawImage; failures: GateFailure[] }
  function evalFrame(key: string, f: AuthoredFacing, p: WalkPose, raw: RawImage): FrameCand {
    const keyed = keyBg(raw)
    let two = false
    try {
      sliceStrip(keyed, 2)
      two = true
    } catch {
      /* one cluster — good */
    }
    if (two) throw new Error('slices into 2 figure clusters — multi-figure frame')
    const hi = cutCell(keyed)
    // `sliceStrip` catches a second FIGURE but not the model captioning its own work — a caption
    // inside the figure's own column reads as one cluster. Hard reject: another candidate is drawn.
    const sole = soleSilhouetteGate(hi)
    if (!sole.ok) throw new Error(sole.failures.join('; '))
    const residue = magentaResidue(hi)
    if (residue > MAGENTA_RESIDUE_MAX)
      throw new Error(`${residue} magenta pixels the key missed — a shadow disc`)
    const b = opaqueBbox(hi)!
    const aspect = (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1)
    if (aspect > 1.15) throw new Error(`aspect ${aspect.toFixed(2)} > 1.15 — multi-figure or lying`)
    const gate = gateView(hi)
    // `strideGateV4` measures frame-to-frame distance, not stance, so it cannot see a standing
    // figure dropped into a walk loop. A failure rather than a throw, so the margin is reported.
    const stance =
      p === 'passing'
        ? []
        : stanceGate(f, idleHi[f], [{ label: p, img: hi }]).map((x) => ({ ...x, a: key }))
    // A coat that changes colour for one frame flickers at 8 fps; judged here so the next
    // candidate is drawn, not at the end when the whole sheet is refused.
    const drift = f === 'se' ? torsoDrift(hi, idleHi.se) : 0
    const coat: GateFailure[] =
      drift > TORSO_DRIFT_MAX
        ? [{ gate: 'torso-drift', a: key, b: 'se/idle', value: drift, limit: TORSO_DRIFT_MAX }]
        : []
    return {
      key,
      hi,
      gate,
      failures: [...coherenceGateV4(key, masterGate[f], gate), ...stance, ...coat],
    }
  }
  const identityBroken = (c: FrameCand): boolean =>
    c.failures.some((x) => x.gate === 'silhouette' && (x.value > 1.5 || x.value < 0.55))
  const bestOf = (cs: FrameCand[]): FrameCand | null =>
    cs.reduce<FrameCand | null>((a, c) => {
      if (!a) return c
      if (identityBroken(a) !== identityBroken(c)) return identityBroken(a) ? c : a
      return c.failures.length < a.failures.length ? c : a
    }, null)

  async function genFrame(f: AuthoredFacing, p: WalkPose, i: number): Promise<FrameCand | null> {
    const key = `walk-${look.id}-${f}-${p}-c${i}`
    const raw = await buy(key, framePrompt(look, f, p), [soloRef[f]])
    if (raw === null) return null
    try {
      const c = evalFrame(key, f, p, await decodePng(raw))
      push(
        `${key}: ${c.failures.length === 0 ? 'PASS' : c.failures.map((x) => `${x.gate}(${x.value.toFixed(3)})`).join(',')}`,
      )
      return c
    } catch (e) {
      push(`${key}: process FAILED — ${String(e).slice(0, 160)}`)
      return null
    }
  }

  const chosen: Record<AuthoredFacing, Record<WalkPose, FrameCand>> = { se: {}, ne: {} } as never
  for (const f of AUTHORED_FACINGS) {
    for (const p of WALK_POSES) {
      const cands: FrameCand[] = []
      for (let i = 0; i < attempts; i++) {
        const c = await genFrame(f, p, i)
        if (c) cands.push(c)
        const best = bestOf(cands)
        if (best?.failures.length === 0 && !identityBroken(best)) break
      }
      const best = bestOf(cands)
      if (!best) return refuse(`${look.id} ${f}/${p}: every candidate failed processing`)
      const no = refusalFor(
        `${look.id} ${f}/${p}`,
        cands.map((c) => ({ key: c.key, failures: c.failures })),
      )
      if (no !== null) return refuse(no)
      chosen[f][p] = best
    }
    // The stride trio is binding, and there is no candidate to re-roll: the trio is a property of
    // three frames already chosen, so the failure is the character's.
    const stride = strideGateV4(
      f,
      {
        idle: masterGate[f],
        'contact-a': chosen[f]['contact-a'].gate,
        passing: chosen[f].passing.gate,
        'contact-b': chosen[f]['contact-b'].gate,
      },
      CALIBRATED_MEDIAN,
    )
    for (const x of stride)
      push(`${f} stride: ${x.gate} ${x.a}~${x.b} ${x.value.toFixed(3)} < ${x.limit.toFixed(3)}`)
    push(`${f} trio ${stride.length === 0 ? 'PASS' : 'FAILED'}`)
    const noTrio = refusalFor(`${look.id} ${f}/stride-trio`, [
      { key: `${f}: contact-a + passing + contact-b as chosen`, failures: stride },
    ])
    if (noTrio !== null) return refuse(noTrio)
  }

  // sleep
  type SleepCand = { key: string; hi: RawImage; failures: GateFailure[] }
  const sleeps: SleepCand[] = []
  for (let i = 0; i < attempts; i++) {
    const key = `sleep-${look.id}-c${i}`
    const raw = await buy(key, sleepPrompt(look), [soloRef.se])
    if (raw === null) continue
    try {
      const keyed = keyBg(await decodePng(raw))
      let two = false
      try {
        sliceStrip(keyed, 2)
        two = true
      } catch {
        /* one cluster — good */
      }
      if (two) throw new Error('slices into 2 figure clusters')
      const hi = cutCell(keyed, 'centre')
      // The same hard reject the walk frames get: `sliceStrip` sees a second FIGURE, not a
      // caption, and a sleeping villager is where the model likes to draw floating "z"s.
      const sole = soleSilhouetteGate(hi)
      if (!sole.ok) throw new Error(sole.failures.join('; '))
      const residue = magentaResidue(hi)
      if (residue > MAGENTA_RESIDUE_MAX) throw new Error(`${residue} magenta pixels the key missed`)
      const failures = sleepCoherenceGateV4(gateView(hi))
      push(
        `${key}: ${failures.length === 0 ? 'PASS' : failures.map((x) => `${x.gate}(${x.value.toFixed(3)})`).join(',')}`,
      )
      sleeps.push({ key, hi, failures })
      if (failures.length === 0) break
    } catch (e) {
      push(`${key}: process FAILED — ${String(e).slice(0, 160)}`)
    }
  }
  const sleep = sleeps.reduce<SleepCand | null>(
    (a, c) => (!a || c.failures.length < a.failures.length ? c : a),
    null,
  )
  if (!sleep) return refuse(`${look.id}: every sleep candidate failed processing`)
  const noSleep = refusalFor(
    `${look.id} sleep`,
    sleeps.map((c) => ({ key: c.key, failures: c.failures })),
  )
  if (noSleep !== null) return refuse(noSleep)

  // derivation (zero spend) → the 24-cell contract → ONE packed atlas
  const cells = deriveSheet({
    strips: {
      se: {
        idle: idleHi.se,
        'contact-a': chosen.se['contact-a'].hi,
        passing: chosen.se.passing.hi,
        'contact-b': chosen.se['contact-b'].hi,
      },
      ne: {
        idle: idleHi.ne,
        'contact-a': chosen.ne['contact-a'].hi,
        passing: chosen.ne.passing.hi,
        'contact-b': chosen.ne['contact-b'].hi,
      },
    },
    sleep: sleep.hi,
  })
  // The row laws, on the derived cells: a frame that passed every pairwise gate can still be
  // the short one in its row, or the back of a head in a front-facing row.
  const rows = (['se', 'ne'] as const).flatMap((f) =>
    walkRowGate(
      Object.fromEntries(WALK_CELLS.map((p) => [p, cells.get(`${p}-${f}`)!])) as Record<
        (typeof WALK_CELLS)[number],
        RawImage
      >,
      f === 'se',
    ).map((x) => `${x.cell}-${f} ${x.gate} ${x.value.toFixed(2)} against ${x.limit}`),
  )
  for (const r of rows) push(`row: ${r}`)
  if (rows.length > 0)
    return refuse(
      `${look.id}: a walk row fails its law — ${rows.join('; ')}. Refuse the offending ` +
        'candidate by eye and draw again. Nothing is written for this character.',
    )
  const { image, manifest } = packCharacterAtlas(cells, TARGET_H)

  const bar = alphaBinaryGate(image).failures
  const figures = [...cells].map(([, img]) => figureHeight(img))
  push(
    `atlas ${image.width}x${image.height}: ${bar.length === 0 ? 'pixel bar clean' : bar.join('; ')}, ` +
      `palette distance ${paletteDistance(image).toFixed(1)}, ` +
      `figure spread ${Math.min(...figures)}–${Math.max(...figures)} px`,
  )
  // the same ruling: the packed atlas is measured here and was written whatever it said
  if (bar.length > 0)
    return refuse(
      `${look.id}: the packed atlas FAILS the pixel bar and may not ` +
        `be shipped.\n    ${bar.join('\n    ')}\n  Nothing is written for this character.`,
    )

  return { cells, image, atlas: await encodeWebp(image), manifest, figureH: TARGET_H }
}
