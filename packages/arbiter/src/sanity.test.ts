import { describe, expect, it } from 'vitest'
import { assembleAdjudicationPrompt } from './prompt.js'
import { nearDuplicate, recipeSanityRefusal } from './sanity.js'
import type { Recipe } from './verdict.js'

// The eight verbs the mini-rehearsal minted and nobody could ever use. Each one below is a
// real row from that run, and each is refused by arithmetic alone.
const base: Recipe = {
  id: 'recipe:waterskin',
  name: 'Sew a Waterskin',
  durationTicks: 20,
  costs: [{ kind: 'hide', qty: 1 }],
  requires: [{ type: 'held_item', kind: 'hide', qty: 1 }],
  outcomeTable: [
    { weight: 1, success: true, label: 'The seams hold water.', effects: [{ op: 'spawn_item', kind: 'waterskin', qty: 1, to: 'agent' }] },
  ],
  rngStream: 'recipe:waterskin',
  interruptible: true,
  canon: ['fire'],
}

const vocab = {
  itemKinds: new Set(['hide', 'wood', 'fiber', 'clay', 'stone']),
  structureKinds: new Set(['hut', 'storehouse', 'weir']),
  knownProducts: new Set(['waterskin', 'basket']),
  knownRecipeIds: new Set(['recipe:waterskin']),
}

describe('the codification sanity gate', () => {
  it('lets an honest recipe through', () => {
    expect(recipeSanityRefusal(base)).toBeNull()
    expect(recipeSanityRefusal({ ...base, id: 'recipe:sew_waterskin' }, {
      itemKinds: vocab.itemKinds, structureKinds: vocab.structureKinds,
    })).toBeNull()
  })

  it('refuses a verdict word taken for a craft', () => {
    expect(recipeSanityRefusal({ ...base, id: 'recipe:attempt', name: 'Attempt' }))
      .toMatch(/verdict word/)
    expect(recipeSanityRefusal({ ...base, id: 'recipe:map', name: 'Map' })).toMatch(/verdict word/)
  })

  it('refuses an id that lost a letter on the way out', () => {
    expect(recipeSanityRefusal({ ...base, id: 'recipe:arrative', name: 'Narrative of the River' }))
      .toMatch(/arrative/)
    expect(recipeSanityRefusal({ ...base, id: 'recipe:waterskn', name: 'Sew a Waterskin' }))
      .not.toBeNull()
  })

  it('refuses a rule keyed to a thing standing in the world', () => {
    const keyed: Recipe = {
      ...base,
      requires: [{ type: 'held_item', kind: 'item_28', qty: 1 }],
    }
    expect(recipeSanityRefusal(keyed)).toMatch(/item_28/)
    expect(recipeSanityRefusal({ ...base, name: 'Repair structure_7' })).toMatch(/structure_7/)
  })

  it('refuses a material or a building the town has no word for', () => {
    const bronze: Recipe = { ...base, costs: [{ kind: 'bronze', qty: 1 }] }
    expect(recipeSanityRefusal(bronze, vocab)).toMatch(/bronze/)
    const forge: Recipe = { ...base, requires: [{ type: 'adjacent_structure', kind: 'forge' }] }
    expect(recipeSanityRefusal(forge, vocab)).toMatch(/forge/)
    // With no table shown, there is nothing to check against and the check stands down.
    expect(recipeSanityRefusal(bronze, { knownProducts: new Set() })).toBeNull()
  })

  it('refuses a second name for a thing the town already makes', () => {
    const rival: Recipe = {
      ...base,
      id: 'recipe:water_skin',
      name: 'Water Skin',
      outcomeTable: [{
        weight: 1, success: true, label: 'It holds water.',
        effects: [{ op: 'spawn_item', kind: 'waterskins', qty: 1, to: 'agent' }],
      }],
    }
    expect(recipeSanityRefusal(rival, vocab)).toMatch(/already makes|second name/)
  })

  it('knows a near-duplicate from two different things', () => {
    expect(nearDuplicate('waterskin', 'waterskins')).toBe(true)
    expect(nearDuplicate('waterskin', 'water_skin')).toBe(true)
    expect(nearDuplicate('basket', 'blanket')).toBe(false)
    expect(nearDuplicate('axe', 'awl')).toBe(false)
    expect(nearDuplicate('rope', 'rope')).toBe(false)
  })
})

describe('the materials the arbiter is shown', () => {
  const blocks = {
    canon: 'canon', frontier: ['pottery'],
    agent: { name: 'Tamar', skills: {}, inventory: [{ kind: 'hide', qty: 2 }], position: { x: 1, y: 2 } },
    precedent: [], intent: 'I sew a skin for water',
  }

  it('names every kind it will hold the answer to, and says a rule outlives a thing', () => {
    const withTable = assembleAdjudicationPrompt({
      ...blocks, materials: { itemKinds: ['hide', 'wood'], structureKinds: ['hut'] },
    })
    expect(withTable.system).toContain('hide, wood')
    expect(withTable.system).toContain('hut')
    expect(withTable.system).toMatch(/a recipe is a rule and outlives every one of them/i)
  })

  it('renders nothing at all when no table was given — byte-stable against the landed prompt', () => {
    const without = assembleAdjudicationPrompt(blocks)
    expect(without.system).not.toContain('has words for these things')
  })
})
