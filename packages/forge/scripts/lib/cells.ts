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
import { buildingCellPx, spriteCell } from '../../src/reCell.js'
import {
  classDensityGate,
  integerScaleGate,
  paletteDistance,
  spriteDensity,
} from '../../src/pixelGates.js'
import { TOWN_TILE } from '../../src/assetResolution.js'
import { refusalMessage } from '../../src/gate.js'
import { BUILDINGS_CONTENT_DIR } from '../../src/buildingArt.js'

const MODEL = 'google/gemini-3.1-flash-image'
const GEN_PX = 2048
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'

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
  cap: number
  maxAttempts: number
  rejected: ReadonlySet<string>
  dry: boolean
  /** named in the refusal message, so an operator knows which knobs this run answers to */
  envPrefix: string
  jobs: readonly CellJob[]
}

export async function runCells(o: RunOptions): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY not set')
  const budget = new BudgetGuard(o.cap)
  const ledger = new SpendLedger(`${o.scratch}/spend.json`)
  const RAWS = `${o.scratch}/raws`

  async function generate(prompt: string, ref: Buffer, assetId: string) {
    const reserve = 0.15
    if (budget.total + reserve > o.cap)
      throw new Error(`reserve exceeds cap ($${budget.total.toFixed(3)} of $${o.cap})`)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        size: `${GEN_PX}x${GEN_PX}`,
        response_format: 'b64_json',
        input_references: [
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${ref.toString('base64')}` },
          },
        ],
        usage: { include: true },
      }),
    })
    if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
    const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
    const b64 = (json.data ?? []).filter((d) => d.b64_json).at(-1)?.b64_json
    if (!b64) throw new Error(`${MODEL}: no b64_json`)
    const cost = json.usage?.cost ?? reserve
    budget.spend(cost)
    ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: cost }) // throws past the $5 anomaly stop
    ledger.flush()
    return { raw: Buffer.from(b64, 'base64'), cost }
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
      plan: ReturnType<typeof spriteCell>['plan']
      fails: string[]
      dist: number
    }
    const cands: Cand[] = []
    // No per-candidate input: a generation that does not divide by the cell cannot land on the
    // grid at all, so decide it BEFORE the loop spends on attempts that cannot pass.
    const fails = integerScaleGate({ w: GEN_PX, h: GEN_PX }, { w: cellPx, h: cellPx }).failures

    for (let i = 0; i < o.maxAttempts; i++) {
      const candKey = `${job.label}-c${i}`
      const path = `${RAWS}/${candKey}.png`
      let buf: Buffer
      if (existsSync(path)) {
        buf = readFileSync(path)
        console.log(`  ${candKey}: cached`)
      } else {
        if (o.dry) {
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
        const refused = o.rejected.has(candKey)
        if (!refused) cands.push({ key: candKey, cell: r.cell, plan: r.plan, fails, dist })
        const msg =
          `${job.label}: ${candKey} subject ${r.plan.subjectPx}px, factor ${r.plan.factor}, ` +
          `window ${r.plan.window}, palette distance ${dist.toFixed(1)}, ` +
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
    `spend: $${budget.total.toFixed(4)} of $${o.cap} cap`,
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
