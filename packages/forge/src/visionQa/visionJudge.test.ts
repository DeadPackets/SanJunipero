import { describe, it, expect } from 'vitest'
import { encodePng, type RawImage } from '../post/raw.js'
import { DEFAULT_FORGE_CONFIG, ForgeConfigSchema } from '../forgeConfig.js'
import { CRITERIA, NA_CRITERION } from './verdict.js'
import { RUBRIC_VERSION, paletteCard, checkerCard } from './rubric.js'
import { makeVisionJudge, EST_COST_PER_VISION_CALL, type VisionGenerateFn } from './visionJudge.js'

function art(w = 16, h = 16): RawImage {
  const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  img.data.set([0xe8, 0x78, 0x5a, 255], 0)
  return img
}
function scored(score: number, extra: Record<string, unknown> = {}) {
  return (keys: readonly string[]) => ({
    ...Object.fromEntries(keys.map((k) => [k, { pass: true, score, evidence: 'seen' }])),
    feedback: 'warm the roof',
    ...extra,
  })
}

type ContentPart = { type: string; text?: string; image?: Buffer }
type Call = {
  model: unknown
  schema: { shape: Record<string, unknown> }
  messages: { content: ContentPart[] }[]
}

function spy(reply: (keys: readonly string[]) => unknown, providerMetadata?: unknown) {
  const calls: Call[] = []
  const gen: VisionGenerateFn = async (a) => {
    const call = a as unknown as Call
    calls.push(call)
    const keys = Object.keys(call.schema.shape).filter((k) => k !== 'feedback')
    return { object: reply(keys), providerMetadata }
  }
  return { calls, gen }
}

const REFS = [Buffer.from('anchor-png'), Buffer.from('second-ref')]
const ARGS = {
  assetId: 'asset_1',
  klass: 'building',
  sprite: art(),
  commission: 'a squat storehouse',
}

describe('vision judge', () => {
  it('sends rubric text, then refs in order, then the palette card, then the checker card', async () => {
    const { calls, gen } = spy(scored(9))
    await makeVisionJudge({ apiKey: 'k', refs: REFS, generateFn: gen })(ARGS)
    const content = calls[0]!.messages[0]!.content
    expect(content).toHaveLength(1 + REFS.length + 2)
    expect(content[0]!.type).toBe('text')
    expect(content[0]!.text).toContain('a squat storehouse')
    for (let i = 0; i < REFS.length; i++) {
      expect(content[1 + i]!.type).toBe('image')
      expect(content[1 + i]!.image).toEqual(REFS[i])
    }
    expect(content[1 + REFS.length]!.image).toEqual(await encodePng(paletteCard()))
    expect(content[2 + REFS.length]!.image).toEqual(await encodePng(checkerCard(ARGS.sprite)))
  })

  it('defaults the model to the config and lets an explicit option win', async () => {
    const a = spy(scored(9))
    const va = await makeVisionJudge({ apiKey: 'k', refs: [], generateFn: a.gen })(ARGS)
    expect(va.verdict.model).toBe(DEFAULT_FORGE_CONFIG.visionQa.model)

    const b = spy(scored(9))
    const cfg = ForgeConfigSchema.parse({ visionQa: { model: 'from/config' } })
    const vb = await makeVisionJudge({ apiKey: 'k', refs: [], config: cfg, generateFn: b.gen })(
      ARGS,
    )
    expect(vb.verdict.model).toBe('from/config')

    const c = spy(scored(9))
    const vc = await makeVisionJudge({
      apiKey: 'k',
      refs: [],
      config: cfg,
      model: 'explicit/win',
      generateFn: c.gen,
    })(ARGS)
    expect(vc.verdict.model).toBe('explicit/win')
  })

  it('stamps the rubric version and the asset id', async () => {
    const { gen } = spy(scored(9))
    const { verdict } = await makeVisionJudge({ apiKey: 'k', refs: [], generateFn: gen })(ARGS)
    expect(verdict.rubricVersion).toBe(RUBRIC_VERSION)
    expect(verdict.assetId).toBe('asset_1')
    expect(verdict.overall).toBe('pass')
    expect(verdict.feedback).toBe('warm the roof')
  })

  it('throws when the reply is missing a criterion', async () => {
    const { gen } = spy((keys) => scored(9)(keys.filter((k) => k !== 'palette')))
    await expect(
      makeVisionJudge({ apiKey: 'k', refs: [], generateFn: gen })(ARGS),
    ).rejects.toThrow()
  })

  it('ignores an overall supplied by the reply and uses the derived value', async () => {
    const { gen } = spy((keys) => ({ ...scored(4)(keys), overall: 'pass' }))
    const { verdict } = await makeVisionJudge({ apiKey: 'k', refs: [], generateFn: gen })(ARGS)
    expect(verdict.overall).toBe('retry')
  })

  it('derives blocked once the attempt passes the retry budget', async () => {
    const { gen } = spy(scored(4))
    const { verdict } = await makeVisionJudge({ apiKey: 'k', refs: [], generateFn: gen })({
      ...ARGS,
      attempt: 4,
    })
    expect(verdict.overall).toBe('blocked')
  })

  it('never asks an icon for facing, alignment or proportion, and fills them by code', async () => {
    const { calls, gen } = spy(scored(9))
    const { verdict } = await makeVisionJudge({ apiKey: 'k', refs: [], generateFn: gen })({
      ...ARGS,
      klass: 'icon',
    })
    const asked = Object.keys(calls[0]!.schema.shape)
    for (const k of ['facing', 'alignment', 'proportion']) expect(asked).not.toContain(k)
    for (const k of ['palette', 'singleFigure', 'transparency', 'density'])
      expect(asked).toContain(k)
    expect(asked).toContain('feedback')
    for (const k of ['facing', 'alignment', 'proportion'] as const)
      expect(verdict.criteria[k]).toEqual(NA_CRITERION('icon'))
    expect(Object.keys(verdict.criteria).sort()).toEqual([...CRITERIA].sort())
  })

  it('costs the estimate without reported usage and the reported figure with it', async () => {
    const a = spy(scored(9))
    expect(
      (await makeVisionJudge({ apiKey: 'k', refs: [], generateFn: a.gen })(ARGS)).costUsd,
    ).toBe(EST_COST_PER_VISION_CALL)
    const b = spy(scored(9), { openrouter: { usage: { cost: 0.0091 } } })
    expect(
      (await makeVisionJudge({ apiKey: 'k', refs: [], generateFn: b.gen })(ARGS)).costUsd,
    ).toBe(0.0091)
  })
})
