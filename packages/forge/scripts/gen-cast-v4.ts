// LIVE (Asset Standard v3) — cap $PROD_CAP (default $6.00). Omar is not regenerated.
// Facing gate = HUMAN EYEBALL on the batch artifacts; this script never claims sign-off.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  FACINGS,
  CELL_V2,
  FEET_Y_V2,
  sliceStrip,
  estimatePitch,
  opaqueBbox,
  anchorToCanvas,
  assembleGrid,
  downscaleMajority,
  cellDistance,
  pairwiseMedian,
  type GateFailure,
} from '../src/sheet.js'
import {
  AUTHORED_FACINGS,
  STRIP_POSES_V4,
  WALK_CYCLE_V4,
  WALK_FRAME_MS,
  deriveSheet,
  strideGateV4,
  coherenceGateV4,
  sleepCoherenceGateV4,
  type AuthoredFacing,
  type StripPoseV4,
} from '../src/mirror.js'
import { processHiResCell, cellAnchor, buildManifestV4 } from '../src/hires.js'
import { refusalMessage } from '../src/gate.js'
import { BIG_PIXEL } from './character.js'
import { CAST_V4, type CastMember } from './cast.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.PROD_CAP ?? '6.0')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'

const SCRATCH = scratch('c5')
const PRODUCTION = `${SCRATCH}/production`

const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')
// The APPROVED omar master doubles as a proportion/pixel/layout reference for new
// masters (eyeball round 1: nadia drifted to 4.5-heads fine-pixel and her back figure
// faced top-LEFT; omar demonstrates the required layout and chibi scale in-context).
const OMAR_MASTER_PATH = `${SCRATCH}/character-v4/raws/master-b0-c1.png`
const PROPORTION_REF = existsSync(OMAR_MASTER_PATH) ? readFileSync(OMAR_MASTER_PATH) : null

const CAST_FILTER = (process.env.CAST ?? CAST_V4.map((c) => c.id).join(','))
  .split(',')
  .map((s) => s.trim())
const RUN_CAST = CAST_V4.filter((c) => CAST_FILTER.includes(c.id))
if (RUN_CAST.length === 0) throw new Error(`CAST=${process.env.CAST} matches no cast member`)

class OutOfBudget extends Error {}

// Superseded by gen-cast-v5.ts and still under the same ruling: `bestOf` chooses, it does not
// decide. This renders a `GateFailure` with its margin — the margin is what tells an operator
// a threshold from a bad drawing.
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
  throw new Error(`${msg}\n  Nothing is written for this character. Use gen-cast-v5.ts.`)
}

// Per-asset spend ledger (persisted per character as spend.json).
const assetSpend: Record<string, number> = {}
let currentAsset = ''

type GenResult = { raw: Buffer; images: number; cost: number }

// Pre-checks the reserve without committing it (an HTTP failure must not burn budget),
// then records the ACTUAL reported cost. If actual overruns remaining cap the raw is
// still cached (it is paid for) before the hard stop.
async function generate(
  prompt: string,
  refs: Buffer[],
  size: string,
  reserve: number,
): Promise<GenResult> {
  if (budget.total + reserve > CAP)
    throw new OutOfBudget(
      `reserve $${reserve.toFixed(3)} exceeds remaining cap ($${budget.total.toFixed(3)} of $${CAP} spent)`,
    )
  const body: Record<string, unknown> = {
    model: MODEL,
    prompt,
    size,
    response_format: 'b64_json',
    input_references: refs.map((r) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${r.toString('base64')}` },
    })),
    usage: { include: true },
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const images = (json.data ?? []).filter((d) => d.b64_json)
  const b64 = images[images.length - 1]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json in data[] (${json.data?.length ?? 0} entries)`)
  const cost = json.usage?.cost ?? reserve
  return { raw: Buffer.from(b64, 'base64'), images: images.length, cost }
}

// Crash-proof raw cache; no judge, no scores — candidate choice is mechanical.
async function candidate(
  dir: string,
  key: string,
  prompt: string,
  refs: Buffer[],
  size: string,
  reserve: number,
): Promise<Buffer> {
  const rawPath = `${dir}/raws/${key}.png`
  if (existsSync(rawPath)) {
    console.log(`  ${key}: reusing cached raw`)
    return readFileSync(rawPath)
  }
  const r = await generate(prompt, refs, size, reserve)
  writeFileSync(rawPath, r.raw)
  assetSpend[currentAsset] = (assetSpend[currentAsset] ?? 0) + r.cost
  try {
    budget.spend(r.cost)
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      console.log(`  ${key}: cost $${r.cost.toFixed(3)} overran the cap — HARD STOP (raw cached)`)
      throw new OutOfBudget(e.message)
    }
    throw e
  }
  console.log(
    `  ${key}: generated ($${r.cost.toFixed(3)}, ${r.images} image${r.images === 1 ? '' : 's'}), total spend $${budget.total.toFixed(3)}`,
  )
  return r.raw
}

// ── prompts: the calibrated gen-character-v4 texts, persona descriptors swapped ─
const VIEW: Record<AuthoredFacing, string> = {
  se: 'front three-quarter view, facing bottom-right',
  ne: 'back three-quarter view seen from behind, facing top-right, back of the head visible, NO face visible',
}
const VIEW_REF: Record<AuthoredFacing, string> = {
  se: 'the LEFT figure of the last reference image',
  ne: 'the RIGHT figure of the last reference image',
}
const POSE_V4: Record<StripPoseV4, string> = {
  idle: 'standing at rest, both feet planted, arms relaxed at the sides',
  'contact-a':
    'walk cycle CONTACT pose A: legs at full stride spread, one foot planted forward, the other back with heel lifting, opposite arm swung forward',
  passing:
    'walk cycle PASSING pose: legs close together, one foot lifted and passing under the body, the other leg planted straight, arms near the sides',
  'contact-b':
    'walk cycle CONTACT pose B: legs at full stride spread, the OTHER foot planted forward this time, its opposite arm swung forward',
}
type WalkPose = Exclude<StripPoseV4, 'idle'>
const WALK_POSES: readonly WalkPose[] = ['contact-a', 'passing', 'contact-b']

function conceptPrompt(m: CastMember): string {
  return (
    'High-detail character concept art in a warm storybook box-art style, full body, ' +
    'three-quarter view, soft painterly rendering with rich material detail. This image ' +
    "establishes the character's costume, exact palette and accessories for a cozy " +
    'pixel-art village game (warm cozy pastel: cream stone, honey wood, sage green, dusty rose). ' +
    `Subject: ${m.desc}. ${m.featureCap} ` +
    'Plain soft warm background, single character only, no text, no logos.'
  )
}

function masterPrompt(m: CastMember): string {
  const proportionClause = PROPORTION_REF
    ? 'The second reference image shows ANOTHER villager of this same game in the exact required ' +
      'layout: LEFT figure is the front three-quarter view facing bottom-right, RIGHT figure is the ' +
      'back three-quarter view facing top-right with NO face visible. Match that layout, the ' +
      '3-heads-tall chibi body proportions, the big round head, the chunky pixel size and the ' +
      "simplification level EXACTLY — but do NOT copy that villager's costume, colors or identity. "
    : ''
  return (
    `${STYLE_PROMPT} Exactly TWO figures of the SAME character side by side on the magenta background, ` +
    `evenly spaced with a clear magenta gap between them, whole body and feet visible on both. ` +
    `LEFT figure: ${VIEW.se}. RIGHT figure: ${VIEW.ne}. ` +
    `The two figures are identical in costume, colors and proportions — only the view changes. ` +
    proportionClause +
    `The ONLY content is the two figures of the villager: NO buildings, NO houses, NO scenery, NO ground ` +
    `plane, NO path — do NOT draw the building from the first reference image (it is a STYLE reference only). ` +
    `NO text, NO words, NO labels, NO captions anywhere. NO shadow under the figures. ` +
    `Subject: ${m.desc}. ${m.featureCap} ${BIG_PIXEL} ` +
    'Each figure stands about three quarters of the frame height tall, with clear magenta margin ' +
    'above and below; figures must NOT touch the edges of the image.'
  )
}

function framePrompt(m: CastMember, f: AuthoredFacing, p: WalkPose): string {
  return (
    `${STYLE_PROMPT} A single character sprite, exactly ONE figure (count: 1 figure), whole body and ` +
    `feet visible, centered on the magenta background. The figure is the ${VIEW[f]} — exactly the same ` +
    `character, costume and colors as ${VIEW_REF[f]}, with the same chunky pixel look: the visible square ` +
    `pixels must be the SAME SIZE relative to the body as in the reference figure. Pose: ${POSE_V4[p]}. ` +
    `NO text, NO words, NO labels, NO captions. NO shadow under the figure. NO buildings, NO houses, ` +
    `NO scenery, NO ground plane — do NOT draw the building from the first reference image (it is a STYLE ` +
    `reference only). The ONLY content is the single figure on magenta. ` +
    `Subject: ${m.desc}. ${m.featureCap} ${BIG_PIXEL} ` +
    'The figure stands about four fifths of the frame height tall, with clear magenta margin on all sides; ' +
    'the figure must NOT touch the edges of the image.'
  )
}

function sleepPrompt(m: CastMember): string {
  return (
    `${STYLE_PROMPT} A single character sprite, exactly one figure — exactly the same character, costume and ` +
    `colors as the figures in the last reference image, at the same chunky pixel scale. The character is lying ` +
    // "body fully horizontal" asked for a body flat across the SCREEN and got it: three of the
    // five shipped that way. On a 2:1 dimetric ground the body runs along the ground diagonal.
    `curled on their side fast asleep, seen from the same high three-quarter angle as the ` +
    `reference figures, the body lying ALONG THE GROUND going away up to the right — head at ` +
    `the upper right, knees drawn up and both feet at the lower left, NOT flat across the ` +
    `picture. Head resting on the ground in profile, cheek down, eyes closed, relaxed peaceful ` +
    `face; arms tucked in front of the chest and NOT propping the head up. Same outfit. ` +
    `NO text, NO labels. NO shadow under the figure. NO bed, NO pillow, NO props. ` +
    `NO buildings, NO houses, NO scenery, NO ground plane — do NOT draw the building from the first ` +
    `reference image (it is a STYLE reference only). The ONLY content is the single sleeping figure ` +
    `on the magenta background. Subject: ${m.desc}. ${m.featureCap} ${BIG_PIXEL}`
  )
}

// ── chroma key (adaptive tolerance, drift-proofed in phase 2) ─────────────────
function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  throw new Error(
    'keyBg: <10% background keyed even at tolerance 110 — not a magenta-background image',
  )
}

// ── gate views: hi-res cell → legacy 96 canvas (majority downscale + anchor) ──
const MAX_ART_H = FEET_Y_V2 + 1
function gateView(img: RawImage): RawImage {
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  const fitted =
    k === 1
      ? img
      : downscaleMajority(
          img,
          Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
          Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))),
        )
  return anchorToCanvas(fitted, CELL_V2, CELL_V2, FEET_Y_V2)
}

const CALIBRATED_MEDIAN = 0.31
// A palette jaccard far below the 0.80 gate means the character's identity broke.
const PALETTE_HARD_FLOOR = 0.6

const globalReport: string[] = []

// ── per-character pipeline ────────────────────────────────────────────────────
async function runCharacter(m: CastMember): Promise<void> {
  // PROD_OUT redirects a single-character run to a fresh dir (e.g. amara-v2) so a
  // regen neither reuses the old raw cache nor overwrites the v1 production set.
  const DIR =
    process.env.PROD_OUT && RUN_CAST.length === 1 ? process.env.PROD_OUT : `${PRODUCTION}/${m.id}`
  for (const d of [`${DIR}/raws`, `${DIR}/cells`, `${DIR}/master`, `${DIR}/gifs`])
    mkdirSync(d, { recursive: true })
  currentAsset = m.id
  const report: string[] = []
  const push = (line: string) => {
    report.push(line)
    console.log(`  ${line}`)
  }
  console.log(`\n== ${m.id} ==`)

  // concept (identity root; single candidate — the master gates + batch eyeball select)
  const concept = await candidate(
    DIR,
    `concept-${m.id}-c0`,
    conceptPrompt(m),
    [STYLE_ANCHOR],
    '1024x1024',
    0.08,
  )

  // master pair: 2 candidates, pick by pixel pitch among those that slice into 2 figures.
  // A 3rd candidate funds only when no usable master reached pitch 6 (nadia-attempt1:
  // c0 failed keyBg entirely and the pitch-4 c1 won unopposed — off chibi scale).
  const MASTER_MIN_PITCH = 6
  type Master = {
    key: string
    raw: Buffer
    se: RawImage
    ne: RawImage
    pitch: number
    frontBack: number
  }
  const masters: Master[] = []
  // MASTER_OVERRIDE=<key> pins a specific cached raw (e.g. an edit-call output) as the
  // sole master candidate — used for the yusuf NE-head facing fix.
  const override = process.env.MASTER_OVERRIDE
  const masterKeys = override && override.startsWith(`master-${m.id}`) ? [override] : null
  const masterRefs = PROPORTION_REF
    ? [STYLE_ANCHOR, PROPORTION_REF, concept]
    : [STYLE_ANCHOR, concept]
  for (let i = 0; i < (masterKeys ? masterKeys.length : 3); i++) {
    if (!masterKeys && i === 2 && masters.some((x) => x.pitch >= MASTER_MIN_PITCH)) break
    const key = masterKeys ? masterKeys[i]! : `master-${m.id}-c${i}`
    const raw = await candidate(DIR, key, masterPrompt(m), masterRefs, '1024x1024', 0.08)
    try {
      const segs = sliceStrip(keyBg(await decodePng(raw)), 2)
      const pitches = segs.map((s) => estimatePitch(s))
      const seHi = processHiResCell(segs[0]!)
      const seH = (() => {
        const b = opaqueBbox(seHi)!
        return b.y1 - b.y0 + 1
      })()
      const neHi = processHiResCell(segs[1]!, seH)
      const frontBack = cellDistance(gateView(seHi), gateView(neHi))
      const pitch = Math.min(...pitches)
      push(
        `${key}: sliced OK, pitch=${pitches.map((p) => p.toFixed(2)).join('/')}, front-back distance=${frontBack.toFixed(3)}`,
      )
      masters.push({ key, raw, se: seHi, ne: neHi, pitch, frontBack })
    } catch (e) {
      push(`${key}: process FAILED — ${String(e).slice(0, 200)}`)
    }
  }
  if (masters.length === 0)
    throw new Error(`${m.id}: both master candidates failed to slice into two figures`)
  masters.sort((a, b) => b.pitch - a.pitch)
  const master = masters[0]!
  push(`master chosen: ${master.key} (picked by pixel pitch)`)
  writeFileSync(`${DIR}/master/master.png`, master.raw)
  writeFileSync(`${DIR}/master/master-se.png`, await encodePng(master.se))
  writeFileSync(`${DIR}/master/master-ne.png`, await encodePng(master.ne))

  const idleHi: Record<AuthoredFacing, RawImage> = { se: master.se, ne: master.ne }
  const seBbox = opaqueBbox(master.se)!
  const TARGET_H = seBbox.y1 - seBbox.y0 + 1
  const masterGate: Record<AuthoredFacing, RawImage> = {
    se: gateView(master.se),
    ne: gateView(master.ne),
  }
  push(
    `idle crops se=${master.se.width}x${master.se.height} ne=${master.ne.width}x${master.ne.height}, figureH=${TARGET_H}`,
  )
  if (process.env.STOP_AFTER_MASTER) {
    push(
      'STOP_AFTER_MASTER set — stopping before walk-frame spend (master crops written for inspection)',
    )
    writeFileSync(`${DIR}/report.txt`, report.join('\n'))
    globalReport.push(
      `${m.id}: stopped after master (inspection), spend $${(assetSpend[m.id] ?? 0).toFixed(3)}`,
    )
    return
  }

  // walk frames: 6 single-figure edit-calls, up to 2 candidates each
  let walkSize = '1024x1536'
  let walkReserve = 0.14

  type FrameCand = { key: string; hi: RawImage; gate: RawImage; failures: GateFailure[] }
  const frameCands: Record<AuthoredFacing, Record<WalkPose, FrameCand[]>> = {
    se: { 'contact-a': [], passing: [], 'contact-b': [] },
    ne: { 'contact-a': [], passing: [], 'contact-b': [] },
  }

  function evalFrame(key: string, f: AuthoredFacing, raw: RawImage): FrameCand {
    const keyed = keyBg(raw)
    // Two side-by-side figures can pass the aspect check (square-ish bbox) and the
    // palette gate (same character twice) — reject on column clustering like sleep
    // (seen on nadia ne-passing-c2, silhouette 2.011 with palette PASS).
    let twoFigures = false
    try {
      sliceStrip(keyed, 2)
      twoFigures = true
    } catch {
      /* single cluster — good */
    }
    if (twoFigures) throw new Error('slices into 2 figure clusters — multi-figure frame')
    const hi = processHiResCell(keyed, TARGET_H)
    const b = opaqueBbox(hi)!
    const aspect = (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1)
    if (aspect > 1.15)
      throw new Error(`aspect ${aspect.toFixed(2)} > 1.15 — likely multi-figure or lying`)
    const gate = gateView(hi)
    return { key, hi, gate, failures: coherenceGateV4(key, masterGate[f], gate) }
  }

  async function genFrame(f: AuthoredFacing, p: WalkPose, i: number): Promise<FrameCand | null> {
    const key = `walk-${m.id}-${f}-${p}-c${i}`
    for (;;) {
      let raw: Buffer
      try {
        // WALK_NO_STYLE_ANCHOR drops the cottage style ref from walk-frame calls — the
        // master ref alone carries style+identity. Escape hatch for poses where the
        // style-anchor cottage keeps bleeding in as scenery (amara-v2 ne-passing x5).
        const walkRefs = process.env.WALK_NO_STYLE_ANCHOR
          ? [master.raw]
          : [STYLE_ANCHOR, master.raw]
        raw = await candidate(DIR, key, framePrompt(m, f, p), walkRefs, walkSize, walkReserve)
      } catch (e) {
        if (e instanceof OutOfBudget) throw e
        if (walkSize !== '1024x1024' && String(e).includes('HTTP')) {
          console.log(
            `  ${walkSize} rejected (${String(e).slice(0, 160)}); falling back to 1024x1024`,
          )
          walkSize = '1024x1024'
          walkReserve = 0.08
          continue
        }
        push(`${key}: generation FAILED — ${String(e).slice(0, 200)}`)
        return null
      }
      try {
        const cand = evalFrame(key, f, await decodePng(raw))
        push(
          `${key}: gates=${cand.failures.length === 0 ? 'PASS' : cand.failures.map((x) => `${x.gate}(${x.value.toFixed(3)})`).join(',')}`,
        )
        return cand
      } catch (e) {
        push(`${key}: process FAILED — ${String(e).slice(0, 200)}`)
        return null
      }
    }
  }

  // Identity-broken = wrong costume colors (palette below the hard floor) OR an extreme
  // silhouette (cottage-bleed frames draw the whole building: opaque area 1.8-2.3x the
  // master; nadia's se-passing c1 dodged the 0.6 palette floor at exactly 0.600).
  function identityBroken(c: FrameCand): boolean {
    return c.failures.some(
      (x) =>
        (x.gate === 'palette' && x.value < PALETTE_HARD_FLOOR) ||
        (x.gate === 'silhouette' && (x.value > 1.5 || x.value < 0.55)),
    )
  }
  function bestOf(cands: FrameCand[]): FrameCand | null {
    return cands.reduce<FrameCand | null>((a, c) => {
      if (!a) return c
      if (identityBroken(a) !== identityBroken(c)) return identityBroken(a) ? c : a
      return c.failures.length < a.failures.length ? c : a
    }, null)
  }

  const chosen: Record<AuthoredFacing, Record<WalkPose, FrameCand>> = { se: {}, ne: {} } as never
  for (const f of AUTHORED_FACINGS) {
    console.log(` walk frames ${m.id}/${f}`)
    for (const p of WALK_POSES) {
      const c = await genFrame(f, p, 0)
      if (c) frameCands[f][p].push(c)
      if (!c || c.failures.length > 0) {
        const retry = await genFrame(f, p, 1)
        if (retry) frameCands[f][p].push(retry)
      }
      let best = bestOf(frameCands[f][p])
      if (!best) throw new Error(`${m.id} ${f}/${p}: every candidate failed processing`)
      // An identity-broken frame (concept bleed, wrong costume) inside the walk cycle is
      // worse than one more call: fund a 3rd candidate before accepting it.
      if (identityBroken(best)) {
        const extra = await genFrame(f, p, 2)
        if (extra) {
          frameCands[f][p].push(extra)
          best = bestOf(frameCands[f][p])!
        }
      }
      refuseFailing(
        `${m.id} ${f}/${p}`,
        frameCands[f][p].map((c) => ({ key: c.key, failures: c.failures })),
      )
      chosen[f][p] = best
    }
    let stride = strideGateV4(
      f,
      {
        idle: masterGate[f],
        'contact-a': chosen[f]['contact-a'].gate,
        passing: chosen[f]['passing'].gate,
        'contact-b': chosen[f]['contact-b'].gate,
      },
      CALIBRATED_MEDIAN,
    )
    if (stride.length > 0) {
      const pose = stride[0]!.b.split('/')[1] as WalkPose
      if (frameCands[f][pose].length < 2) {
        console.log(
          `  stride flagged (${stride[0]!.gate} ${stride[0]!.a}~${stride[0]!.b}); retrying ${f}/${pose}`,
        )
        const retry = await genFrame(f, pose, 1)
        if (retry) {
          frameCands[f][pose].push(retry)
          const alt = { ...chosen[f], [pose]: retry }
          const altStride = strideGateV4(
            f,
            {
              idle: masterGate[f],
              'contact-a': alt['contact-a'].gate,
              passing: alt['passing'].gate,
              'contact-b': alt['contact-b'].gate,
            },
            CALIBRATED_MEDIAN,
          )
          if (
            altStride.length + retry.failures.length <
            stride.length + chosen[f][pose].failures.length
          ) {
            chosen[f][pose] = retry
            stride = altStride
          }
        }
      }
    }
    for (const x of stride)
      push(
        `${f} stride: ${x.gate} ${x.a}~${x.b} value=${x.value.toFixed(3)} limit=${x.limit.toFixed(3)}`,
      )
    push(
      `${f} trio: ${WALK_POSES.map((p) => chosen[f][p].key).join(', ')} stride=${stride.length === 0 ? 'PASS' : 'FAILED'}`,
    )
    // The trio is a property of three frames already chosen, so there is no candidate to
    // re-roll: the failure is the character's, loudly. It used to log a flag and go on.
    refuseFailing(`${m.id} ${f}/stride-trio`, [
      {
        key: `${f}: ${WALK_POSES.map((p) => chosen[f][p].key).join(', ')}`,
        failures: stride,
      },
    ])
  }

  // sleep: up to 2 candidates, master attached
  type SleepCand = { key: string; hi: RawImage; failures: GateFailure[] }
  const sleepCands: SleepCand[] = []
  for (let i = 0; i < 2; i++) {
    const key = `sleep-${m.id}-c${i}`
    const raw = await candidate(
      DIR,
      key,
      sleepPrompt(m),
      [STYLE_ANCHOR, master.raw],
      '1024x1024',
      0.08,
    )
    try {
      const keyed = keyBg(await decodePng(raw))
      // Two standing figures pass the lying (wider-than-tall) sanity check — reject
      // any candidate that slices into 2 column clusters (seen on yusuf sleep-c0).
      let twoFigures = false
      try {
        sliceStrip(keyed, 2)
        twoFigures = true
      } catch {
        /* single cluster — good */
      }
      if (twoFigures)
        throw new Error('slices into 2 figure clusters — not a single sleeping figure')
      let hi = processHiResCell(keyed)
      // lying figure: normalize body LENGTH (opaque width) to the standing figure height
      const b = opaqueBbox(hi)!
      const bw = b.x1 - b.x0 + 1
      if (bw !== TARGET_H) {
        const k = TARGET_H / bw
        hi = downscaleNearest(
          hi,
          Math.max(1, Math.round(hi.width * k)),
          Math.max(1, Math.round(hi.height * k)),
        )
      }
      const failures = sleepCoherenceGateV4(masterGate.se, gateView(hi))
      push(
        `${key}: gates=${failures.length === 0 ? 'PASS' : failures.map((x) => `${x.gate}(${x.value.toFixed(3)})`).join(',')}`,
      )
      sleepCands.push({ key, hi, failures })
    } catch (e) {
      push(`${key}: process FAILED — ${String(e).slice(0, 200)}`)
    }
    if (sleepCands.some((c) => c.failures.length === 0)) break
  }
  const sleep = sleepCands.reduce<SleepCand | null>(
    (a, c) => (!a || c.failures.length < a.failures.length ? c : a),
    null,
  )
  if (!sleep) throw new Error(`${m.id}: every sleep candidate failed processing`)
  refuseFailing(
    `${m.id} sleep`,
    sleepCands.map((c) => ({ key: c.key, failures: c.failures })),
  )

  // derivation (zero spend): 9 authored hi-res cells → the 24-cell contract
  const cells = deriveSheet({
    strips: {
      se: {
        idle: idleHi.se,
        'contact-a': chosen.se['contact-a'].hi,
        passing: chosen.se['passing'].hi,
        'contact-b': chosen.se['contact-b'].hi,
      },
      ne: {
        idle: idleHi.ne,
        'contact-a': chosen.ne['contact-a'].hi,
        passing: chosen.ne['passing'].hi,
        'contact-b': chosen.ne['contact-b'].hi,
      },
    },
    sleep: sleep.hi,
  })
  for (const [name, img] of cells) writeFileSync(`${DIR}/cells/${name}.png`, await encodePng(img))
  const manifest = buildManifestV4(cells, TARGET_H)
  writeFileSync(`${DIR}/manifest.json`, JSON.stringify(manifest, null, 2))

  // preview cells: lanczos downscale to a uniform figure height (the webview
  // contract: place by manifest feet anchor, scale by figureH), 384px canvas
  const PREVIEW_CELL = 384
  const PREVIEW_FIG_H = 320
  const PREVIEW_FEET = { x: PREVIEW_CELL / 2, y: 352 }
  async function previewCell(img: RawImage): Promise<RawImage> {
    const k = PREVIEW_FIG_H / TARGET_H
    const w = Math.max(1, Math.round(img.width * k)),
      h = Math.max(1, Math.round(img.height * k))
    const buf = await sharp(
      Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength),
      { raw: { width: img.width, height: img.height, channels: 4 } },
    )
      .resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
      .raw()
      .toBuffer()
    const scaled: RawImage = { width: w, height: h, data: new Uint8ClampedArray(buf) }
    const a = cellAnchor(img)
    const left = Math.round(PREVIEW_FEET.x - a.feetX * k),
      top = Math.round(PREVIEW_FEET.y - a.feetY * k)
    const out = new Uint8ClampedArray(PREVIEW_CELL * PREVIEW_CELL * 4)
    for (let y = 0; y < h; y++) {
      const dy = top + y
      if (dy < 0 || dy >= PREVIEW_CELL) continue
      for (let x = 0; x < w; x++) {
        const dx = left + x
        if (dx < 0 || dx >= PREVIEW_CELL) continue
        const s = (y * w + x) * 4
        if (scaled.data[s + 3] === 0) continue
        out.set(scaled.data.subarray(s, s + 4), (dy * PREVIEW_CELL + dx) * 4)
      }
    }
    return { width: PREVIEW_CELL, height: PREVIEW_CELL, data: out }
  }
  const preview = new Map<string, RawImage>()
  for (const [name, img] of cells) preview.set(name, await previewCell(img))

  // contact sheet: masters | SE walk | NE walk | sleep | derived SW+NW row
  const BLANK: RawImage = {
    width: PREVIEW_CELL,
    height: PREVIEW_CELL,
    data: new Uint8ClampedArray(PREVIEW_CELL * PREVIEW_CELL * 4),
  }
  const pad = (row: RawImage[], cols: number) => [
    ...row,
    ...(Array(cols - row.length).fill(BLANK) as RawImage[]),
  ]
  const stripRow = async (f: AuthoredFacing) => [
    preview.get(`idle-${f}`)!,
    ...(await Promise.all(WALK_POSES.map((p) => previewCell(chosen[f][p].hi)))),
  ]
  const contactRows: RawImage[][] = [
    pad([preview.get('idle-se')!, preview.get('idle-ne')!], 8),
    pad(await stripRow('se'), 8),
    pad(await stripRow('ne'), 8),
    pad([preview.get('sleep-se')!], 8),
    [
      ...(['idle', 'contact-a', 'passing-a', 'contact-b'] as const).map(
        (p) => preview.get(`${p}-sw`)!,
      ),
      ...(['idle', 'contact-a', 'passing-a', 'contact-b'] as const).map(
        (p) => preview.get(`${p}-nw`)!,
      ),
    ],
  ]
  writeFileSync(
    `${DIR}/contact-sheet.png`,
    await encodePng(assembleGrid(contactRows, PREVIEW_CELL, PREVIEW_CELL)),
  )

  // 4 walking GIFs: F1-F2-F1-F3 (contact-a → passing → contact-b → passing)
  for (const f of FACINGS) {
    const frames = WALK_CYCLE_V4.map(
      (p) => preview.get(`${p === 'passing' ? 'passing-a' : p}-${f}`)!,
    )
    const fw = frames[0]!.width,
      fh = frames[0]!.height
    const stacked = new Uint8ClampedArray(fw * fh * frames.length * 4)
    frames.forEach((fr, i) => stacked.set(fr.data, fw * fh * 4 * i))
    const gif = await sharp(Buffer.from(stacked.buffer), {
      raw: { width: fw, height: fh * frames.length, channels: 4, pageHeight: fh },
    })
      .gif({ delay: frames.map(() => WALK_FRAME_MS), loop: 0 })
      .toBuffer()
    writeFileSync(`${DIR}/gifs/walk-${f}.gif`, gif)
  }

  const finalFailures = [
    ...AUTHORED_FACINGS.flatMap((f) => WALK_POSES.flatMap((p) => chosen[f][p].failures)),
    ...AUTHORED_FACINGS.flatMap((f) =>
      strideGateV4(
        f,
        {
          idle: masterGate[f],
          'contact-a': chosen[f]['contact-a'].gate,
          passing: chosen[f]['passing'].gate,
          'contact-b': chosen[f]['contact-b'].gate,
        },
        CALIBRATED_MEDIAN,
      ),
    ),
    ...sleep.failures,
  ]
  const measuredMedian = pairwiseMedian([
    ...AUTHORED_FACINGS.map((f) => masterGate[f]),
    ...AUTHORED_FACINGS.flatMap((f) => WALK_POSES.map((p) => chosen[f][p].gate)),
  ])
  const charReport = [
    `== ${m.id} (v3 production): mechanical gates ${finalFailures.length === 0 ? 'PASS' : 'FLAGGED'} ==`,
    'FACING VERDICT: none — human eyeball on contact-sheet.png + gifs/ is the gate.',
    `walk generation size: ${walkSize}; cells stored at native resolution, figureH=${TARGET_H}`,
    '',
    '== candidates ==',
    ...report,
    '',
    `chosen: master=${master.key} walk=${AUTHORED_FACINGS.flatMap((f) => WALK_POSES.map((p) => chosen[f][p].key)).join(',')} sleep=${sleep.key}`,
    `gate-view pairwise median (8 standing cells)=${measuredMedian.toFixed(3)} (gate ratios ran against calibrated ${CALIBRATED_MEDIAN})`,
    '',
    '== remaining gate failures ==',
    ...(finalFailures.length === 0
      ? ['none']
      : finalFailures.map(
          (x) =>
            `${x.gate}  ${x.a} ~ ${x.b}  value=${x.value.toFixed(3)} limit=${x.limit.toFixed(3)}`,
        )),
    '',
    `asset spend: $${(assetSpend[m.id] ?? 0).toFixed(3)}`,
  ].join('\n')
  writeFileSync(`${DIR}/report.txt`, charReport)
  // read-merge-write: reruns must add to the cumulative asset spend, not clobber it
  let prevSpend = 0
  try {
    prevSpend =
      (JSON.parse(readFileSync(`${DIR}/spend.json`, 'utf8')) as { spendUsd?: number }).spendUsd ?? 0
  } catch {
    /* first run */
  }
  writeFileSync(
    `${DIR}/spend.json`,
    JSON.stringify({ asset: m.id, spendUsd: prevSpend + (assetSpend[m.id] ?? 0) }, null, 2),
  )
  globalReport.push(
    `${m.id}: gates ${finalFailures.length === 0 ? 'PASS' : `FLAGGED (${finalFailures.length})`}, spend $${(assetSpend[m.id] ?? 0).toFixed(3)}`,
  )
  console.log(charReport)
}

// ── run: characters in cast order; stop cleanly on budget exhaustion ─────────
for (const m of RUN_CAST) {
  try {
    await runCharacter(m)
  } catch (e) {
    if (e instanceof OutOfBudget) {
      globalReport.push(`${m.id}: STOPPED — out of budget (${String(e).slice(0, 120)})`)
      console.log(`\n${m.id}: STOPPED — out of budget`)
      break
    }
    globalReport.push(`${m.id}: FAILED — ${String(e).slice(0, 200)}`)
    console.log(`\n${m.id}: FAILED — ${String(e).slice(0, 300)}`)
  }
}
const summary = [
  '== CAST PRODUCTION SUMMARY ==',
  'FACING VERDICT: none — human eyeball on the batch artifacts is the gate.',
  ...globalReport,
  `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
].join('\n')
mkdirSync(PRODUCTION, { recursive: true })
writeFileSync(`${PRODUCTION}/cast-summary.txt`, summary)
console.log(`\n${summary}`)
