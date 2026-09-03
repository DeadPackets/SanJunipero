import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { recordingModel } from '@sj/llm/testutil'
import { SEMANTIC_CONCEPTS, SEMANTIC_INSTRUCTION } from '@sj/narrator'

// The seam nothing composed: the detector's prompt was right and the client's seal was right,
// and between them six of nine concept ids went out as `[redacted]` for thirteen days.
describe('★ a recogniser asks its question in its own words', () => {
  const ask = async (audience?: 'mind' | 'ops'): Promise<string> => {
    const db = new Database(':memory:')
    migrateLlmTables(db)
    const { model, sent } = recordingModel([{ text: 'ok' }])
    await new LlmClient({
      db,
      caller: 'semantic',
      model,
      ...(audience === undefined ? {} : { audience }),
    }).text({
      system: SEMANTIC_INSTRUCTION,
      messages: [{ role: 'user', content: 'one day of the town talking' }],
    })
    return sent[0] ?? ''
  }

  it('reaches the provider carrying every concept id it may be answered with', async () => {
    const out = await ask('ops')
    for (const concept of SEMANTIC_CONCEPTS) expect(out, concept).toContain(concept)
    expect(out).not.toContain('[redacted]')
  })

  it('is cut down to three of nine when it goes out as a mind would read it', async () => {
    const out = await ask()
    const survived = SEMANTIC_CONCEPTS.filter((c) => out.includes(c))
    expect(survived).toEqual(['joke', 'metaphor', 'lie'])
  })
})
