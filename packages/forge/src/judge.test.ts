import { describe, it, expect } from 'vitest'
import { makeVlmJudge, JUDGE_MODEL } from './judge.js'

describe('makeVlmJudge', () => {
  it('sends refs then candidate, and returns the verdict object', async () => {
    const seen: { messages: unknown[] }[] = []
    const judge = makeVlmJudge({
      apiKey: 'k',
      refSheets: [Buffer.from('r1'), Buffer.from('r2'), Buffer.from('r3')],
      generateFn: async args => { seen.push(args as never); return { object: { score: 8.5, notes: 'cozy' } } },
    })
    const v = await judge(Buffer.from('candidate'))
    expect(v).toEqual({ score: 8.5, notes: 'cozy' })
    const content = (seen[0]!.messages[0] as { content: { type: string }[] }).content
    // 1 instruction text + 3 ref images + 1 "candidate" text + 1 candidate image
    expect(content.filter(c => c.type === 'image')).toHaveLength(4)
    expect(content[content.length - 1]!.type).toBe('image')
  })
  it('defaults to the pinned judge model id', () => {
    expect(JUDGE_MODEL).toBe('openai/gpt-5.6-luna')
  })
})
