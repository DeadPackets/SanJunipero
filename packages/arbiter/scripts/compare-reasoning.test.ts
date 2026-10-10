import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { NO_PARAMS } from '@sj/shared'
import { LlmClient, sumCostUsd, type LlmClientOpts } from '@sj/llm'
import { mockModel } from '@sj/llm/testutil'
import { strictDialect } from '../src/testutil/scriptedLlm.js'
import { prepareCases, semanticOutcome, runComparison } from './compare-reasoning.js'

const fixtures = [
  {
    tick: 783,
    intent_text: 'Set the ten wood beside the hearth as one counted stack.',
    verdict_json: JSON.stringify({
      kind: 'impossible',
      class: 'insufficient_materials',
      reason: 'fixture only',
    }),
  },
  {
    tick: 606,
    intent_text: 'I set one plank across the damaged part of the orchard bridge.',
    verdict_json: JSON.stringify({
      kind: 'impossible',
      class: 'insufficient_materials',
      reason: 'fixture only',
    }),
  },
  {
    tick: 469,
    intent_text: 'I make a counted stack of the ten pieces of wood beside the cold hearth.',
    verdict_json: JSON.stringify({
      kind: 'impossible',
      class: 'insufficient_materials',
      reason: 'fixture only',
    }),
  },
]

describe('recorded arbiter reasoning comparison', () => {
  it('uses real prompt material and explicit reconstructed IDs without treating damage claims as facts', () => {
    const cases = prepareCases(fixtures)
    expect(cases).toHaveLength(3)
    expect(cases[0]?.prompt.system).toContain(
      'Arranging or counting existing stock does not discover a new craft',
    )
    expect(cases[0]?.prompt.messages[0]?.content).toContain('fixture_wood')
    expect(cases[1]?.context.visible?.structures).toEqual([
      { id: 'fixture_bridge', kind: 'bridge', x: 2, y: 1 },
    ])
    expect(cases[1]?.assumptions.join(' ')).toContain('damage is unverified')
  })

  it('distinguishes a routine transfer from replacement stock and cosmetic repair', () => {
    const cases = prepareCases(fixtures)
    const wood = cases[0]!
    expect(
      semanticOutcome(wood, {
        kind: 'map',
        verb: 'drop',
        params: { ...NO_PARAMS, itemId: 'fixture_wood' },
      }),
    ).toMatchObject({ outcome: 'existing-stock-transfer', routineStockTransfer: true })
    expect(
      semanticOutcome(wood, {
        kind: 'map',
        verb: 'drop',
        params: { ...NO_PARAMS, itemId: 'invented_id' },
      }),
    ).toMatchObject({ outcome: 'unresolved-routine', routineStockTransfer: false })
    const attempt = {
      kind: 'attempt' as const,
      summary: 'Put the plank on the bridge.',
      recipe: {
        id: 'recipe:repair_bridge',
        name: 'Repair Bridge',
        takes: 'minutes' as const,
        costs: [{ kind: 'plank', qty: 1 }],
        requires: [],
        canon: ['carpentry'],
        rngStream: 'repair_bridge',
        outcomeTable: [
          {
            weight: 1,
            success: true,
            label: 'The bridge is marked.',
            effects: [
              { op: 'mark' as const, on: 'structure' as const, key: 'repaired', value: 'true' },
            ],
          },
        ],
      },
    }
    expect(semanticOutcome(cases[1]!, attempt)).toMatchObject({
      outcome: 'cosmetic-repair-only',
      changesBridgePhysics: false,
    })
    expect(
      semanticOutcome(wood, {
        ...attempt,
        recipe: {
          ...attempt.recipe,
          costs: [{ kind: 'wood', qty: 10 }],
          outcomeTable: [
            {
              weight: 1,
              success: true,
              label: 'A stack.',
              effects: [{ op: 'spawn_item', kind: 'wood', qty: 10 }],
            },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'replacement-stock-invention', spawnsHeldMaterial: true })
  })

  it('runs exactly six bounded passes through one operations ledger and preserves pins', async () => {
    const db = new Database(':memory:')
    const options: LlmClientOpts[] = []
    const cases = prepareCases(fixtures)
    const answer = {
      verdict: strictDialect({
        kind: 'map',
        verb: 'drop',
        params: { ...NO_PARAMS, itemId: 'fixture_wood' },
      }),
    }
    try {
      const result = await runComparison(cases, db, (opts) => {
        options.push(opts)
        return new LlmClient({
          ...opts,
          model: mockModel([{ json: answer, reportedCostUsd: 0.001 }]),
        })
      })
      expect(result).toHaveLength(6)
      expect(result.every((r) => r.schemaValid)).toBe(true)
      expect(options.map((o) => o.reasoning)).toEqual([
        { effort: 'xhigh' },
        { effort: 'low' },
        { effort: 'low' },
        { effort: 'xhigh' },
        { effort: 'xhigh' },
        { effort: 'low' },
      ])
      for (const option of options) {
        expect(option).toMatchObject({
          caller: 'arbiter.compare',
          maxRetries: 0,
          maxOutputTokens: 20_000,
          allowProviderFallbacks: false,
          providerOrder: ['openai'],
        })
        expect(option.expectedCallCostUsd).toBeUndefined()
      }
      expect(db.prepare('SELECT lifetime_usd, rolling_day_usd FROM spend_limits').get()).toEqual({
        lifetime_usd: 2,
        rolling_day_usd: 2,
      })
      expect(sumCostUsd(db)).toBeCloseTo(0.006)
    } finally {
      db.close()
    }
  })
})
