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

  it('FORBIDDEN_FRAMING catches AI, A.I., and plural forms', () => {
    const hits = [
      'AI', 'A.I.', 'artificial intelligence', 'language model', 'language models', 'LLM', 'LLMs',
      'neural', 'prompt', 'prompts', 'context window', 'context windows', 'token', 'tokens',
      'chatbot', 'chatbots', 'simulation', 'simulations', 'model', 'models', 'tool', 'tools',
    ]
    for (const bad of hits) {
      expect(`the ${bad} was here`).toMatch(FORBIDDEN_FRAMING)
    }
    expect('A.I. wrote the note.').toMatch(FORBIDDEN_FRAMING)
  })

  it('FORBIDDEN_FRAMING does not match substrings like toolkit or modelling', () => {
    expect('the toolkit sat on the bench').not.toMatch(FORBIDDEN_FRAMING)
    expect('she spent the afternoon modelling clay').not.toMatch(FORBIDDEN_FRAMING)
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

  it('renders the time of day and day number', () => {
    const prose = perceptionToProse(quietMeadowPacket)
    expect(prose).toContain('morning')
    expect(prose).toContain('day 1')
    expect(prose).toContain('spring')
  })

  it('renders visible structures, items, and crops', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        agents: [],
        structures: [{ id: 's1', kind: 'storehouse', x: 14, y: 9, w: 1, h: 1, burning: false, stage: 'complete' as const }],
        items: [{ id: 'i1', kind: 'bread', qty: 20, loc: { t: 'tile' as const, x: 13, y: 9 } }],
        crops: [{ id: 'c1', kind: 'wheat', x: 12, y: 8, stage: 2, withered: false }],
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('storehouse')
    expect(prose).toContain('20 bread')
    expect(prose).toContain('wheat')
  })

  it('renders a burning structure and a withered crop', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        agents: [],
        structures: [{ id: 's1', kind: 'hut', x: 14, y: 9, w: 1, h: 1, burning: true, stage: 'complete' as const }],
        items: [],
        crops: [{ id: 'c1', kind: 'wheat', x: 12, y: 8, stage: 0, withered: true }],
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('burning')
    expect(prose).toContain('withered')
  })

  it('renders what the agent is carrying', () => {
    const packet = {
      ...quietMeadowPacket,
      self: {
        ...quietMeadowPacket.self,
        inventory: [{ id: 'b1', kind: 'bread', qty: 3, loc: { t: 'agent' as const, id: 'tamar' } }],
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('carrying')
    expect(prose).toContain('3 bread')
  })

  it('renders collapse and severe hunger', () => {
    const packet = {
      ...quietMeadowPacket,
      self: {
        ...quietMeadowPacket.self,
        collapsed: true,
        body: {
          ...quietMeadowPacket.self.body,
          needs: { ...quietMeadowPacket.self.body.needs, hunger: 3 },
        },
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('collapsed')
    expect(prose).toContain('aches with hunger')
  })

  it('never mentions the sun at night', () => {
    const nightPacket = {
      ...quietMeadowPacket,
      time: { ...quietMeadowPacket.time, hour: 22, isNight: true },
    }
    const prose = perceptionToProse(nightPacket)
    expect(prose).toContain('night')
    expect(prose).not.toContain('sun')
    expect(prose).toContain('clear')
  })

  it('renders self position and visible coordinates with marks', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        agents: [],
        structures: [{ id: 'structure_1', kind: 'storehouse', x: 14, y: 9, w: 1, h: 1, burning: false, stage: 'complete' as const }],
        items: [{ id: 'item_1', kind: 'bread', qty: 20, loc: { t: 'tile' as const, x: 13, y: 9 } }],
        crops: [{ id: 'crop_1', kind: 'wheat', x: 12, y: 8, stage: 2, withered: false }],
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('You stand at (12, 9)')
    expect(prose).toContain('storehouse (structure_1) stands at (14, 9)')
    expect(prose).toContain('20 bread (item_1) at (13, 9)')
    expect(prose).toContain('wheat (crop_1) at (12, 8)')
  })

  it('escalates weariness severity so the mind knows to rest', () => {
    const tired = {
      ...quietMeadowPacket,
      self: { ...quietMeadowPacket.self, body: { ...quietMeadowPacket.self.body, needs: { ...quietMeadowPacket.self.body.needs, energy: 20 } } },
    }
    expect(perceptionToProse(tired)).toContain('you must rest')

    const collapsing = {
      ...quietMeadowPacket,
      self: { ...quietMeadowPacket.self, body: { ...quietMeadowPacket.self.body, needs: { ...quietMeadowPacket.self.body.needs, energy: 8 } } },
    }
    expect(perceptionToProse(collapsing)).toContain('sleep NOW')
  })

  it('renders structure footprint and advises walking beside it', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        agents: [],
        structures: [{ id: 'structure_1', kind: 'storehouse', x: 10, y: 10, w: 2, h: 1, burning: false, stage: 'complete' as const }],
        items: [],
        crops: [],
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('storehouse (structure_1) stands at (10, 10)')
    expect(prose).toContain('2 tiles wide and 1 tile tall')
    expect(prose).toContain('walk to a tile beside it')
  })

  it('varies the stance verb by agent state', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        agents: [
          { id: 'nadia', name: 'Nadia', x: 16, y: 10, activityVerb: null, collapsed: true, asleep: false },
          { id: 'edda', name: 'Edda', x: 15, y: 11, activityVerb: null, collapsed: false, asleep: true },
        ],
        structures: [],
        items: [],
        crops: [],
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('Nadia (nadia) lies collapsed at (16, 10)')
    expect(prose).toContain('Edda (edda) sleeps at (15, 11)')
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

describe('capabilities', () => {
  it('carries a diegetic capability block in the system prompt', () => {
    const a = assemblePrompt(fixtureBlocks())
    for (const verb of ['walk', 'eat', 'sleep', 'wake', 'speak', 'take', 'give', 'till', 'extinguish', 'attack']) {
      expect(a.system).toContain(verb)
    }
    expect(a.system).not.toMatch(FORBIDDEN_FRAMING)
  })
  it('carries diegetic parameter contracts for each verb', () => {
    const a = assemblePrompt(fixtureBlocks())
    expect(a.system).toContain('walk to a place')
    expect(a.system).toContain('give its position as two numbers')
    expect(a.system).toContain('eat the food you hold')
    expect(a.system).toContain('give its mark')
    expect(a.system).toContain('give the thing')
    expect(a.system).toContain('speak')
    expect(a.system).toContain('nothing more is needed')
    expect(a.system).toContain('experiment')
    expect(a.system).toContain('describe what you attempt')
    expect(a.system).not.toMatch(FORBIDDEN_FRAMING)
  })
})
