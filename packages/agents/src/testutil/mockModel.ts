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
}

export function mockModel(responses: ScriptedResponse[]): MockLanguageModelV4 {
  let next = 0
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const scripted = responses[next]
      next += 1
      if (scripted === undefined) throw new Error('mockModel: no scripted response left')
      if (scripted.fail) throw new Error('scripted failure')
      const u = scripted.usage ?? {}
      const inputTokens = u.inputTokens ?? 0
      const outputTokens = u.outputTokens ?? 0
      const cacheRead = u.cacheReadTokens ?? 0
      const reasoning = u.reasoningTokens ?? 0
      return {
        content: [{ type: 'text' as const, text: scripted.text ?? JSON.stringify(scripted.json) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: {
          inputTokens: { total: inputTokens, noCache: inputTokens - cacheRead, cacheRead, cacheWrite: undefined },
          outputTokens: { total: outputTokens, text: outputTokens - reasoning, reasoning },
        },
        warnings: [],
      }
    },
  })
}
