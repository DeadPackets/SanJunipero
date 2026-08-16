import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, stateHash } from '@sj/shared'
import { ForgeConfigSchema, DEFAULT_FORGE_CONFIG, loadForgeConfig } from './forgeConfig.js'

describe('forge config', () => {
  it('DEFAULT_FORGE_CONFIG is exact on all 10 leaf values', () => {
    expect(DEFAULT_FORGE_CONFIG).toEqual({
      visionQa: {
        enabled: true, model: 'google/gemini-3.7-flash', minScore: 7,
        maxRetries: 3, costCapPerAssetUsd: 0.05, rubricVersion: 'v1',
      },
      library: { iconSizePx: 16, furnitureIconSizePx: 24 },
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

  // Determinism proof: C13 config is ops-side, so world law cannot move and G1/G2 goldens hold.
  it('leaves SimConfig untouched — the world config hash does not move', () => {
    expect(stateHash(DEFAULT_CONFIG)).toBe(
      '29264e61245b74656d668851a72e516c31c932315d91d66a6eb81ffcb9f232c7')
    expect(stateHash(SimConfigSchema.parse({}))).toBe(stateHash(DEFAULT_CONFIG))
    expect(Object.keys(DEFAULT_CONFIG)).not.toContain('visionQa')
  })
})
