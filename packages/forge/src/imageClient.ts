import type { BudgetGuard } from './budget.js'
import { BudgetExceededError } from './budget.js'

export const IMAGE_MODEL_PRIMARY = 'google/gemini-3.1-flash-image'
export const IMAGE_MODEL_FALLBACKS = [
  'bytedance-seed/seedream-4.5',
  'black-forest-labs/flux.2-klein-4b',
] as const
export const GEN_SIZE = 512
export const EST_COST_PER_IMAGE = 0.045
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
/** Art is drawn one commission at a time: a hung provider must not hold up every later one. */
const REQUEST_TIMEOUT_MS = 90_000

export type Candidate = { png: Buffer; model: string; costUsd: number }
export type ImageClient = {
  generateCandidates(prompt: string, refs: Buffer[], n?: number): Promise<Candidate[]>
}

export class ImageGenError extends Error {
  constructor(
    public model: string,
    public status: number,
    detail: string,
  ) {
    super(`image generation failed (${model}, HTTP ${status}): ${detail}`)
  }
}

export function makeImageClient(opts: {
  apiKey: string
  fetchFn?: typeof fetch
  budget?: BudgetGuard
}): ImageClient {
  const doFetch = opts.fetchFn ?? fetch

  async function generateOne(model: string, prompt: string, refs: Buffer[]): Promise<Candidate> {
    // Reserve BEFORE firing so a crossed cap blocks the request; throws BudgetExceededError.
    opts.budget?.spend(EST_COST_PER_IMAGE)
    const res = await doFetch(ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        size: `${GEN_SIZE}x${GEN_SIZE}`,
        response_format: 'b64_json',
        ...(refs.length
          ? {
              input_references: refs.map((r) => ({
                type: 'image_url' as const,
                image_url: { url: `data:image/png;base64,${r.toString('base64')}` },
              })),
            }
          : {}),
        usage: { include: true },
      }),
    })
    if (!res.ok) throw new ImageGenError(model, res.status, await res.text())
    const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new ImageGenError(model, res.status, 'no data[0].b64_json in response')
    const costUsd = json.usage?.cost ?? EST_COST_PER_IMAGE
    // Reconcile upward only: BudgetGuard has no refund, so the reserve stays booked when actual < reserve.
    if (costUsd > EST_COST_PER_IMAGE) opts.budget?.spend(costUsd - EST_COST_PER_IMAGE)
    return { png: Buffer.from(b64, 'base64'), model, costUsd }
  }

  async function slot(prompt: string, refs: Buffer[]): Promise<Candidate | ImageGenError> {
    let lastErr = new ImageGenError('none', 0, 'no models attempted')
    for (const model of [IMAGE_MODEL_PRIMARY, ...IMAGE_MODEL_FALLBACKS]) {
      try {
        return await generateOne(model, prompt, refs)
      } catch (e) {
        if (e instanceof BudgetExceededError) throw e
        lastErr = e instanceof ImageGenError ? e : new ImageGenError(model, 0, String(e))
      }
    }
    return lastErr
  }

  return {
    async generateCandidates(prompt, refs, n = 3) {
      // allSettled: one slot's BudgetExceededError must not discard other slots' paid candidates
      const settled = await Promise.allSettled(Array.from({ length: n }, () => slot(prompt, refs)))
      const good: Candidate[] = []
      let budgetErr: BudgetExceededError | undefined
      let genErr: ImageGenError | undefined
      for (const s of settled) {
        if (s.status === 'rejected') {
          if (s.reason instanceof BudgetExceededError) {
            budgetErr ??= s.reason
            continue
          }
          throw s.reason
        }
        if (s.value instanceof ImageGenError) genErr ??= s.value
        else good.push(s.value)
      }
      if (good.length === 0) throw budgetErr ?? genErr!
      return good
    },
  }
}
