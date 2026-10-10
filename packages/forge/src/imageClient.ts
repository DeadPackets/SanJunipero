import type { BudgetGuard, ReserveCharge } from './budget.js'
import { BudgetExceededError } from './budget.js'

export const IMAGE_MODEL_PRIMARY = 'google/gemini-3.1-flash-image'
export const IMAGE_MODEL_FALLBACKS = [
  'bytedance-seed/seedream-4.5',
  'black-forest-labs/flux.2-klein-4b',
] as const
export const GEN_SIZE = 512
export const EST_COST_PER_IMAGE = 0.045
const ENDPOINT = 'https://openrouter.ai/api/v1/images'
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
  reserveCharge?: ReserveCharge
  signal?: AbortSignal
  /** A reply that was billed but carried no image: the row no candidate will ever book. */
  onCharge?: (model: string, costUsd: number) => void
}): ImageClient {
  const doFetch = opts.fetchFn ?? fetch

  async function generateOne(model: string, prompt: string, refs: Buffer[]): Promise<Candidate> {
    opts.signal?.throwIfAborted()
    // Reserve BEFORE firing so a crossed cap blocks the request; throws BudgetExceededError.
    opts.budget?.spend(EST_COST_PER_IMAGE)
    let billed = false
    let sent = false
    let uncertain = false
    let costUsd = EST_COST_PER_IMAGE
    let reservation: ReturnType<ReserveCharge> | undefined
    try {
      reservation = opts.reserveCharge?.(model, EST_COST_PER_IMAGE)
      sent = true
      const res = await doFetch(ENDPOINT, {
        method: 'POST',
        signal: AbortSignal.any([
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ...(opts.signal ? [opts.signal] : []),
        ]),
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          size: `${GEN_SIZE}x${GEN_SIZE}`,
          output_format: 'png',
          ...(refs.length
            ? {
                input_references: refs.map((r) => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:image/png;base64,${r.toString('base64')}` },
                })),
              }
            : {}),
        }),
      })
      if (!res.ok) throw new ImageGenError(model, res.status, await res.text())
      billed = true
      const json = (await res.json()) as {
        data?: { b64_json?: string }[]
        usage?: { cost?: number }
      }
      const b64 = json.data?.[0]?.b64_json
      const reported = json.usage?.cost
      costUsd =
        typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
          ? reported
          : EST_COST_PER_IMAGE
      reservation?.settle(costUsd)
      opts.signal?.throwIfAborted()
      if (!b64) {
        opts.onCharge?.(model, costUsd)
        throw new ImageGenError(model, res.status, 'no data[0].b64_json in response')
      }
      if (costUsd > EST_COST_PER_IMAGE) opts.budget?.spend(costUsd - EST_COST_PER_IMAGE)
      else opts.budget?.release(EST_COST_PER_IMAGE - costUsd)
      return { png: Buffer.from(b64, 'base64'), model, costUsd }
    } catch (err) {
      const unbilled =
        err instanceof ImageGenError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408 &&
        err.status !== 499
      if (sent && !billed && !unbilled) {
        uncertain = true
        reservation?.retainUncertain()
      }
      throw err
    } finally {
      if (billed) reservation?.settle(costUsd)
      else if (!uncertain) opts.budget?.release(EST_COST_PER_IMAGE)
      reservation?.release()
    }
  }

  async function slot(prompt: string, refs: Buffer[]): Promise<Candidate | ImageGenError> {
    let lastErr = new ImageGenError('none', 0, 'no models attempted')
    for (const model of [IMAGE_MODEL_PRIMARY, ...IMAGE_MODEL_FALLBACKS]) {
      try {
        return await generateOne(model, prompt, refs)
      } catch (e) {
        opts.signal?.throwIfAborted()
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
      if (good.length === 0) throw budgetErr ?? genErr ?? new ImageGenError('none', 0, 'no slots')
      return good
    },
  }
}
