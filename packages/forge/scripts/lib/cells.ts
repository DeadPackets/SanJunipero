// The half of a building/structure generator run that is the same whichever subjects it draws:
// the palette reference, the provider call, the candidate loop, the commit and the report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Footprint } from '@sj/shared'
import { BudgetGuard } from '../../src/budget.js'
import { SpendLedger } from '../../src/spendLedger.js'
import { keyBg } from '../../src/post/chromaKey.js'
import { paletteSwatchPng } from '../../src/referenceSheet.js'
import { decodePng, encodePng, type RawImage } from '../../src/post/raw.js'
import { cellAnchor } from '../../src/hires.js'
import { buildingCellPx, spriteCell, type SpritePlan } from '../../src/reCell.js'
import { classDensityGate, paletteDistance, spriteDensity } from '../../src/pixelGates.js'
import { TOWN_TILE } from '../../src/assetResolution.js'
import { refusalMessage } from '../../src/gate.js'
import { BUILDINGS_CONTENT_DIR } from '../../src/buildingArt.js'

const MODEL = 'google/gemini-3.1-flash-image'
const GEN_PX = 2048
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'

/** ONE provider call. Shared so a second producer cannot drift from this one's request shape. */
export async function imageGen(o: {
  key: string
  prompt: string
  size: string
  refs: readonly Buffer[]
}): Promise<{ raw: Buffer; cost: number | undefined; width: number; height: number }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: o.prompt,
      size: o.size,
      response_format: 'b64_json',
      input_references: o.refs.map((r) => ({
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
  const [w, h] = o.size.split('x').map(Number)
  return { raw: Buffer.from(b64, 'base64'), cost: json.usage?.cost, width: w!, height: h! }
}

export const GEN_MODEL = MODEL

// ★ `integerScaleGate(GEN_PX, cellPx)` used to stand here, and it refused cells that are provably
// clean: `spriteCell` divides by `ceil(subjectPx / cellPx)`, so the divide is ALWAYS whole and the
// window ALWAYS contains the subject — GEN_PX needing to be a multiple of cellPx was never the
// property. Measured on the cached raws: cottage (cellPx 640, window 1920 INSIDE the 2048 source)
// was refused, and farmhouse (window 2304, overrunning by 256) came out 630x651 = exactly its
// source subject divided by 3, binary alpha, feet on the last row. What can really go wrong is a
// subject too SMALL for its canvas, so that is what refuses one now.
const CELL_FILL_MIN = 0.6

// The palette, in words, for the calls that carry no building reference.
export const PALETTE_WORDS = [
  'Colour it from a warm cozy pastel palette ONLY: cream stone (#FFF6E9 #F6E8D5 #E8D5BC',
  '#D4BC9E #B89D7E), honey wood (#F2C879 #E0A95E #C68A48 #A66E38 #7E512B), sage green',
  '(#DCE8C8 #B9D19A #93B573 #6F9455 #4F7040), dusty rose (#F2C6C2 #E09E9B #C47876 #9E5A5C),',
  'warm grey (#E9E2DA #CFC6BC #ABA198 #857D75 #5D5751) and near-black ink (#43394A #322B38).',
  'Flat blocks of these colours with hard pixel edges, no gradients, no anti-aliasing.',
].join(' ')

/** One cell to draw: a subject in one facing, already resolved to its prompt and reference. */
export type CellJob = {
  label: string // the content directory and the report row, e.g. `house-sw`
  kind: string // what the manifest calls it, e.g. `house:sw`
  fp: Footprint
  prompt: string
}

export type RunOptions = {
  title: string // the report's H1
  reportFile: string // under `<scratch>/reports/`
  scratch: string
  defaultCap: number
  /** `DWELL`, `STRUCT`: this run's knobs are `<prefix>_CAP`, `_ATTEMPTS`, `_REJECTED`, `_DRY` */
  envPrefix: string
  jobs: readonly CellJob[]
}

export async function runCells(o: RunOptions): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY not set')
  const env = (name: string): string | undefined => process.env[`${o.envPrefix}_${name}`]
  const cap = Number(env('CAP') ?? o.defaultCap)
  const maxAttempts = Number(env('ATTEMPTS') ?? '3')
  const dry = env('DRY') === '1'
  // A candidate named here is one a human LOOKED AT and refused, so it is never chosen however
  // clean its numbers are. The eye is the gate the gates cannot be.
  const rejected = new Set(
    (env('REJECTED') ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  const budget = new BudgetGuard(cap)
  const ledger = new SpendLedger(`${o.scratch}/spend.json`)
  const RAWS = `${o.scratch}/raws`

  async function generate(prompt: string, ref: Buffer, assetId: string) {
    const reserve = 0.15
    if (budget.total + reserve > cap)
      throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${cap})`)
    const r = await imageGen({ key: key!, prompt, size: `${GEN_PX}x${GEN_PX}`, refs: [ref] })
    const cost = r.cost ?? reserve
    budget.spend(cost)
    ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: cost }) // throws past the $5 anomaly stop
    ledger.flush()
    return { raw: r.raw, cost }
  }

  // The ONLY reference any call here carries: a colour chart, never a building.
  const swatch = await paletteSwatchPng()
  mkdirSync(RAWS, { recursive: true })
  mkdirSync(`${o.scratch}/cells`, { recursive: true })

  const rows: string[] = []
  const members: { name: string; density: number }[] = []
  const lines: string[] = []
  // Cells this run refused to ship. Collected, not thrown on the spot: the unit of work is ONE
  // CELL, and the report of every attempt is worth more than an early exit.
  const refusedCells: string[] = []

  for (const job of o.jobs) {
    const cellPx = buildingCellPx(job.fp)
    console.log(`\n== ${job.label} (${job.fp.w}x${job.fp.h} -> ${cellPx}px) ==`)
    type Cand = {
      key: string
      cell: RawImage
      plan: SpritePlan
      fails: string[]
      dist: number
    }
    const cands: Cand[] = []

    for (let i = 0; i < maxAttempts; i++) {
      const candKey = `${job.label}-c${i}`
      const path = `${RAWS}/${candKey}.png`
      let buf: Buffer
      if (existsSync(path)) {
        buf = readFileSync(path)
        console.log(`  ${candKey}: cached`)
      } else {
        if (dry) {
          console.log(`  ${candKey}: DRY, skipped`)
          continue
        }
        const r = await generate(job.prompt, swatch, job.label)
        writeFileSync(path, r.raw)
        buf = r.raw
        console.log(
          `  ${candKey}: generated $${r.cost.toFixed(4)} (total $${budget.total.toFixed(4)})`,
        )
      }
      try {
        const r = spriteCell(keyBg(await decodePng(buf)), { cellPx, anchor: 'feet' })
        // The palette distance is REPORTED, never a refusal: the cell keeps the model's colours.
        const dist = paletteDistance(r.cell)
        const fill = r.plan.subjectPx / r.plan.window
        const fails =
          fill >= CELL_FILL_MIN
            ? []
            : [
                `subject fills ${(fill * 100).toFixed(1)}% of the cell, floor ${CELL_FILL_MIN * 100}%`,
              ]
        const refused = rejected.has(candKey)
        if (!refused) cands.push({ key: candKey, cell: r.cell, plan: r.plan, fails, dist })
        const msg =
          `${job.label}: ${candKey} subject ${r.plan.subjectPx}px, factor ${r.plan.factor}, ` +
          `window ${r.plan.window}, fill ${(fill * 100).toFixed(1)}%, ` +
          `palette distance ${dist.toFixed(1)}, ` +
          (fails.length === 0 ? 'gates clean' : fails.join('; ')) +
          (refused ? ' — REFUSED BY EYE' : '')
        lines.push(msg)
        console.log(`  ${msg}`)
        if (fails.length === 0 && !refused) break
      } catch (e) {
        const msg = `${job.label}: ${candKey} process FAILED — ${String(e).slice(0, 200)}`
        lines.push(msg)
        console.log(`  ${msg}`)
      }
    }

    // Among the CLEAN candidates only (user ruling; the shape and reason are in src/gate.ts).
    // Choosing is not deciding: the ranker picks from a pool that cannot contain a failure.
    // The winner is the one whose subject fills the most of its window.
    const clean = cands.filter((c) => c.fails.length === 0)
    const win = clean
      .sort((a, b) => a.plan.subjectPx / a.plan.window - b.plan.subjectPx / b.plan.window)
      .at(-1)
    if (!win) {
      const why =
        refusalMessage(
          job.label,
          cands.map((c) => ({ key: c.key, failures: c.fails })),
        ) || `${job.label}: NO CANDIDATE — every attempt failed to process`
      lines.push(why)
      console.log(`  ${why}`)
      refusedCells.push(job.label)
      continue
    }

    // contact sheet of every candidate, beside the raws, so the eye can compare before signing
    for (const c of cands) writeFileSync(`${o.scratch}/cells/${c.key}.png`, await encodePng(c.cell))

    const dir = `${BUILDINGS_CONTENT_DIR}/${job.kind.replace(':', '-')}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/cell.png`, await encodePng(win.cell))
    writeFileSync(
      `${dir}/manifest.json`,
      `${JSON.stringify(
        {
          version: 'v4-hires-building',
          kind: job.kind,
          footprint: job.fp,
          cell: cellAnchor(win.cell),
        },
        null,
        2,
      )}\n`,
    )

    const density = spriteDensity({
      canvas: { w: cellPx, h: cellPx },
      footprint: job.fp,
      tile: TOWN_TILE,
    })
    members.push({ name: job.label, density })
    rows.push(
      `| ${job.label} | ${job.fp.w}x${job.fp.h} | ${cellPx} | ${GEN_PX}/${win.plan.factor} ` +
        `(window ${win.plan.window}) | ${density} | ${win.dist.toFixed(1)} | ${win.key} |`,
    )
  }

  const cls = classDensityGate(members)
  const md = [
    `# ${o.title}`,
    '',
    '| cell | footprint | px | integer path | density | palette distance | chosen |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `class density: ${cls.densities.join(', ')} — ${cls.ok ? 'ONE density across the class' : cls.failures.join('; ')}`,
    '',
    '## every attempt',
    '',
    ...lines.map((l) => `- ${l}`),
    '',
    `spend: $${budget.total.toFixed(4)} of $${cap} cap`,
  ].join('\n')
  mkdirSync(`${o.scratch}/reports`, { recursive: true })
  writeFileSync(`${o.scratch}/reports/${o.reportFile}`, md)
  console.log(`\n${md}`)

  // The report is written FIRST and then the run fails: it is what tells an operator whether the
  // model or the threshold is wrong. `classDensityGate` is a class property, judged by artCoverage.
  const stopped = [
    ...(refusedCells.length === 0
      ? []
      : [`${refusedCells.length} cell(s) shipped nothing: ${refusedCells.join(', ')}`]),
    ...cls.failures,
  ]
  if (stopped.length > 0)
    throw new Error(
      `${stopped.join('\n  ')}\n  Raise ${o.envPrefix}_ATTEMPTS to draw ` +
        `more, ${o.envPrefix}_REJECTED to refuse a candidate by eye, or change a threshold on ` +
        `purpose. Nothing was committed for a refused cell.`,
    )
}
