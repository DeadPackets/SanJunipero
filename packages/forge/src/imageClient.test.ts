import { describe, it, expect } from 'vitest'
import { makeImageClient, ImageGenError, IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACKS, EST_COST_PER_IMAGE } from './imageClient.js'
import { BudgetGuard, BudgetExceededError } from './budget.js'

const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64')

function fakeFetch(handler: (model: string, body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: { model: string; body: Record<string, unknown> }[] = []
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as Record<string, unknown>
    calls.push({ model: body.model as string, body })
    const r = handler(body.model as string, body)
    return new Response(JSON.stringify(r.json), { status: r.status })
  }) as typeof fetch
  return { fn, calls }
}

const ok = { status: 200, json: { data: [{ b64_json: PNG_B64 }], usage: { cost: 0.045 } } }

describe('makeImageClient', () => {
  it('fires n parallel requests to the primary model and returns n candidates with cost', async () => {
    const { fn, calls } = fakeFetch(() => ok)
    const out = await makeImageClient({ apiKey: 'k', fetchFn: fn }).generateCandidates('prompt', [], 3)
    expect(out).toHaveLength(3)
    expect(calls.map(c => c.model)).toEqual([IMAGE_MODEL_PRIMARY, IMAGE_MODEL_PRIMARY, IMAGE_MODEL_PRIMARY])
    expect(out[0]!.png.toString()).toBe('fake-png-bytes')
    expect(out[0]!.costUsd).toBe(0.045)
  })
  it('passes refs as input_references image_url objects wrapping data URLs', async () => {
    const { fn, calls } = fakeFetch(() => ok)
    await makeImageClient({ apiKey: 'k', fetchFn: fn }).generateCandidates('p', [Buffer.from('ref')], 1)
    const refs = calls[0]!.body.input_references as { type: string; image_url: { url: string } }[]
    expect(refs).toHaveLength(1)
    expect(refs[0]!.type).toBe('image_url')
    expect(refs[0]!.image_url.url).toMatch(/^data:image\/png;base64,/)
  })
  it('falls back down the model chain per slot', async () => {
    const { fn, calls } = fakeFetch(model =>
      model === IMAGE_MODEL_PRIMARY ? { status: 500, json: { error: 'boom' } } : ok)
    const out = await makeImageClient({ apiKey: 'k', fetchFn: fn }).generateCandidates('p', [], 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.model).toBe(IMAGE_MODEL_FALLBACKS[0])
    expect(calls.map(c => c.model)).toEqual([IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACKS[0]])
  })
  it('throws ImageGenError only when all slots fail', async () => {
    const { fn } = fakeFetch(() => ({ status: 500, json: { error: 'down' } }))
    await expect(makeImageClient({ apiKey: 'k', fetchFn: fn }).generateCandidates('p', [], 2))
      .rejects.toBeInstanceOf(ImageGenError)
  })
  it('records spend on the budget guard', async () => {
    const { fn } = fakeFetch(() => ok)
    const budget = new BudgetGuard(1)
    await makeImageClient({ apiKey: 'k', fetchFn: fn, budget }).generateCandidates('p', [], 3)
    expect(budget.total).toBeCloseTo(0.135)
  })
  it('reserves the estimated cost on the budget BEFORE firing each request', async () => {
    const budget = new BudgetGuard(1)
    const totalsAtFetchTime: number[] = []
    const fn = (async () => {
      totalsAtFetchTime.push(budget.total)
      return new Response(JSON.stringify(ok.json), { status: 200 })
    }) as typeof fetch
    await makeImageClient({ apiKey: 'k', fetchFn: fn, budget }).generateCandidates('p', [], 2)
    expect(totalsAtFetchTime).toHaveLength(2)
    for (const t of totalsAtFetchTime) expect(t).toBeGreaterThanOrEqual(EST_COST_PER_IMAGE)
    expect(totalsAtFetchTime[1]).toBeGreaterThanOrEqual(2 * EST_COST_PER_IMAGE)
  })
  it('fires zero requests when the reserve would cross the cap', async () => {
    const { fn, calls } = fakeFetch(() => ok)
    const budget = new BudgetGuard(0.04)
    await expect(makeImageClient({ apiKey: 'k', fetchFn: fn, budget }).generateCandidates('p', [], 3))
      .rejects.toBeInstanceOf(BudgetExceededError)
    expect(calls).toHaveLength(0)
  })
  it('returns already-paid candidates when the cap trips mid-batch (partial budget)', async () => {
    const { fn, calls } = fakeFetch(() => ok)
    const budget = new BudgetGuard(0.05) // room for exactly one 0.045 reserve
    const out = await makeImageClient({ apiKey: 'k', fetchFn: fn, budget }).generateCandidates('p', [], 3)
    expect(out).toHaveLength(1) // slot 1 paid and succeeded; slots 2-3 blocked pre-fire
    expect(calls).toHaveLength(1)
    expect(out[0]!.costUsd).toBe(0.045)
  })
  it('books the extra when the actual cost exceeds the reserve', async () => {
    const { fn } = fakeFetch(() => ({ status: 200, json: { data: [{ b64_json: PNG_B64 }], usage: { cost: 0.0462 } } }))
    const budget = new BudgetGuard(1)
    const out = await makeImageClient({ apiKey: 'k', fetchFn: fn, budget }).generateCandidates('p', [], 1)
    expect(out[0]!.costUsd).toBe(0.0462)
    expect(budget.total).toBeCloseTo(0.0462)
  })
})
