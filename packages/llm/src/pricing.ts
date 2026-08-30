import type Database from 'better-sqlite3'
import { insertAlert } from './callLog.js'
import { pricesFor, type PriceSource } from './pins.js'

export type ComputedCost = { costUsd: number; source: PriceSource }

// `source: 'ceiling'` means nobody priced this route, so the caller must be loud rather than
// book it cheap.
export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  model?: string,
  provider?: string | null,
): ComputedCost {
  const { prices, source } = pricesFor(model, provider)
  const costUsd =
    ((inputTokens - cacheReadTokens) * prices.input +
      cacheReadTokens * prices.cacheRead +
      outputTokens * prices.output) /
    1e6
  return { costUsd, source }
}

// How far the table may sit from the bill before it is a defect rather than rounding. Sub-cent
// calls round hard, so a divergence has to clear BOTH bars.
const COST_DIVERGENCE_FRACTION = 0.2
const COST_DIVERGENCE_FLOOR_USD = 5e-6

export type BookOpts = {
  agentId: string | null
  computed: ComputedCost
  reported: number | null
  served: string
  provider: string | null
}

/** The provider's own charge wins when offered: it is the bill. The table stays as the second
 *  opinion — a single source of truth cannot reconcile against itself — and as the fallback. */
export function bookCostUsd(db: Database.Database, opts: BookOpts): number {
  const { agentId, computed, reported, served, provider } = opts
  // A route nobody has priced must never book cheap: it books at the worst rate any endpoint
  // charges for this model, and it says so.
  if (computed.source === 'ceiling') {
    insertAlert(db, {
      agentId,
      kind: 'llm_price_unpriced_route',
      detail:
        `${served} served by ${provider ?? 'an unnamed back end'} has no price row; ` +
        `booked at the ceiling ($${computed.costUsd.toFixed(6)})`,
    })
  }
  if (reported === null) return computed.costUsd
  const gap = Math.abs(reported - computed.costUsd)
  const scale = Math.max(reported, computed.costUsd)
  if (gap > COST_DIVERGENCE_FLOOR_USD && scale > 0 && gap / scale > COST_DIVERGENCE_FRACTION) {
    insertAlert(db, {
      agentId,
      kind: 'llm_price_divergence',
      detail:
        `${provider ?? 'unattributed'} charged $${reported.toFixed(6)} for ${served} but the ` +
        `pinned table computed $${computed.costUsd.toFixed(6)} ` +
        `(${((gap / scale) * 100).toFixed(0)}% out, prices from ${computed.source}) — the pin is stale`,
    })
  }
  return reported
}
