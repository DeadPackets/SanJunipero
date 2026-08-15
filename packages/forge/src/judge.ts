import { z } from 'zod'
import { generateObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

export const JUDGE_MODEL = 'openai/gpt-5.6-luna'
export const EST_COST_PER_JUDGE = 0.0004

export const JudgeVerdict = z.object({ score: z.number().min(1).max(10), notes: z.string() }).strict()
export type JudgeFn = (candidatePng: Buffer) => Promise<z.infer<typeof JudgeVerdict>>
export type GenerateFn = (args: { model: unknown; schema: typeof JudgeVerdict; messages: unknown[] }) =>
  Promise<{ object: z.infer<typeof JudgeVerdict> }>

const INSTRUCTIONS =
  'You are the style judge for a cozy pixel-art game. The first 3 images are the LOCKED ' +
  'reference sheet. Score the final candidate image 1-10 for conformance: 2:1 dimetric ' +
  'projection with NW light, hard pixels (no anti-aliasing or gradients), warm cozy pastel ' +
  'palette (cream stone, honey wood, sage green, dusty rose), rounded Stardew-like ' +
  'silhouette and proportions, readable at small size. 7 is the minimum shippable score. ' +
  'Be strict about projection errors, palette violations, and muddy silhouettes.'

export function makeVlmJudge(opts: { apiKey: string; refSheets: Buffer[]; model?: string; generateFn?: GenerateFn }): JudgeFn {
  const gen: GenerateFn = opts.generateFn
    ?? (args => generateObject(args as Parameters<typeof generateObject>[0]) as ReturnType<GenerateFn>)
  const model = opts.generateFn ? null : createOpenRouter({ apiKey: opts.apiKey }).chat(opts.model ?? JUDGE_MODEL)
  return async candidatePng => {
    const { object } = await gen({
      model, schema: JudgeVerdict,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: INSTRUCTIONS },
          ...opts.refSheets.map(image => ({ type: 'image' as const, image, mediaType: 'image/png' as const })),
          { type: 'text', text: 'Candidate to score:' },
          { type: 'image' as const, image: candidatePng, mediaType: 'image/png' as const },
        ],
      }],
    })
    return JudgeVerdict.parse(object)
  }
}
