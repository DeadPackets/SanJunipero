import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, stateHash } from '@sj/shared'
import { ForgeConfigSchema, DEFAULT_FORGE_CONFIG, loadForgeConfig } from './forgeConfig.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'

describe('forge config', () => {
  it('DEFAULT_FORGE_CONFIG is exact on all 10 leaf values', () => {
    expect(DEFAULT_FORGE_CONFIG).toEqual({
      visionQa: {
        enabled: true, model: 'google/gemini-3.7-flash', minScore: 7,
        maxRetries: 2, costCapPerAssetUsd: 0.05, rubricVersion: 'v1',
      },
      library: { iconSizePx: 24, furnitureIconSizePx: 24 },
      alignment: { feetTolerancePx: 2, baseFitToleranceQuarterTiles: 1 },
    })
  })

  it('rejects an unknown key (.strict) and an out-of-range minScore', () => {
    expect(() => ForgeConfigSchema.parse({ nope: 1 })).toThrow()
    expect(() => ForgeConfigSchema.parse({ visionQa: { minScore: 11 } })).toThrow()
    expect(() => ForgeConfigSchema.parse({ visionQa: { rubric: 'v2' } })).toThrow()
  })

  it('loadForgeConfig({}) deep-equals the default', () => {
    expect(loadForgeConfig({})).toEqual(DEFAULT_FORGE_CONFIG)
  })

  it('env overlay coerces to numbers and booleans, never strings', () => {
    const c = loadForgeConfig({ FORGE_VISION_MIN_SCORE: '8', FORGE_VISION_MAX_RETRIES: '1' })
    expect(c.visionQa.minScore).toBe(8)
    expect(typeof c.visionQa.minScore).toBe('number')
    expect(c.visionQa.maxRetries).toBe(1)
    expect(loadForgeConfig({ FORGE_VISION_ENABLED: 'false' }).visionQa.enabled).toBe(false)
    expect(loadForgeConfig({ FORGE_VISION_ENABLED: 'true' }).visionQa.enabled).toBe(true)
    expect(loadForgeConfig({ FORGE_VISION_MODEL: 'x/y' }).visionQa.model).toBe('x/y')
  })

  it('a garbage numeric env var throws rather than silently defaulting', () => {
    expect(() => loadForgeConfig({ FORGE_VISION_MIN_SCORE: 'x' })).toThrow(/FORGE_VISION_MIN_SCORE/)
    expect(() => loadForgeConfig({ FORGE_VISION_MAX_RETRIES: '' })).toThrow(/FORGE_VISION_MAX_RETRIES/)
    expect(() => loadForgeConfig({ FORGE_VISION_ENABLED: 'yes' })).toThrow(/FORGE_VISION_ENABLED/)
  })

  it('an out-of-range env override fails the schema, not the world', () => {
    expect(() => loadForgeConfig({ FORGE_VISION_MIN_SCORE: '12' })).toThrow()
  })

  // A gated asset that burns its whole retry budget must still be registrable: the codex
  // `attempts` column tops out at 3, so maxRetries can never exceed 2.
  it('the worst-case attempt count the gate can produce still registers in the codex', () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const attempts = DEFAULT_FORGE_CONFIG.visionQa.maxRetries + 1
    expect(() => codex.register({
      class: 'item', desc: 'a wooden bucket', footprint: { w: 1, h: 1 },
      png: Buffer.from('png-bytes'), widthPx: 16, heightPx: 16,
      status: 'ready', score: null, attempts, costUsd: 0.09,
    })).not.toThrow()
    expect(() => codex.register({
      class: 'item', desc: 'a wooden bucket', footprint: { w: 1, h: 1 },
      png: Buffer.from('png-bytes'), widthPx: 16, heightPx: 16,
      status: 'ready', score: null, attempts: attempts + 1, costUsd: 0.09,
    })).toThrow()
  })

  // Determinism proof: C13 config is ops-side, so world law cannot move and G1/G2 goldens hold.
  it('leaves SimConfig untouched — the world config hash does not move', () => {
    // moves whenever SimConfigSchema changes world law — re-pin is a deliberate reviewed act (see merge-train-3 report).
    // Moved by C11 Task 2, the chunk's single SimConfigSchema edit: fourteen new sections, world.size,
    // the pathing and structures.recipes additions, and health's retired contagion dials. Every other
    // C11 task is forbidden to touch the schema (Global Constraint G6), so this pin moves once for C11.
    expect(stateHash(DEFAULT_CONFIG)).toBe(
      '482f12038e542e54d9cb5a5add1e4556c4e40457bd5300dc7e66ae8e341dbf70')
    expect(stateHash(SimConfigSchema.parse({}))).toBe(stateHash(DEFAULT_CONFIG))
    expect(Object.keys(DEFAULT_CONFIG)).not.toContain('visionQa')
  })
})
