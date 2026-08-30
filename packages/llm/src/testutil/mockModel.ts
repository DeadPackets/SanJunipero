import { MockLanguageModelV4 } from 'ai/test'

export type ScriptedResponse = {
  text?: string
  json?: unknown
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    reasoningTokens?: number
  }
  fail?: boolean
  /** The generation answered and billed, but carried no text — what a caller that spent its
   *  whole output ceiling on reasoning looks like. */
  emptyOutput?: boolean
  generationId?: string
  servedModelId?: string
  provider?: string
  reportedCostUsd?: number
  // Why the provider stopped; `length` is the answer cut off at the output ceiling.
  finishReason?: 'stop' | 'length'
}

export function mockModel(responses: ScriptedResponse[]): MockLanguageModelV4 {
  let next = 0
  return new MockLanguageModelV4({
    doGenerate: () => {
      const scripted = responses[next]
      next += 1
      if (scripted === undefined) throw new Error('mockModel: no scripted response left')
      if (scripted.fail) throw new Error('scripted failure')
      const u = scripted.usage ?? {}
      const inputTokens = u.inputTokens ?? 0
      const outputTokens = u.outputTokens ?? 0
      const cacheRead = u.cacheReadTokens ?? 0
      const reasoning = u.reasoningTokens ?? 0
      return Promise.resolve({
        content: scripted.emptyOutput
          ? []
          : [{ type: 'text' as const, text: scripted.text ?? JSON.stringify(scripted.json) }],
        finishReason: { unified: scripted.finishReason ?? ('stop' as const), raw: undefined },
        usage: {
          inputTokens: {
            total: inputTokens,
            noCache: inputTokens - cacheRead,
            cacheRead,
            cacheWrite: undefined,
          },
          outputTokens: { total: outputTokens, text: outputTokens - reasoning, reasoning },
        },
        warnings: [],
        ...(scripted.servedModelId === undefined && scripted.generationId === undefined
          ? {}
          : {
              response: {
                ...(scripted.servedModelId === undefined
                  ? {}
                  : { modelId: scripted.servedModelId }),
                ...(scripted.generationId === undefined ? {} : { id: scripted.generationId }),
              },
            }),
        ...(scripted.provider === undefined && scripted.reportedCostUsd === undefined
          ? {}
          : {
              providerMetadata: {
                openrouter: {
                  ...(scripted.provider === undefined ? {} : { provider: scripted.provider }),
                  ...(scripted.reportedCostUsd === undefined
                    ? {}
                    : { usage: { cost: scripted.reportedCostUsd } }),
                },
              },
            }),
      })
    },
  })
}
