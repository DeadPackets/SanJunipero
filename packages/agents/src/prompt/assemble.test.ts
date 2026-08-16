import { describe, expect, it, vi } from 'vitest'
import { MYSTERIES } from '@sj/engine'
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

  it('orders messages stable→volatile: append-only dayLog before the per-turn scene (finding 9)', () => {
    const a = assemblePrompt(fixtureBlocks())
    expect(a.messages[0].content).toContain('Woke with the light.')
    expect(a.messages[1].content).toContain('What you remember:')
  })

  it('an appended dayLog entry only extends message 0; the scene bytes stand', () => {
    const base = fixtureBlocks()
    const before = assemblePrompt(base)
    const after = assemblePrompt({ ...base, dayLog: [...base.dayLog, 'I traded a plank for flour.'] })

    expect(after.system).toBe(before.system)
    expect(after.messages[0].content.startsWith(before.messages[0].content)).toBe(true)
    expect(after.messages[1]).toEqual(before.messages[1])
  })

  it('leaves system and dayLog byte-identical when the scene block changes', () => {
    const base = fixtureBlocks()
    const before = assemblePrompt(base)
    const changed = assemblePrompt({
      ...base,
      scene: { ...base.scene, memories: [...base.scene.memories, base.scene.memories[0]] },
    })

    expect(changed.system).toBe(before.system)
    expect(changed.messages[0]).toEqual(before.messages[0])
    expect(changed.messages[1]).not.toEqual(before.messages[1])
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

  it('renders every precipitation start tag the engine emits without alerting', () => {
    for (const tag of ['rain_started', 'storm_started', 'snow_started']) {
      const alert = vi.fn()
      const prose = perceptionToProse({ ...quietMeadowPacket, feltEvents: [tag] }, alert)
      expect(prose).toContain(FELT_EVENT_PROSE[tag])
      expect(alert).not.toHaveBeenCalled()
    }
  })

  it('renders every global mystery as its authored sensation, never the fallback, never framed', () => {
    for (const m of MYSTERIES.filter((x) => x.scope === 'global')) {
      const alert = vi.fn()
      const prose = perceptionToProse({ ...quietMeadowPacket, feltEvents: [m.kind] }, alert)
      expect(prose).toContain(m.prose)
      expect(alert).not.toHaveBeenCalled()
    }
    for (const m of MYSTERIES) expect(m.prose).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('says whose a thing is, and whose hands made it', () => {
    const prose = perceptionToProse({
      ...quietMeadowPacket,
      self: {
        ...quietMeadowPacket.self,
        inventory: [{ id: 'item_9', kind: 'plank', qty: 1, loc: { t: 'agent', id: 'tamar' }, ownerName: 'Bex' }],
      },
      visible: {
        ...quietMeadowPacket.visible,
        items: [{
          id: 'item_3', kind: 'basket', qty: 1, loc: { t: 'tile', x: 12, y: 10 },
          ownerName: 'Rahel', crafterMarkName: 'Yusuf',
        }],
      },
    })
    expect(prose).toContain("basket (item_3) at (12, 10) — Rahel's, marked by Yusuf")
    expect(prose).toContain("carrying 1 plank (item_9) — Bex's")
  })

  it('leaves an unclaimed thing exactly as it always read', () => {
    const prose = perceptionToProse({
      ...quietMeadowPacket,
      visible: {
        ...quietMeadowPacket.visible,
        items: [{ id: 'item_3', kind: 'basket', qty: 1, loc: { t: 'tile', x: 12, y: 10 } }],
      },
    })
    expect(prose).toContain('You can see 1 basket (item_3) at (12, 10).')
    expect(prose).not.toContain('—')
  })

  it('tells you what you watched happen: a taking, and an unexplained thing', () => {
    const mystery = MYSTERIES.find((m) => m.scope === 'located')!
    const prose = perceptionToProse({
      ...quietMeadowPacket,
      seen: [
        { kind: 'item_taken', takerName: 'Cass', ownerName: 'Bex', itemKind: 'plank' },
        { kind: 'mystery', mystery: mystery.kind, prose: mystery.prose },
      ],
    })
    expect(prose).toContain("You watch Cass take Bex's plank.")
    expect(prose).toContain(mystery.prose)
    expect(prose).not.toMatch(FORBIDDEN_FRAMING)
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

  it('offers the nearest open tile beside a structure when the world can be asked', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        agents: [],
        structures: [{ id: 'structure_1', kind: 'storehouse', x: 10, y: 10, w: 1, h: 1, burning: false, stage: 'complete' as const }],
        items: [],
        crops: [],
      },
    }
    // Self is at (12, 9): with all neighbors open, (11, 9) is nearest.
    const open = perceptionToProse(packet, undefined, { isWalkable: () => true })
    expect(open).toContain('you could stand beside it at (11, 9)')
    expect(open).not.toContain('walk to a tile beside it')

    // Only (10, 11) is open ground; the offer must skip blocked tiles.
    const oneGap = perceptionToProse(packet, undefined, { isWalkable: (x, y) => x === 10 && y === 11 })
    expect(oneGap).toContain('you could stand beside it at (10, 11)')

    // No open ground at all: say so instead of pointing at a wall.
    const walled = perceptionToProse(packet, undefined, { isWalkable: () => false })
    expect(walled).toContain('no open ground lies beside it')
  })

  it('names the food in hand when hunger gnaws (g3 round 6)', () => {
    const hungry = {
      ...quietMeadowPacket,
      self: {
        ...quietMeadowPacket.self,
        body: { ...quietMeadowPacket.self.body, needs: { ...quietMeadowPacket.self.body.needs, hunger: 20 } },
        inventory: [
          { id: 'w1', kind: 'wood', qty: 2, loc: { t: 'agent' as const, id: 'tamar' } },
          { id: 'b1', kind: 'bread', qty: 20, loc: { t: 'agent' as const, id: 'tamar' } },
        ],
      },
    }
    const isEdible = (kind: string) => kind === 'bread'
    expect(perceptionToProse(hungry, undefined, { isEdible })).toContain('Your satchel holds bread (b1) — you could eat it now.')

    // Sated: no nagging about the satchel.
    const sated = { ...hungry, self: { ...hungry.self, body: quietMeadowPacket.self.body } }
    expect(perceptionToProse(sated, undefined, { isEdible })).not.toContain('you could eat it now')

    // Hungry but holding nothing edible: no false comfort.
    const noFood = { ...hungry, self: { ...hungry.self, inventory: [hungry.self.inventory[0]!] } }
    expect(perceptionToProse(noFood, undefined, { isEdible })).not.toContain('you could eat it now')
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

  it('renders self stance by asleep/collapsed state', () => {
    const asleep = { ...quietMeadowPacket, self: { ...quietMeadowPacket.self, asleep: true } }
    expect(perceptionToProse(asleep)).toContain('You sleep at (12, 9)')

    const collapsed = { ...quietMeadowPacket, self: { ...quietMeadowPacket.self, collapsed: true } }
    expect(perceptionToProse(collapsed)).toContain('You lie at (12, 9)')
  })

  it('pluralizes footprint width and height correctly', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        agents: [],
        structures: [{ id: 's1', kind: 'hut', x: 10, y: 10, w: 1, h: 2, burning: false, stage: 'complete' as const }],
        items: [],
        crops: [],
      },
    }
    const prose = perceptionToProse(packet)
    expect(prose).toContain('1 tile wide and 2 tiles tall')
    expect(prose).not.toContain('1 tiles wide')
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
    const sceneTokens = Math.ceil(a.messages[1].content.length / 4)
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
    expect(a.system).toContain('name it walk')
    expect(a.system).toContain('give x and y as two numbers')
    expect(a.system).toContain('speak')
    expect(a.system).toContain('nothing more is needed')
    expect(a.system).toContain('experiment')
    expect(a.system).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('names every verb token and its exact parameter keys (finding 7)', () => {
    const a = assemblePrompt(fixtureBlocks())
    const verbs = [
      'walk', 'sleep', 'wake', 'eat', 'tend', 'till', 'plant', 'harvest', 'fish', 'forage',
      'build', 'craft', 'extinguish', 'speak', 'give', 'take', 'write', 'read', 'teach', 'attack', 'experiment',
    ]
    for (const v of verbs) expect(a.system, v).toContain(v)
    for (const key of ['itemId', 'targetId', 'cropId', 'structureId', 'recipe', 'track', 'description', 'text', 'kind']) {
      expect(a.system, key).toContain(key)
    }
    // an item's mark is only learned by standing beside where it rests
    expect(a.system).toContain('beside')
    expect(a.system).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('teaches give as person-only, wake as the way to rise, and stow as the way to shelve (g3 round 6, T17)', () => {
    const a = assemblePrompt(fixtureBlocks())
    expect(a.system).toMatch(/give — [^\n]*living person[^\n]*never a building/)
    expect(a.system).toMatch(/wake — [^\n]*rise/)
    expect(a.system).toContain('no way to set a thing down on bare ground')
    expect(a.system).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('carries a response contract naming every turn field (finding 8)', () => {
    const a = assemblePrompt(fixtureBlocks())
    for (const field of ['thought', 'speech', 'action', 'plan', 'journal', 'importance', 'reconsider_at']) {
      expect(a.system, field).toContain(field)
    }
    expect(a.system).toContain('08:30')
    expect(a.system).not.toMatch(FORBIDDEN_FRAMING)
  })
})
