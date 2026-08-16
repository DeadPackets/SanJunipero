import { describe, it, expect } from 'vitest'
import { DEFAULT_FORGE_CONFIG } from '../forgeConfig.js'
import { EST_COST_PER_IMAGE } from '../imageClient.js'
import { EST_COST_PER_VISION_CALL } from '../visionQa/visionJudge.js'
import { STYLE_ANCHOR_CLAUSE, STYLE_PROMPT } from '../styleBible.js'
import { LIBRARY } from './catalog.js'
import { LIBRARY_BATCHES, planBatch, estimateBatchCost, DEFAULT_CANDIDATES } from './plan.js'

describe('planBatch', () => {
  it('plans the furniture batch in catalog order at the 24 px icon size', () => {
    const items = planBatch('furniture')
    expect(items).toHaveLength(15)
    expect(items.map(i => i.entry.kind))
      .toEqual(LIBRARY.filter(e => e.category === 'furniture').map(e => e.kind))
    for (const i of items) {
      expect(i.entry.iconPx).toBe(DEFAULT_FORGE_CONFIG.library.furnitureIconSizePx)
      expect(i.candidates).toBe(3)
    }
  })

  it('plans the materials batch at nine items and two candidates each', () => {
    const items = planBatch('materials')
    expect(items).toHaveLength(9)
    for (const i of items) {
      expect(i.entry.iconPx).toBe(DEFAULT_FORGE_CONFIG.library.iconSizePx)
      expect(i.candidates).toBe(2)
    }
    expect(planBatch('materials', { candidates: 3 }).every(i => i.candidates === 3)).toBe(true)
  })

  it('refuses an unknown batch and names all five valid ones', () => {
    expect(() => planBatch('everything')).toThrow(/tools.*foods.*materials.*ritual.*furniture/)
    expect([...LIBRARY_BATCHES]).toEqual(['tools', 'foods', 'materials', 'ritual', 'furniture'])
  })

  it('the five batches partition the catalog exactly, in catalog order', () => {
    const union = LIBRARY_BATCHES.flatMap(b => planBatch(b).map(i => i.entry.kind))
    expect(union).toEqual(LIBRARY.map(e => e.kind))
  })

  it('every prompt carries the style boilerplate, the anchor clause and the entry prose', () => {
    for (const b of LIBRARY_BATCHES)
      for (const i of planBatch(b)) {
        expect(i.prompt, i.entry.kind).toContain(i.entry.desc)
        expect(i.prompt, i.entry.kind).toContain(STYLE_ANCHOR_CLAUSE)
        expect(i.prompt, i.entry.kind).toContain(STYLE_PROMPT)
        // Feedback position law: the gate rebuilds `boilerplate + feedback + commission`.
        expect(i.prompt).toBe(`${i.boilerplate} ${i.commissionText}`)
        expect(i.commissionText).toContain(i.entry.desc)
        expect(i.boilerplate).not.toContain(i.entry.desc)
      }
  })

  it('the batch estimate is candidates of image plus two of vision, per item', () => {
    const items = planBatch('tools')
    expect(estimateBatchCost(items)).toBeCloseTo(
      10 * 2 * EST_COST_PER_IMAGE + 10 * 2 * EST_COST_PER_VISION_CALL, 10)
    expect(estimateBatchCost(planBatch('furniture'))).toBeCloseTo(
      15 * 3 * EST_COST_PER_IMAGE + 15 * 2 * EST_COST_PER_VISION_CALL, 10)
    expect(DEFAULT_CANDIDATES).toEqual({ tools: 2, foods: 2, materials: 2, ritual: 2, furniture: 3 })
  })

  // Batch A measured 42 live calls: the pre-flight estimate must not lie by 2x again.
  it('the vision-call estimate is the observed rate, not the pre-flight guess', () => {
    expect(EST_COST_PER_VISION_CALL).toBe(0.0055)
  })
})
