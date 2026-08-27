import { generateText, Output, type LanguageModelUsage } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { PRICE_PER_M, servedProvider } from '@sj/llm'
const MODEL = 'deepseek/deepseek-v4-flash-0731'
const CAP_USD = 5.0
let spentUsd = 0
// Imported, not re-typed: this script booked its own spend at 0.14/0.28/0.028 while the route
// charged double, so its own $5 cap was a $10 cap.
function book(usage: LanguageModelUsage, label: string): number {
  const cin = usage.inputTokenDetails.cacheReadTokens ?? 0
  const inTok = usage.inputTokens ?? 0
  const outTok = usage.outputTokens ?? 0
  const cost =
    ((inTok - cin) * PRICE_PER_M.input +
      cin * PRICE_PER_M.cacheRead +
      outTok * PRICE_PER_M.output) /
    1e6
  spentUsd += cost
  console.log(
    `[${label}] in=${inTok} out=${outTok} cacheRead=${cin} cost=$${cost.toFixed(6)} total=$${spentUsd.toFixed(4)}`,
  )
  if (spentUsd > CAP_USD) {
    console.error('BUDGET CAP EXCEEDED')
    process.exit(1)
  }
  return cin
}
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! })

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function providerOf(result: { finalStep: { providerMetadata?: unknown } }): string {
  return servedProvider(undefined, result.finalStep.providerMetadata) ?? 'unknown'
}

// ---- Check 1: basic call ----
{
  const r = await generateText({
    model: openrouter(MODEL),
    prompt: 'Reply with the single word: meadow',
  })
  if (!r.text.toLowerCase().includes('meadow'))
    fail(`check1 text does not contain 'meadow': ${r.text}`)
  book(r.usage, 'basic')
  console.log('CHECK 1 PASS: basic call, text =', JSON.stringify(r.text))
}

// ---- Check 2: structured output ----
{
  const r = await generateText({
    model: openrouter(MODEL),
    output: Output.object({
      schema: z.object({ mood: z.string(), count: z.number().int() }).strict(),
    }),
    prompt: 'A farmer counted 3 sheep and felt calm. Fill the fields.',
  })
  const obj = r.output
  if (obj.count !== 3) fail(`check2 count !== 3: ${JSON.stringify(obj)}`)
  if (typeof obj.mood !== 'string' || obj.mood.length === 0)
    fail(`check2 mood empty: ${JSON.stringify(obj)}`)
  book(r.usage, 'structured')
  const aiTest = await import('ai/test')
  const mockName = Object.keys(aiTest).find((k) => k === 'MockLanguageModelV4') ?? 'NOT FOUND'
  console.log('CHECK 2 PASS: structured output =', JSON.stringify(obj))
  console.log(`[task2-note] ai@7 mock class for LanguageModel spec v4: ${mockName} (ai/test)`)
}

// ---- Check 3: prompt-cache observation ----
const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. '
let SYSTEM_PREFIX = ''
while (SYSTEM_PREFIX.length < 6000) SYSTEM_PREFIX += LOREM
SYSTEM_PREFIX = SYSTEM_PREFIX.slice(0, 6000)

let observedProvider = 'unknown'
{
  const call = (userMsg: string) =>
    generateText({
      model: openrouter(MODEL),
      system: SYSTEM_PREFIX,
      prompt: userMsg,
      maxOutputTokens: 32,
    })
  const r1 = await call('Say OK.')
  book(r1.usage, 'cache-warm')
  const p1 = providerOf(r1)
  let r2 = await call('Say YES.')
  let cin = book(r2.usage, 'cache-read')
  if (cin === 0) {
    console.log('[cache] cacheReadTokens=0, retrying once after 5s...')
    await sleep(5000)
    r2 = await call('Say MAYBE.')
    cin = book(r2.usage, 'cache-read-retry')
  }
  if (cin <= 0) fail('check3 cacheReadTokens still 0 after retry')
  observedProvider = providerOf(r2)
  console.log(
    `CHECK 3 PASS: cacheReadTokens=${cin}; provider(call1)=${p1} provider(call2)=${observedProvider}`,
  )
}

// ---- Check 4: fallback + pinning mechanics ----
{
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) fail(`check4 models list HTTP ${res.status}`)
  const body = (await res.json()) as { data: { id: string }[] }
  const secondId = body.data
    .map((m) => m.id)
    .filter((id) => id.startsWith('deepseek/') && id !== MODEL && !id.endsWith(':free'))
    .sort()[0]
  if (!secondId) fail('check4 no second deepseek model id found')
  console.log(`[check4] verified second deepseek model id: ${secondId}`)
  const r = await generateText({
    model: openrouter(MODEL, {
      extraBody: {
        models: [MODEL, secondId],
        provider: { order: [observedProvider], allow_fallbacks: true },
      },
    }),
    prompt: 'Reply with the single word: anchor',
    maxOutputTokens: 32,
  })
  book(r.usage, 'fallback-shape')
  const served = r.finalStep.response.modelId
  console.log(`CHECK 4 PASS: request accepted; served model=${served} provider=${providerOf(r)}`)
  console.log(`[pins] PROVIDER_ORDER=[${observedProvider}] FALLBACK_MODELS=[${secondId}]`)
}

console.log(`ALL 4 CHECKS PASS. total spend=$${spentUsd.toFixed(4)} (cap $${CAP_USD.toFixed(2)})`)
