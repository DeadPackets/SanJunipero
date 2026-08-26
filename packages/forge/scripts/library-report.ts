// OFFLINE, no spend. Composes library-report.md from the DURABLE per-item report.json files —
// the per-batch batch-<name>.md files are overwritten by any ITEMS= rerun.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CRITERIA, criterionOf, type Criterion, type VisionVerdict } from '../src/visionQa/verdict.js'
import { LIBRARY } from '../src/library/catalog.js'
import { spriteGateStatus } from '../src/library/status.js'
import { LIBRARY_CATEGORIES } from '@sj/shared'
import { scratch } from './scratch.js'

const C13 = scratch('c13')
const LIB = join(C13, 'library')

type Report = {
  kind: string; status: string; attempts: number; spendUsd: number
  spriteVerdicts: VisionVerdict[]; iconVerdicts: VisionVerdict[]
}
type Row = {
  kind: string; category: string; status: string; attempts: number; spendUsd: number
  sprite: VisionVerdict | null; icon: VisionVerdict | null
}

const scores = (v: VisionVerdict | null): string =>
  v ? CRITERIA.map(c => criterionOf(v, c)?.score ?? '—').join(' ') : '—'
// A criterion "holds" when it is not N/A for the class and clears minScore without a hard fail.
// A criterion the stored rubric version never asked is neither held nor counted.
const asked = (v: VisionVerdict, c: Criterion): boolean => criterionOf(v, c) !== undefined
const holds = (v: VisionVerdict, c: Criterion): boolean => {
  const x = criterionOf(v, c)
  return x !== undefined && (x.evidence.startsWith('not applicable') || (x.pass && x.score >= 7))
}
const live = (v: VisionVerdict, c: Criterion): boolean =>
  asked(v, c) && !criterionOf(v, c)!.evidence.startsWith('not applicable')

const rows: Row[] = []
for (const e of LIBRARY) {
  const p = join(LIB, e.kind, 'report.json')
  if (!existsSync(p)) { rows.push({ kind: e.kind, category: e.category, status: 'missing', attempts: 0, spendUsd: 0, sprite: null, icon: null }); continue }
  const r = JSON.parse(readFileSync(p, 'utf8')) as Report
  rows.push({
    kind: e.kind, category: e.category, attempts: r.attempts, spendUsd: r.spendUsd,
    status: spriteGateStatus(r.spriteVerdicts, r.status),
    sprite: r.spriteVerdicts.at(-1) ?? null, icon: r.iconVerdicts.at(-1) ?? null,
  })
}

const iconPass = rows.filter(r => r.icon?.overall === 'pass').length
const spritePass = rows.filter(r => r.status === 'pass').length
const spend = rows.reduce((s, r) => s + r.spendUsd, 0)

// Per criterion, over both instruments, counting only the criteria that were actually asked.
const perCriterion = CRITERIA.map(c => {
  const vs = rows.flatMap(r => [r.sprite, r.icon].filter((v): v is VisionVerdict => v !== null))
    .filter(v => live(v, c))
  return { c, n: vs.length, held: vs.filter(v => holds(v, c)).length }
})
const allVerdicts = rows.flatMap(r => [r.sprite, r.icon].filter((v): v is VisionVerdict => v !== null))
const criteriaHeld = allVerdicts.reduce((s, v) => s + CRITERIA.filter(c => holds(v, c)).length, 0)
const criteriaTotal = allVerdicts.reduce((s, v) => s + CRITERIA.filter(c => asked(v, c)).length, 0)

const md = [
  '# C13 premade library — results (50 entries)',
  '',
  `Kept art: **${rows.filter(r => r.status !== 'missing').length}/50 registered**. Sprite gate ` +
  `**${spritePass} pass / ${rows.length - spritePass - rows.filter(r => r.status === 'missing').length} blocked**. ` +
  `Icon gate (re-read at 24 px over the kept art) **${iconPass} pass / ${rows.length - iconPass} not-pass**.`,
  '',
  '`blocked` means the rubric never reached minScore 7 within 3 attempts. The best-scoring attempt is kept',
  'and registered — placeholder law: a human-eye queue, not a hole. Under the controller icon ruling the',
  'icon is the sprite at the same 24 px, so the icon column is a SECOND independent read of the kept art.',
  'The `$` columns are each item\'s LAST run only (a rerun overwrites its report.json); the authoritative',
  'lifetime total is `$C13/spend.json` via `spend-report.ts`.',
  '',
  '## Per-category',
  '',
  '| category | n | sprite pass | icon pass | last-run $ |',
  '|---|---|---|---|---|',
  ...LIBRARY_CATEGORIES.map(c => {
    const rs = rows.filter(r => r.category === c)
    return `| ${c} | ${rs.length} | ${rs.filter(r => r.status === 'pass').length} | ` +
      `${rs.filter(r => r.icon?.overall === 'pass').length} | $${rs.reduce((s, r) => s + r.spendUsd, 0).toFixed(4)} |`
  }),
  `| **all** | **${rows.length}** | **${spritePass}** | **${iconPass}** | **$${spend.toFixed(4)}** |`,
  '',
  '## Per-criterion — the reading G13b assertion 1 is judged on',
  '',
  `Over ${allVerdicts.length} verdicts × ${CRITERIA.length} criteria, **${criteriaHeld} of ${criteriaTotal} ` +
  `criteria hold (${(100 * criteriaHeld / criteriaTotal).toFixed(1)}%)**. N/A criteria count as held; they are filled by code, not judged.`,
  '',
  '| criterion | judged | holds | rate |',
  '|---|---|---|---|',
  ...perCriterion.map(p => `| ${p.c} | ${p.n} | ${p.held} | ${p.n ? (100 * p.held / p.n).toFixed(1) : '—'}% |`),
  '',
  '## Per-item',
  '',
  `| kind | cat | sprite gate | icon gate | att | $ | sprite ${CRITERIA.join('/')} | icon ${CRITERIA.join('/')} |`,
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| \`${r.kind}\` | ${r.category} | **${r.status}** | **${r.icon?.overall ?? '—'}** | ` +
    `${r.attempts} | ${r.spendUsd.toFixed(4)} | ${scores(r.sprite)} | ${scores(r.icon)} |`),
  '',
].join('\n')

mkdirSync(join(C13, 'reports'), { recursive: true })
writeFileSync(join(C13, 'reports', 'library-report.md'), md)
console.log(`wrote library-report.md — sprite ${spritePass}/50, icon ${iconPass}/50, ` +
  `criteria ${criteriaHeld}/${criteriaTotal} (${(100 * criteriaHeld / criteriaTotal).toFixed(1)}%)`)
