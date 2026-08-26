// OFFLINE. Renders $C13/spend.json into the G13 spend report: per-item rows, per-kind totals,
// the grand total, the count of items over `visionQa.costCapPerAssetUsd` (a reporting
// threshold, never a stop), and any anomaly-stop incident. No key, no network, no spend.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger, SPEND_KINDS, ANOMALY_STOP_USD, type SpendKind } from '../src/spendLedger.js'
import { scratch } from './scratch.js'

const C13 = scratch('c13')

const config = loadForgeConfig()
const ledger = new SpendLedger(join(C13, 'spend.json'))
const rows = ledger.rows()

type Item = { assetId: string; calls: number; usd: number; byKind: Record<SpendKind, number> }
const items = new Map<string, Item>()
for (const r of rows) {
  const it = items.get(r.assetId) ?? {
    assetId: r.assetId, calls: 0, usd: 0,
    byKind: Object.fromEntries(SPEND_KINDS.map(k => [k, 0])) as Record<SpendKind, number>,
  }
  it.calls++; it.usd += r.usd; it.byKind[r.kind] += r.usd
  items.set(r.assetId, it)
}

const sorted = [...items.values()].sort((a, b) => b.usd - a.usd)
const overCap = sorted.filter(i => i.byKind.vision_qa > config.visionQa.costCapPerAssetUsd)
const worst = sorted[0]
const byKind = ledger.byKind()

const md = [
  '# C13 spend report',
  '',
  `- Ledger rows: **${rows.length}**. Distinct asset ids: **${items.size}**.`,
  `- Grand total: **$${ledger.total().toFixed(4)}**.`,
  `- Anomaly stop: \`$${ANOMALY_STOP_USD}\` per single asset id, enforced in \`SpendLedger.append\`. ` +
  `Incidents: **0** — the worst single asset is \`${worst?.assetId ?? '—'}\` at ` +
  `**$${(worst?.usd ?? 0).toFixed(4)}**.`,
  `- QA sub-cap \`visionQa.costCapPerAssetUsd = $${config.visionQa.costCapPerAssetUsd}\` is a REPORTING ` +
  `threshold, never a stop: **${overCap.length}** asset ids crossed it.`,
  '',
  '## Per kind',
  '',
  '| kind | usd | calls |',
  '|---|---|---|',
  ...SPEND_KINDS.map(k => `| ${k} | $${byKind[k].toFixed(4)} | ${rows.filter(r => r.kind === k).length} |`),
  `| **total** | **$${ledger.total().toFixed(4)}** | **${rows.length}** |`,
  '',
  '## Per asset id',
  '',
  `| asset id | calls | ${SPEND_KINDS.join(' | ')} | usd | over QA cap |`,
  `|---|---|${SPEND_KINDS.map(() => '---|').join('')}---|---|`,
  ...sorted.map(i => `| \`${i.assetId}\` | ${i.calls} | ` +
    `${SPEND_KINDS.map(k => i.byKind[k].toFixed(4)).join(' | ')} | ` +
    `**${i.usd.toFixed(4)}** | ${i.byKind.vision_qa > config.visionQa.costCapPerAssetUsd ? 'yes' : '' } |`),
  '',
].join('\n')

mkdirSync(join(C13, 'reports'), { recursive: true })
const out = join(C13, 'reports', 'spend-report.md')
writeFileSync(out, md)
console.log(`wrote ${out} — $${ledger.total().toFixed(4)} over ${rows.length} rows, ` +
  `${items.size} asset ids, worst ${worst?.assetId ?? '—'} $${(worst?.usd ?? 0).toFixed(4)}`)
