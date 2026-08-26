// LIVE (cast portrait run) — cap $PORTRAIT_CAST_CAP (default $3.55). The gen-portraits recipe
// per cast member, anchored on the character's ADOPTED production master instead of a concept.
// A character only starts when ≥$START_HEADROOM remains, so no set is left half-finished.
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs'
import { BudgetGuard, BudgetExceededError } from '../src/budget.js'
import { makeVlmJudge, type JudgeFn } from '../src/judge.js'
import { STYLE_PROMPT } from '../src/styleBible.js'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  estimatePitch,
  v7Chain,
  anchorToCanvas,
  opaqueBbox,
  upscaleNearest,
  paletteJaccard,
  assembleGrid,
} from '../src/sheet.js'
import { scratch } from './scratch.js'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) throw new Error('OPENROUTER_API_KEY not set')
const CAP = Number(process.env.PORTRAIT_CAST_CAP ?? '3.55')
const budget = new BudgetGuard(CAP)
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const RESERVE = 0.046
// Measured $0.696/character (B3) + worst-case 3rd-candidate margin.
const START_HEADROOM = 0.95

const SCRATCH = scratch('c5')
const PRODUCTION = `${SCRATCH}/production`
const STYLE_ANCHOR = readFileSync('packages/forge/content/reference/style-anchor.png')

const SHIP = 128
const PORTRAIT_JACCARD_MIN = 0.75
const PORTRAIT_BBOX_TOL = 0.12

const EXPRESSIONS = ['happy', 'sad', 'angry', 'surprised', 'weary', 'asleep'] as const
type Expression = (typeof EXPRESSIONS)[number]
const EXPRESSION_CLAUSES: Record<Expression, string> = {
  happy: 'beaming with a warm open smile, bright eyes',
  sad: 'downcast eyes, drooping mouth, gently sorrowful',
  angry: 'furrowed brow, puffed cheeks, cross frown',
  surprised: 'wide eyes, raised eyebrows, small open mouth',
  weary: 'half-closed heavy eyelids, tired slump, faint sigh',
  asleep: 'eyes fully closed, serene sleeping face, head tilted slightly',
}

// Portrait-scale identities: the sprite descs re-expanded with the costume detail the
// v3 feature caps dropped, kept consistent with each ADOPTED master (the identity ref).
type PortraitMember = { id: string; desc: string }
const PORTRAIT_CAST: readonly PortraitMember[] = [
  {
    id: 'amara',
    desc:
      'a kind woman healer villager with grey-streaked hair under a soft water-blue headscarf ' +
      'knotted at the side, gentle tired eyes, a cream apron dress with honey-gold trim over a ' +
      'warm-grey skirt, and the worn brown leather strap of her herb satchel crossing her chest',
  },
  {
    id: 'yusuf',
    desc:
      'a sturdy older man villager with a short grey beard and heavy brows, weathered face, ' +
      'wearing a warm-grey flat cap and a honey-brown carpenter apron with a chest pocket over ' +
      'a cream work shirt with rolled sleeves',
  },
  {
    id: 'nadia',
    desc:
      'a young adult woman villager with honey-brown hair in a single long braid over her ' +
      'shoulder, bright attentive eyes and light freckles, wearing a straw sun hat with a brown ' +
      'band and a sage-green work dress with a simple round collar',
  },
  {
    id: 'salma',
    desc:
      'a stout middle-aged woman villager with dark hair in a neat round bun, warm rosy cheeks, ' +
      'wearing a dusty-rose dress with pale sage trim and a white cooking apron tied high',
  },
]

const CAST_FILTER = (process.env.CAST ?? PORTRAIT_CAST.map((c) => c.id).join(','))
  .split(',')
  .map((s) => s.trim())
const RUN_CAST = PORTRAIT_CAST.filter((c) => CAST_FILTER.includes(c.id))
if (RUN_CAST.length === 0) throw new Error(`CAST=${process.env.CAST} matches no cast member`)

class OutOfBudget extends Error {}
const assetSpend: Record<string, number> = {}

async function generate(asset: string, prompt: string, refs: Buffer[]): Promise<Buffer> {
  if (budget.total + RESERVE > CAP)
    throw new OutOfBudget(
      `reserve $${RESERVE} exceeds remaining cap ($${budget.total.toFixed(3)} of $${CAP} spent)`,
    )
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: '512x512',
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
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error(`${MODEL}: no data[0].b64_json`)
  const cost = json.usage?.cost ?? RESERVE
  assetSpend[asset] = (assetSpend[asset] ?? 0) + cost
  try {
    budget.spend(cost)
  } catch (e) {
    if (e instanceof BudgetExceededError) throw new OutOfBudget(e.message)
    throw e
  }
  return Buffer.from(b64, 'base64')
}

function portraitPrompt(desc: string, expressionClause: string): string {
  return (
    `${STYLE_PROMPT} A large character portrait, bust framing (head and shoulders), the same single ` +
    `character as the villager in the reference images, painted pixel-art style, facing slightly toward ` +
    `the viewer's left. Expression: ${expressionClause}. Subject: ${desc}. ` +
    `Exactly the same face, hair, costume and colors as the sprite master in the references, rendered at ` +
    `portrait detail. The ONLY content is the single bust on the magenta background: NO buildings, NO houses, ` +
    `NO scenery — do NOT draw the building from the first reference image (it is a STYLE reference only). ` +
    `NO text, NO words, NO labels anywhere.`
  )
}

// Adaptive-tolerance keying: nadia's raws drifted pinker than #FF00FF and dodged a fixed
// tolerance-72 check, shipping magenta squares. Sweep 72->110; a keyed result needs >=10% cleared.
function keyIfMagenta(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const corners = [
      0,
      (img.width - 1) * 4,
      (img.height - 1) * img.width * 4,
      (img.width * img.height - 1) * 4,
    ]
    const magenta = corners.filter((i) => {
      const r = img.data[i]!,
        g = img.data[i + 1]!,
        b = img.data[i + 2]!
      return 255 - r <= tolerance && g <= tolerance && 255 - b <= tolerance
    }).length
    if (magenta < 3) continue
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.1) return keyed
  }
  return img
}

async function processPortrait(raw: Buffer): Promise<RawImage> {
  const keyed = keyIfMagenta(await decodePng(raw))
  let art = v7Chain(keyed, estimatePitch(keyed)).out
  if (art.width > SHIP || art.height > SHIP) {
    const k = Math.min(SHIP / art.width, (SHIP - 1) / art.height)
    art = downscaleNearest(
      art,
      Math.max(1, Math.floor(art.width * k)),
      Math.max(1, Math.floor(art.height * k)),
    )
  } else {
    // Chunky-pitch raws (salma ~8px) land well under the ship canvas; integer nearest
    // upscale so every portrait fills the 128 frame like the B3/Omar bar.
    const k = Math.floor(Math.min(SHIP / art.width, (SHIP - 1) / art.height))
    if (k >= 2) art = upscaleNearest(art, k)
  }
  return anchorToCanvas(art, SHIP, SHIP, SHIP - 1)
}

type Candidate = { key: string; raw: Buffer; score: number; notes: string; shipped: RawImage }

const globalReport: string[] = []

async function runCharacter(m: PortraitMember): Promise<void> {
  const DIR = `${PRODUCTION}/${m.id}/portraits`
  const CACHE = `${DIR}/candidates`
  for (const d of [`${DIR}/final`, CACHE]) mkdirSync(d, { recursive: true })
  console.log(`\n== ${m.id} portraits ==`)

  const master = readFileSync(`${PRODUCTION}/${m.id}/master/master.png`)
  const baseRefs = [STYLE_ANCHOR, master]
  const judge: JudgeFn = makeVlmJudge({ apiKey: KEY!, refSheets: baseRefs })

  const SCORES_PATH = `${CACHE}/scores.json`
  const scores = new Map<string, { score: number; notes: string }>(
    Object.entries(
      (() => {
        try {
          return JSON.parse(readFileSync(SCORES_PATH, 'utf8')) as Record<
            string,
            { score: number; notes: string }
          >
        } catch {
          return {}
        }
      })(),
    ),
  )
  const writeScores = () => {
    writeFileSync(SCORES_PATH, JSON.stringify(Object.fromEntries(scores), null, 1))
  }

  // REJECT=<key,...> archives eyeball-rejected candidates (rejected- prefix, provenance
  // kept, score dropped) so the slot regenerates — e.g. salma happy-c0's blonde hair,
  // an identity break the palette gate cannot see.
  for (const key of (process.env.REJECT ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (existsSync(`${CACHE}/${key}.png`) && !existsSync(`${CACHE}/rejected-${key}.png`)) {
      renameSync(`${CACHE}/${key}.png`, `${CACHE}/rejected-${key}.png`)
      scores.delete(key)
      writeScores()
      console.log(`  ${key}: REJECTED by eyeball — archived, slot will regenerate`)
    }
  }

  async function candidate(key: string, prompt: string, refs: Buffer[]): Promise<Candidate | null> {
    const rawPath = `${CACHE}/${key}.png`
    let raw: Buffer
    if (existsSync(rawPath)) {
      raw = readFileSync(rawPath)
      console.log(`  ${key}: reusing cached raw`)
    } else {
      raw = await generate(m.id, prompt, refs)
      writeFileSync(rawPath, raw)
      console.log(`  ${key}: generated, total spend $${budget.total.toFixed(3)}`)
    }
    let shipped: RawImage
    try {
      shipped = await processPortrait(raw)
    } catch (e) {
      console.log(`  ${key}: post-process failed: ${String(e)}`)
      return null
    }
    let v = scores.get(key)
    if (!v) {
      v = await judge(raw)
      scores.set(key, v)
      writeScores()
    }
    writeFileSync(`${CACHE}/${key}-shipped.png`, await encodePng(shipped))
    console.log(`  ${key}: score=${v.score} — ${v.notes}`)
    return { key, raw, score: v.score, notes: v.notes, shipped }
  }

  // ── Stage 1: 3 neutral candidates, best judge score = runner pick ──
  const report: string[] = [
    `== ${m.id} portrait run (B3 recipe, identity anchor = adopted master) ==`,
  ]
  const neutrals: Candidate[] = []
  for (let i = 0; i < 3; i++) {
    const c = await candidate(
      `neutral-c${i}`,
      portraitPrompt(m.desc, 'calm, friendly, neutral resting face'),
      baseRefs,
    )
    report.push(
      c ? `neutral-c${i}: score=${c.score} — ${c.notes}` : `neutral-c${i}: post-process FAILED`,
    )
    if (c) neutrals.push(c)
  }
  if (neutrals.length === 0)
    throw new Error(`${m.id}: every neutral candidate failed post-processing`)
  // NEUTRAL_PICK=<idx> overrides the score pick (single-CAST runs) — used when the top-scored
  // neutral is a framing outlier vs the expression family (nadia: c2 bust 99px wide vs 74).
  const forced =
    process.env.NEUTRAL_PICK !== undefined && RUN_CAST.length === 1
      ? neutrals.find((c) => c.key === `neutral-c${process.env.NEUTRAL_PICK}`)
      : undefined
  const neutralPick = forced ?? neutrals.reduce((a, c) => (c.score > a.score ? c : a))
  report.push(
    `neutral RUNNER PICK: ${neutralPick.key} (${forced ? 'runner-forced for framing consistency' : 'highest judge score'}; human ratification pending, B1/B3 precedent)`,
  )

  const neutral = neutralPick.shipped
  const neutralBbox = opaqueBbox(neutral)!
  const nW = neutralBbox.x1 - neutralBbox.x0 + 1,
    nH = neutralBbox.y1 - neutralBbox.y0 + 1
  writeFileSync(`${DIR}/final/neutral.png`, await encodePng(neutral))
  writeFileSync(`${DIR}/final/neutral-4x.png`, await encodePng(upscaleNearest(neutral, 4)))

  function consistency(img: RawImage): string[] {
    const problems: string[] = []
    const jac = paletteJaccard(neutral, img)
    if (jac < PORTRAIT_JACCARD_MIN)
      problems.push(`palette jaccard ${jac.toFixed(3)} < ${PORTRAIT_JACCARD_MIN}`)
    const b = opaqueBbox(img)
    if (!b) return ['empty image']
    const w = b.x1 - b.x0 + 1,
      h = b.y1 - b.y0 + 1
    if (Math.abs(w / nW - 1) > PORTRAIT_BBOX_TOL)
      problems.push(`bbox width ${w} vs neutral ${nW} beyond ±${PORTRAIT_BBOX_TOL * 100}%`)
    if (Math.abs(h / nH - 1) > PORTRAIT_BBOX_TOL)
      problems.push(`bbox height ${h} vs neutral ${nH} beyond ±${PORTRAIT_BBOX_TOL * 100}%`)
    return problems
  }

  // ── Stage 2: 6 expressions, 2 candidates each (+1 only when both fail) ──
  const exprRefs = [STYLE_ANCHOR, master, neutralPick.raw]
  const finals = new Map<string, RawImage>([['neutral', neutral]])
  let flagged = 0
  for (const expr of EXPRESSIONS) {
    console.log(` expression ${expr}`)
    const cands: { c: Candidate; problems: string[] }[] = []
    for (let i = 0; i < 3; i++) {
      if (i === 2 && cands.some((x) => x.problems.length === 0)) break
      if (i === 2) report.push(`${expr}: both candidates failed consistency — funding 3rd`)
      const c = await candidate(
        `${expr}-c${i}`,
        portraitPrompt(m.desc, EXPRESSION_CLAUSES[expr]),
        exprRefs,
      )
      if (!c) {
        report.push(`${expr}-c${i}: post-process FAILED`)
        continue
      }
      const problems = consistency(c.shipped)
      report.push(
        `${expr}-c${i}: score=${c.score} ${problems.length === 0 ? 'consistency PASS' : `consistency FAIL: ${problems.join('; ')}`} — ${c.notes}`,
      )
      cands.push({ c, problems })
    }
    if (cands.length === 0)
      throw new Error(`${m.id}/${expr}: every candidate failed post-processing`)
    // EXPR_PICK="happy:c0,weary:c1" — eyeball pick among consistency-PASSING candidates
    // (judge is advisory; a passing pick may beat a higher-scored one on family coherence).
    const pickKey = (process.env.EXPR_PICK ?? '')
      .split(',')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${expr}:`))
      ?.split(':')[1]
    const forcedExpr = pickKey
      ? cands.find((x) => x.c.key === `${expr}-${pickKey}` && x.problems.length === 0)
      : undefined
    const best =
      forcedExpr ??
      cands.reduce((a, x) => {
        if ((x.problems.length === 0) !== (a.problems.length === 0))
          return x.problems.length === 0 ? x : a
        return x.c.score > a.c.score ? x : a
      })
    if (forcedExpr)
      report.push(`${expr}: eyeball pick ${forcedExpr.c.key} (consistency PASS; judge advisory)`)
    if (best.problems.length > 0) {
      flagged++
      report.push(`${expr}: ships FLAGGED (${best.c.key}: ${best.problems.join('; ')})`)
    }
    writeFileSync(`${DIR}/final/${expr}.png`, await encodePng(best.c.shipped))
    writeFileSync(`${DIR}/final/${expr}-4x.png`, await encodePng(upscaleNearest(best.c.shipped, 4)))
    finals.set(expr, best.c.shipped)
  }

  // 7-up contact sheet at 4x
  const row = ['neutral', ...EXPRESSIONS].map((k) => upscaleNearest(finals.get(k)!, 4))
  writeFileSync(
    `${DIR}/contact-sheet.png`,
    await encodePng(assembleGrid([row], SHIP * 4, SHIP * 4)),
  )

  report.push(
    '',
    flagged === 0
      ? 'all expressions PASS consistency'
      : `** ${flagged} expression(s) ship FLAGGED **`,
    `character spend: $${(assetSpend[m.id] ?? 0).toFixed(3)}`,
  )
  writeFileSync(`${DIR}/report.txt`, report.join('\n'))
  // Cumulative across re-runs: cached re-processing runs must not clobber paid spend.
  const prevSpend = (() => {
    try {
      return (
        (JSON.parse(readFileSync(`${DIR}/spend.json`, 'utf8')) as { spendUsd?: number }).spendUsd ??
        0
      )
    } catch {
      return 0
    }
  })()
  writeFileSync(
    `${DIR}/spend.json`,
    JSON.stringify(
      { asset: `${m.id}-portraits`, spendUsd: prevSpend + (assetSpend[m.id] ?? 0) },
      null,
      2,
    ),
  )
  globalReport.push(
    `${m.id}: 7/7 shipped, ${flagged === 0 ? 'all gates PASS' : `${flagged} FLAGGED`}, spend $${(assetSpend[m.id] ?? 0).toFixed(3)}`,
  )
  console.log(report.join('\n'))
}

for (const m of RUN_CAST) {
  if (budget.total + START_HEADROOM > CAP) {
    globalReport.push(
      `${m.id}: NOT STARTED — headroom $${(CAP - budget.total).toFixed(3)} < $${START_HEADROOM} (whole-set rule)`,
    )
    console.log(`\n${m.id}: NOT STARTED — insufficient headroom`)
    continue
  }
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
  '== CAST PORTRAIT SUMMARY ==',
  'Neutral picks are RUNNER PICKS pending human ratification (B1/B3 precedent).',
  ...globalReport,
  `total spend: $${budget.total.toFixed(3)} of $${CAP.toFixed(2)}`,
].join('\n')
writeFileSync(`${PRODUCTION}/portraits-summary.txt`, summary)
console.log(`\n${summary}`)
