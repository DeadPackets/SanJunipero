import { describe, expect, it } from 'vitest'
import { perceptionToProse, type PerceptionPacket, type ProseWorld } from './prose.js'
import { quietMeadowPacket, FLAT_WORLD } from '../testutil/fixtures.js'

// r31's now-prose spent 8 tokens in 600 on people. A body in sight is somebody to this mind,
// and it is at something: both belong on the one line that names it.

const nadia = (over: Partial<PerceptionPacket['visible']['agents'][number]> = {}) => ({
  id: 'nadia',
  name: 'Nadia',
  x: 12,
  y: 14,
  activityVerb: null,
  collapsed: false,
  asleep: false,
  ...over,
})

const seeing = (agent: ReturnType<typeof nadia>, world: ProseWorld = FLAT_WORLD): string =>
  perceptionToProse(
    { ...quietMeadowPacket, visible: { ...quietMeadowPacket.visible, agents: [agent] } },
    undefined,
    world,
  )

const warm = (warmth: number): ProseWorld => ({ ...FLAT_WORLD, warmthToward: () => warmth })

describe('★ a person in sight is somebody, at something', () => {
  it('a friend is called a friend, and what they are at is said', () => {
    expect(seeing(nadia({ activityVerb: 'fish' }), warm(10))).toContain(
      'Nadia (nadia), a friend, stands close to the south, fishing.',
    )
  })

  it('a close friend and a grudge each get their word', () => {
    expect(seeing(nadia(), warm(25))).toContain('Nadia (nadia), a close friend, stands')
    expect(seeing(nadia(), warm(-5))).toContain(
      'Nadia (nadia), who you are on bad terms with, stands',
    )
  })

  it('a stranger or a slight acquaintance gets no word, and a world that cannot say leaves it out', () => {
    expect(seeing(nadia(), warm(0))).toContain('Nadia (nadia) stands close to the south.')
    expect(seeing(nadia(), warm(5))).toContain('Nadia (nadia) stands close to the south.')
    expect(seeing(nadia())).toContain('Nadia (nadia) stands close to the south.')
  })

  it('a verb with no plain word is said as nothing, never as its id', () => {
    const said = seeing(nadia({ activityVerb: 'recipe:inspect_exterior' }))
    expect(said).toContain('Nadia (nadia) stands close to the south.')
    expect(said).not.toContain('inspect_exterior')
  })

  it('a sleeper is not at anything', () => {
    expect(seeing(nadia({ asleep: true, activityVerb: 'fish' }), warm(10))).toContain(
      'Nadia (nadia), a friend, sleeps close to the south.',
    )
  })
})
