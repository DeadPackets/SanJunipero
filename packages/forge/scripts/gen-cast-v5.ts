// LIVE — the five founders, COMMITTED. Cap $CAST_CAP.
// Controls: CAST=<comma ids>, CAST_ATTEMPTS=<n, default 3>, CAST_DRY=1,
//           CAST_REJECTED=<raw keys the eye refused>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BudgetGuard } from '../src/budget.js'
import { SpendLedger } from '../src/spendLedger.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { paletteSwatchPng } from '../src/referenceSheet.js'
import { PALETTE_WORDS, SWATCH_CLAUSE } from '@sj/forge/gen'
import { decodePng, encodePng, encodeWebp, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  CELL_V2,
  FEET_Y_V2,
  anchorToCanvas,
  cellDistance,
  downscaleMajority,
  opaqueBbox,
  sliceStrip,
  type GateFailure,
} from '../src/sheet.js'
import {
  AUTHORED_FACINGS,
  coherenceGateV4,
  deriveSheet,
  sleepCoherenceGateV4,
  stanceGate,
  strideGateV4,
  type AuthoredFacing,
  type StripPoseV4,
} from '../src/mirror.js'
import { CHAR_CELL_PX, spriteCell } from '../src/reCell.js'
import { trimToFigure } from '../src/hires.js'
import { packCharacterAtlas } from '../src/atlasV4.js'
import { alphaBinaryGate, paletteDistance, soleSilhouetteGate } from '../src/pixelGates.js'
import { quantize } from '../src/post/quantize.js'
import { refusalMessage } from '../src/gate.js'
import { CAST_CONTENT_DIR } from '../src/castArt.js'
import { BIG_PIXEL, PROPORTION_CLAUSE } from './character.js'
import { CAST_V5, PROPORTION_ANCHOR_ID, type CastMember } from './cast-v5.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.CAST_CAP ?? '12.00')
const DRY = process.env.CAST_DRY === '1'
const REJECTED = new Set(
  (process.env.CAST_REJECTED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const FILTER = (process.env.CAST ?? CAST_V5.map((c) => c.id).join(','))
  .split(',')
  .map((s) => s.trim())
// Omar first whatever the filter order says: his master is everyone else's proportion ref.
const RUN = CAST_V5.filter((c) => FILTER.includes(c.id)).sort(
  (a, b) => Number(b.id === PROPORTION_ANCHOR_ID) - Number(a.id === PROPORTION_ANCHOR_ID),
)
if (RUN.length === 0) throw new Error(`CAST=${process.env.CAST} matches no cast member`)

const S = scratch('ar')
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
// The figure is asked for at four fifths of the frame, so this decides the whole factor the cell
// is cut on — and with it how far two generations' figures can land apart. See regen-probe.md.
const GEN_PX = 2048
const SIZE = `${GEN_PX}x${GEN_PX}`
const RESERVE = 0.15

const budget = new BudgetGuard(CAP)
const ledger = new SpendLedger(`${S}/spend.json`)
const swatch = await paletteSwatchPng()

class OutOfBudget extends Error {}

async function generate(
  prompt: string,
  refs: Buffer[],
  size: string,
  reserve: number,
  assetId: string,
) {
  if (budget.total + reserve > CAP)
    throw new OutOfBudget(
      `reserve $${reserve.toFixed(3)} exceeds remaining cap ($${budget.total.toFixed(3)} of $${CAP})`,
    )
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size,
      response_format: 'b64_json',
      input_references: refs.map((r) => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${r.toString('base64')}` },
      })),
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = (json.data ?? []).filter((d) => d.b64_json).at(-1)?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json`)
  const cost = json.usage?.cost ?? reserve
  budget.spend(cost)
  ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: cost }) // $5 anomaly stop
  ledger.flush()
  return { raw: Buffer.from(b64, 'base64'), cost }
}

async function candidate(
  dir: string,
  key: string,
  prompt: string,
  refs: Buffer[],
  size: string,
  reserve: number,
  assetId: string,
): Promise<Buffer> {
  const path = `${dir}/raws/${key}.png`
  if (existsSync(path)) {
    console.log(`  ${key}: cached`)
    return readFileSync(path)
  }
  if (DRY) throw new OutOfBudget(`${key}: DRY`)
  const r = await generate(prompt, refs, size, reserve, assetId)
  writeFileSync(path, r.raw)
  console.log(`  ${key}: generated $${r.cost.toFixed(4)} (total $${budget.total.toFixed(4)})`)
  return r.raw
}

// ── prompts: round 3's calibrated texts, with the cottage taken out ──────────────────────────

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

function masterPrompt(m: CastMember, proportionRef: boolean): string {
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

function framePrompt(m: CastMember, f: AuthoredFacing, p: WalkPose): string {
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

function sleepPrompt(m: CastMember): string {
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

// ── the pipeline ─────────────────────────────────────────────────────────────────────────────

// The master crop is chroma-keyed and trimmed, so attaching it bare shows the model a figure on
// nothing and it invents a background. The figure goes back onto a magenta field first.
const MAGENTA: readonly [number, number, number] = [255, 0, 255]
function onMagenta(img: RawImage, pad = 0.18): RawImage {
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

const CALIBRATED_MEDIAN = 0.31

// The ruling, and why it exists, live in `src/gate.ts` beside `refusalMessage`. This is the
// cast generator's adapter onto it: a `GateFailure` rendered with its margin, because the
// margin is what tells an operator a threshold from a bad drawing.
const said = (x: GateFailure): string =>
  `${x.gate}: ${x.a} vs ${x.b} — ${x.value.toFixed(4)} against ${x.limit.toFixed(4)} ` +
  `(off by ${Math.abs(x.value - x.limit).toFixed(4)})`

function refuseFailing(
  what: string,
  cands: readonly { key: string; failures: GateFailure[] }[],
): void {
  const msg = refusalMessage(
    what,
    cands.map((c) => ({ key: c.key, failures: c.failures.map(said) })),
  )
  if (msg === '') return
  throw new Error(
    `${msg}\n  Raise CAST_ATTEMPTS to draw more, CAST_REJECTED to refuse a ` +
      `candidate by eye, or change the threshold on purpose. Nothing is written for this character.`,
  )
}

/** How many candidates a cell may be drawn as before the run gives up. Documented in this
 *  file's header since v4 and read nowhere until now; it is the knob the ruling above creates
 *  the need for, because every extra attempt is a paid generation. */
const ATTEMPTS = Math.max(1, Number(process.env.CAST_ATTEMPTS ?? '3'))
const MASTER_MIN_PITCH = 6

const summary: string[] = []
let proportionRef: Buffer | null = null

async function runCharacter(m: CastMember): Promise<void> {
  const DIR = `${S}/cast/${m.id}`
  for (const d of [`${DIR}/raws`, `${DIR}/cells`]) mkdirSync(d, { recursive: true })
  const assetId = `cast:${m.id}`
  const spentBefore = ledger.totalFor(assetId)
  const report: string[] = []
  const push = (l: string) => {
    report.push(l)
    console.log(`  ${l}`)
  }
  console.log(`\n== ${m.id} ==`)

  // master pair — the ONLY reference is the swatch, plus (for everyone but omar) omar's own
  // master as a proportion/layout reference. A villager is not "a different object".
  type Master = { key: string; raw: Buffer; se: RawImage; ne: RawImage; pitch: number }
  const masters: Master[] = []
  const refs = proportionRef ? [swatch, proportionRef] : [swatch]
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i === ATTEMPTS - 1 && masters.some((x) => x.pitch >= MASTER_MIN_PITCH)) break
    const key = `master-${m.id}-c${i}`
    if (REJECTED.has(key)) {
      push(`${key}: REFUSED BY EYE`)
      continue
    }
    const raw = await candidate(
      DIR,
      key,
      masterPrompt(m, proportionRef !== null),
      refs,
      SIZE,
      RESERVE,
      assetId,
    )
    try {
      const segs = sliceStrip(keyBg(await decodePng(raw)), 2)
      const { estimatePitch } = await import('../src/sheet.js')
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
    throw new Error(`${m.id}: every master candidate failed to slice into two figures`)
  masters.sort((a, b) => b.pitch - a.pitch)
  const master = masters[0]!
  push(`master chosen: ${master.key} (pitch ${master.pitch.toFixed(2)})`)
  if (m.id === PROPORTION_ANCHOR_ID) proportionRef = master.raw

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
    return { key, hi, gate, failures: [...coherenceGateV4(key, masterGate[f], gate), ...stance] }
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
    const key = `walk-${m.id}-${f}-${p}-c${i}`
    if (REJECTED.has(key)) {
      push(`${key}: REFUSED BY EYE`)
      return null
    }
    let raw: Buffer
    try {
      raw = await candidate(DIR, key, framePrompt(m, f, p), [soloRef[f]], SIZE, RESERVE, assetId)
    } catch (e) {
      if (e instanceof OutOfBudget) throw e
      push(`${key}: generation FAILED — ${String(e).slice(0, 160)}`)
      return null
    }
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
      for (let i = 0; i < ATTEMPTS; i++) {
        const c = await genFrame(f, p, i)
        if (c) cands.push(c)
        const best = bestOf(cands)
        if (best?.failures.length === 0 && !identityBroken(best)) break
      }
      const best = bestOf(cands)
      if (!best) throw new Error(`${m.id} ${f}/${p}: every candidate failed processing`)
      refuseFailing(
        `${m.id} ${f}/${p}`,
        cands.map((c) => ({ key: c.key, failures: c.failures })),
      )
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
    refuseFailing(`${m.id} ${f}/stride-trio`, [
      {
        key: `${f}: contact-a + passing + contact-b as chosen`,
        failures: stride,
      },
    ])
  }

  // sleep
  type SleepCand = { key: string; hi: RawImage; failures: GateFailure[] }
  const sleeps: SleepCand[] = []
  for (let i = 0; i < ATTEMPTS; i++) {
    const key = `sleep-${m.id}-c${i}`
    if (REJECTED.has(key)) {
      push(`${key}: REFUSED BY EYE`)
      continue
    }
    const raw = await candidate(DIR, key, sleepPrompt(m), [soloRef.se], SIZE, RESERVE, assetId)
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
  if (!sleep) throw new Error(`${m.id}: every sleep candidate failed processing`)
  refuseFailing(
    `${m.id} sleep`,
    sleeps.map((c) => ({ key: c.key, failures: c.failures })),
  )

  // derivation (zero spend) → the 24-cell contract → ONE packed atlas, committed
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
  for (const [name, img] of cells) writeFileSync(`${DIR}/cells/${name}.png`, await encodePng(img))
  const { image, manifest } = packCharacterAtlas(cells, TARGET_H)
  const atlas = await encodeWebp(image)

  const bar = alphaBinaryGate(image).failures
  const figures = [...cells].map(([, img]) => figureHeight(img))
  push(
    `atlas ${image.width}x${image.height}: ${bar.length === 0 ? 'pixel bar clean' : bar.join('; ')}, ` +
      `palette distance ${paletteDistance(image).toFixed(1)}, ` +
      `figure spread ${Math.min(...figures)}–${Math.max(...figures)} px`,
  )
  // the same ruling: the packed atlas is measured here and was written whatever it said
  if (bar.length > 0)
    throw new Error(
      `${m.id}: the packed atlas FAILS the pixel bar and may not ` +
        `be shipped.\n    ${bar.join('\n    ')}\n  Nothing is written for this character.`,
    )

  const dir = join(CAST_CONTENT_DIR, m.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'atlas.webp'), atlas)
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const spend = ledger.totalFor(assetId) - spentBefore
  writeFileSync(`${DIR}/report.txt`, report.join('\n'))
  summary.push(
    `${m.id}: figureH ${TARGET_H}, atlas ${image.width}x${image.height}, ` +
      `${bar.length === 0 ? 'bar clean' : `BAR ${bar.join('; ')}`}, $${spend.toFixed(4)}`,
  )
}

for (const m of RUN) {
  try {
    await runCharacter(m)
  } catch (e) {
    if (e instanceof OutOfBudget) {
      summary.push(`${m.id}: STOPPED — ${String(e).slice(0, 120)}`)
      break
    }
    summary.push(`${m.id}: FAILED — ${String(e).slice(0, 240)}`)
    console.log(`\n${m.id}: FAILED — ${String(e).slice(0, 400)}`)
  }
}
const out = [
  '== cast recovery ==',
  ...summary,
  `total this run: $${budget.total.toFixed(4)} of $${CAP} cap; ledger total $${ledger.total().toFixed(4)}`,
].join('\n')
mkdirSync(`${S}/reports`, { recursive: true })
writeFileSync(`${S}/reports/cast.md`, out)
console.log(`\n${out}`)
