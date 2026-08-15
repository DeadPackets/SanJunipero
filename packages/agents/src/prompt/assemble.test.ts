import { describe, expect, it, vi } from 'vitest'
import { assemblePrompt, compactDayLog, type PromptBlocks } from './assemble.js'
import { FELT_EVENT_PROSE, perceptionToProse } from './prose.js'
import { FORBIDDEN_FRAMING, RULES_OF_BEING } from './rulesOfBeing.js'
import {
  conversationPacket,
  fixtureBlocks,
  quietMeadowPacket,
} from '../testutil/fixtures.js'

function fullSerialization(blocks: PromptBlocks): string {
  const a = assemblePrompt(blocks)
  return a.system + a.messages.map((m) => m.content).join('')
}

describe('assemblePrompt stability gradient', () => {
  it('keeps everything before block 6 identical when only now changes', () => {
    const base = fixtureBlocks()
    const a = assemblePrompt({ ...base, now: { prose: 'The sun stands high.' } })
    const b = assemblePrompt({ ...base, now: { prose: 'Dusk settles over the valley.' } })

    const prefixA = a.system + a.messages.slice(0, 2).map((m) => m.content).join('')
    const prefixB = b.system + b.messages.slice(0, 2).map((m) => m.content).join('')
    expect(prefixA).toBe(prefixB)
    expect(a.messages[2].content).not.toBe(b.messages[2].content)

    const sa = fullSerialization({ ...base, now: { prose: 'The sun stands high.' } })
    const sb = fullSerialization({ ...base, now: { prose: 'Dusk settles over the valley.' } })
    expect(sa.startsWith(prefixA)).toBe(true)
    expect(sb.startsWith(prefixA)).toBe(true)
    expect(sa).not.toBe(sb)
  })

  it('keeps everything before block 5 byte-identical when a dayLog entry is appended', () => {
    const base = fixtureBlocks()
    const before = assemblePrompt(base)
    const after = assemblePrompt({ ...base, dayLog: [...base.dayLog, 'I traded a plank for flour.'] })

    expect(after.system).toBe(before.system)
    expect(after.messages[0]).toEqual(before.messages[0])
    expect(after.messages[1].content).not.toBe(before.messages[1].content)
  })

  it('leaves system byte-identical when the scene block changes', () => {
    const base = fixtureBlocks()
    const before = assemblePrompt(base)
    const changed = assemblePrompt({
      ...base,
      scene: { ...base.scene, memories: [...base.scene.memories, base.scene.memories[0]] },
    })

    expect(changed.system).toBe(before.system)
    expect(changed.messages[0]).not.toEqual(before.messages[0])
  })

  it('changes system when the personality doc changes (sleep-only by contract)', () => {
    const base = fixtureBlocks()
    const before = assemblePrompt(base)
    const changed = assemblePrompt({
      ...base,
      personality: {
        ...base.personality,
        doc: {
          ...base.personality.doc,
          current: { ...base.personality.doc.current, mood: 'heavy' },
        },
      },
    })

    expect(changed.system).not.toBe(before.system)
  })
})

describe('human framing guard', () => {
  it('rendered conversation packet and RULES_OF_BEING avoid forbidden framing', () => {
    const prose = perceptionToProse(conversationPacket)
    const rendered = fullSerialization(fixtureBlocks({ now: { prose } }))

    expect(prose).not.toMatch(FORBIDDEN_FRAMING)
    expect(rendered).not.toMatch(FORBIDDEN_FRAMING)
    expect(RULES_OF_BEING).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('FORBIDDEN_FRAMING really catches AI, prompt, token, model, tool', () => {
    for (const bad of ['AI', 'prompt', 'token', 'model', 'tool']) {
      expect(`the ${bad} was here`).toMatch(FORBIDDEN_FRAMING)
    }
  })
})

describe('perceptionToProse', () => {
  it('quotes heard speech with the speaker name', () => {
    const prose = perceptionToProse(conversationPacket)
    expect(prose).toContain('You hear Nadia say:')
    expect(prose).toContain('"Good to see you."')
  })

  it('renders a known felt event to its exact prose', () => {
    const prose = perceptionToProse(conversationPacket)
    expect(prose).toContain(FELT_EVENT_PROSE['rain_started'])
  })

  it('renders an unknown felt tag to the generic sentence and alerts', () => {
    const alert = vi.fn()
    const prose = perceptionToProse({ ...quietMeadowPacket, feltEvents: ['quantum_flux'] }, alert)
    expect(prose).toContain('You sense something change nearby.')
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledWith('unknown felt tag: quantum_flux')
  })

  it('renders low hunger as a felt sentence', () => {
    const packet = {
      ...quietMeadowPacket,
      self: {
        ...quietMeadowPacket.self,
        body: {
          ...quietMeadowPacket.self.body,
          needs: { ...quietMeadowPacket.self.body.needs, hunger: 20 },
        },
      },
    }
    expect(perceptionToProse(packet)).toContain('Your stomach gnaws at you.')
  })
})

describe('compaction', () => {
  it('flags 1000 dayLog entries and compacts to 11 entries', () => {
    const dayLog = Array.from({ length: 1000 }, (_, i) => `a small hour of the long day, entry ${i}`)
    const a = assemblePrompt(fixtureBlocks({ dayLog }))
    expect(a.needsCompaction).toBe(true)

    const compacted = compactDayLog(dayLog, 'the day blurred into chores and quiet hours.')
    expect(compacted.length).toBe(11)
    expect(compacted[0]).toContain('Your mind wanders')
    expect(compacted[0]).toContain('the day blurred into chores and quiet hours.')
    expect(compacted.slice(1)).toEqual(dayLog.slice(-10))
  })
})

describe('ambient budget', () => {
  it('renders 8 fixture memories into block 4 at or under 700 est tokens', () => {
    const blocks = fixtureBlocks()
    const a = assemblePrompt(blocks)
    const sceneTokens = Math.ceil(a.messages[0].content.length / 4)
    expect(blocks.scene.memories.length).toBe(8)
    expect(sceneTokens).toBeLessThanOrEqual(700)
  })
})
