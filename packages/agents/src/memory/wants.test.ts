import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { MINUTES_PER_DAY } from '@sj/shared'
import { openAgentDb } from './schema.js'
import {
  FED_BY,
  occasionsInPacket,
  WANT_CAP,
  WANT_KINDS,
  WANT_RISE_PER_TICK,
  WantStore,
  type WantBias,
  type WantKind,
  type WantOccasion,
} from './wants.js'
import { assemblePrompt } from '../prompt/assemble.js'
import { wantLine } from '../prompt/prose.js'
import { fixtureBlocks, quietMeadowPacket } from '../testutil/fixtures.js'
import type { PerceptionPacket } from '../prompt/prose.js'

const ME = 'Tamar'

const store = (bias: WantBias = {}): { db: Database.Database; wants: WantStore } => {
  const db = openAgentDb(':memory:')
  return { db, wants: new WantStore(db, 'tamar', bias) }
}

const packet = (over: Partial<PerceptionPacket>): PerceptionPacket => ({
  ...quietMeadowPacket,
  ...over,
})

const heardFrom = (text: string): PerceptionPacket['heard'] => [
  { speakerId: 'nadia', name: 'Nadia', text, distance: 2 },
]

describe('a want rises while nothing answers it', () => {
  it('is at nothing on the tick the mind begins, whenever in the week that is', () => {
    const { wants } = store()
    wants.begin(5_000)
    // A mind booted mid-week must not read as a week of loneliness.
    expect(wants.levelOf('belonging', 5_000)).toBe(0)
    expect(wants.levelOf('belonging', 5_001)).toBeCloseTo(WANT_RISE_PER_TICK, 10)
  })

  it('anchors on the first look when nothing began it, and never again after', () => {
    const { wants } = store()
    expect(wants.levelOf('belonging', 5_000)).toBe(0)
    wants.begin(9_000)
    expect(wants.levelOf('belonging', 6_000)).toBeCloseTo(17, 10)
  })

  it('rises 0.017 a tick', () => {
    const { wants } = store()
    wants.feed(['scene'], 0)
    expect(wants.levelOf('belonging', 1)).toBeCloseTo(0.017, 10)
    expect(wants.levelOf('belonging', 100)).toBeCloseTo(1.7, 10)
    expect(wants.levelOf('belonging', MINUTES_PER_DAY)).toBeCloseTo(24.48, 10)
  })

  it('stops at the cap, which a mind reaches in four sim-days', () => {
    const { wants } = store()
    wants.feed(['scene'], 0)
    const full = WANT_CAP / WANT_RISE_PER_TICK
    expect(full / MINUTES_PER_DAY).toBeCloseTo(4.08, 2)
    expect(wants.levelOf('belonging', Math.ceil(full))).toBe(WANT_CAP)
    expect(wants.levelOf('belonging', 100 * MINUTES_PER_DAY)).toBe(WANT_CAP)
  })

  it('never runs backwards when the clock does', () => {
    const { wants } = store()
    wants.feed(['scene'], 500)
    expect(wants.levelOf('belonging', 400)).toBe(0)
  })
})

describe('★ what feeds a want', () => {
  it('carries the plan’s seven kinds and no others', () => {
    expect([...WANT_KINDS]).toEqual([
      'belonging',
      'affection',
      'esteem',
      'curiosity',
      'rivalry',
      'order',
      'legacy',
    ])
  })

  // One row of the contract's table per case: the occasion moves its own want to nothing and
  // leaves the other six exactly where an hour of rising had put them.
  for (const [occasion, kind] of Object.entries(FED_BY) as [WantOccasion, WantKind][]) {
    it(`${occasion} answers ${kind} and nothing else`, () => {
      const { wants } = store()
      const before = wants.levels(1_000)
      wants.feed([occasion], 1_000)
      const after = new Map(wants.levels(1_000).map((w) => [w.kind, w.level]))
      expect(after.get(kind)).toBe(0)
      for (const was of before) {
        if (was.kind === kind) continue
        expect(after.get(was.kind), was.kind).toBeCloseTo(was.level, 10)
      }
    })
  }

  it('a fed want starts over and rises again', () => {
    const { wants } = store()
    wants.begin(0)
    expect(wants.levelOf('belonging', 1_000)).toBeCloseTo(17, 10)
    wants.feed(['scene'], 1_000)
    expect(wants.levelOf('belonging', 1_000)).toBe(0)
    expect(wants.levelOf('belonging', 2_000)).toBeCloseTo(17, 10)
  })
})

describe('what a mind can see for itself', () => {
  it('praise addressed to you by name answers esteem', () => {
    expect(occasionsInPacket(packet({ heard: heardFrom('Tamar, well done.') }), ME)).toEqual([
      'praised',
    ])
    expect(occasionsInPacket(packet({ heard: heardFrom('Thank you, Tamar.') }), ME)).toEqual([
      'praised',
    ])
  })

  it('praise said to somebody else is not yours', () => {
    expect(occasionsInPacket(packet({ heard: heardFrom('Nadia, well done.') }), ME)).toEqual([])
    // Named but not addressed: a remark about you hands you nothing.
    expect(occasionsInPacket(packet({ heard: heardFrom('Tamar did well done work') }), ME)).toEqual(
      [],
    )
  })

  it('a plain word addressed to you is not praise', () => {
    expect(occasionsInPacket(packet({ heard: heardFrom('Tamar, the fire is out.') }), ME)).toEqual(
      [],
    )
  })

  it('a discovery witnessed answers curiosity', () => {
    const seen: PerceptionPacket['seen'] = [
      { kind: 'discovery', inventorName: 'Nadia', pronoun: 'she', name: 'the drying rack' },
    ]
    expect(occasionsInPacket(packet({ seen }), ME)).toEqual(['discovery_witnessed'])
  })

  it('a taking answers rivalry only when the thing was yours', () => {
    const taken = (ownerName: string): PerceptionPacket['seen'] => [
      { kind: 'item_taken', takerName: 'Nadia', ownerName, itemKind: 'bread' },
    ]
    expect(occasionsInPacket(packet({ seen: taken(ME) }), ME)).toEqual(['item_taken_from_you'])
    expect(occasionsInPacket(packet({ seen: taken('Omar') }), ME)).toEqual([])
  })

  it('a neighbour breaking what the town agreed answers order, and your own doing does not', () => {
    const breach = (self: boolean): PerceptionPacket['seen'] => [
      { kind: 'law_broken', breakerName: 'Nadia', lawText: 'Nobody takes at night.', self },
    ]
    expect(occasionsInPacket(packet({ seen: breach(false) }), ME)).toEqual(['law_broken'])
    expect(occasionsInPacket(packet({ seen: breach(true) }), ME)).toEqual([])
  })

  it('a blow answers rivalry', () => {
    expect(occasionsInPacket(packet({ feltEvents: ['you_were_attacked'] }), ME)).toEqual(['slight'])
    expect(occasionsInPacket(packet({ feltEvents: ['rain_started'] }), ME)).toEqual([])
  })

  it('a quiet moment answers nothing', () => {
    expect(occasionsInPacket(quietMeadowPacket, ME)).toEqual([])
  })
})

describe('★ personality biases the rise', () => {
  it('a mind that wants to be relied on feels the lack half again as fast', () => {
    const { wants } = store({ esteem: 1.5 })
    wants.feed(['praised', 'scene'], 0)
    expect(wants.levelOf('esteem', 1_000)).toBeCloseTo(25.5, 10)
    expect(wants.levelOf('belonging', 1_000)).toBeCloseTo(17, 10)
  })

  it('a kind the table leaves out rises at the common rate', () => {
    const { wants } = store({ esteem: 1.5 })
    wants.feed(['scene'], 0)
    expect(wants.levelOf('belonging', 1_000)).toBeCloseTo(17, 10)
  })

  it('a persona with no table at all rises at the common rate everywhere', () => {
    const plain = store().wants
    const biased = store({ legacy: 1.5 }).wants
    plain.begin(0)
    biased.begin(0)
    for (const kind of WANT_KINDS) {
      expect(plain.levelOf(kind, 1_000), kind).toBeCloseTo(17, 10)
    }
    expect(biased.levelOf('legacy', 1_000)).toBeCloseTo(25.5, 10)
  })

  it('the bias reaches the cap sooner and stops there all the same', () => {
    const { wants } = store({ esteem: 3 })
    wants.begin(0)
    expect(wants.levelOf('esteem', 10 * MINUTES_PER_DAY)).toBe(WANT_CAP)
  })
})

describe('★ the want the morning line names', () => {
  it('is the highest one', () => {
    const { wants } = store()
    for (const kind of WANT_KINDS) wants.feed([occasionFor(kind)], 1_000)
    wants.feed([occasionFor('curiosity')], 900)
    expect(wants.top(2_000)).toBe('curiosity')
  })

  it('breaks a tie on whichever went unfed longest, then on the contract’s order', () => {
    const { wants } = store()
    // Everything at the cap: only when it was last fed can separate them.
    wants.begin(0)
    wants.feed(['scene'], 200)
    const capped = wants.levels(1_000_000)
    expect(new Set(capped.map((w) => w.level))).toEqual(new Set([WANT_CAP]))
    expect(wants.top(1_000_000)).toBe('affection')
    expect(capped[capped.length - 1]?.kind).toBe('belonging')
    // With nothing to separate them at all, the contract's own order decides.
    const fresh = store().wants
    fresh.begin(0)
    expect(fresh.top(1_000_000)).toBe('belonging')
  })

  it('says the plan’s sentence, and nothing at all without a want', () => {
    expect(wantLine('belonging')).toBe(
      'Today the thing you want most is belonging. Who could give you that?',
    )
    expect(wantLine(null)).toBe('')
  })

  it('costs 18 tokens of a 7,368-token turn', () => {
    const blocks = fixtureBlocks()
    const withLine = {
      ...blocks,
      now: { ...blocks.now, prose: `${blocks.now.prose} ${wantLine('belonging')}` },
    }
    const delta = assemblePrompt(withLine).estTokens - assemblePrompt(blocks).estTokens
    expect(delta).toBe(18)
    // Every kind costs within a token of every other, so no mind's morning costs more than
    // another's.
    for (const kind of WANT_KINDS) {
      expect(Math.ceil((wantLine(kind).length + 1) / 4), kind).toBeLessThanOrEqual(18)
    }
  })

  it('adds no block and no message of its own', () => {
    const blocks = fixtureBlocks()
    const withLine = {
      ...blocks,
      now: { ...blocks.now, prose: `${blocks.now.prose} ${wantLine('belonging')}` },
    }
    expect(assemblePrompt(withLine).messages.length).toBe(assemblePrompt(blocks).messages.length)
    expect(assemblePrompt(withLine).system).toBe(assemblePrompt(blocks).system)
  })
})

describe('★ a want survives a snapshot and restore', () => {
  it('comes back off the same database at the level it had, still rising', () => {
    const { db, wants } = store({ esteem: 1.5 })
    wants.feed(['scene'], 1_000)
    wants.feed(['praised'], 1_200)

    // A resume builds a fresh store over the same rows; nothing about a want is carried in the
    // runtime snapshot, so this is the whole of it.
    const back = new WantStore(db, 'tamar', { esteem: 1.5 })
    expect(back.levelOf('belonging', 2_000)).toBeCloseTo(17, 10)
    // Fed 200 ticks later than the rest and still the highest: the bias came back too.
    expect(back.levelOf('esteem', 2_000)).toBeCloseTo(20.4, 10)
    expect(back.top(2_000)).toBe('esteem')
  })

  it('keeps one mind’s wants out of another’s book', () => {
    const { db, wants } = store()
    wants.begin(0)
    wants.feed(['scene'], 1_000)
    const other = new WantStore(db, 'nadia')
    other.begin(1_000)
    expect(other.levelOf('belonging', 2_000)).toBeCloseTo(17, 10)
    other.feed(['scene'], 2_000)
    expect(other.levelOf('belonging', 2_000)).toBe(0)
    expect(wants.levelOf('belonging', 2_000)).toBeCloseTo(17, 10)
  })
})

describe('★ the want a broken rule answers', () => {
  it('names `order` now that the town can write a rule to break', () => {
    const { wants } = store()
    wants.begin(0)
    const late = 9 * MINUTES_PER_DAY
    wants.feed(['scene', 'expressed_at', 'taught', 'new_place', 'slight', 'verb_codified'], late)

    // ★ Not vacuous: `order` IS the store's highest, alone at the cap, and it is the answer.
    expect(wants.levelOf('order', late)).toBe(WANT_CAP)
    expect(wants.levels(late)[0]!.kind).toBe('order')
    expect(wants.top(late)).toBe('order')

    // And a neighbour breaking what the town agreed is what puts it down again.
    wants.feed(['law_broken'], late)
    expect(wants.levelOf('order', late)).toBe(0)
    expect(wants.top(late)).not.toBe('order')
  })
})

// The occasion this test reaches for when all it wants is to feed one named kind.
function occasionFor(kind: WantKind): WantOccasion {
  const found = (Object.entries(FED_BY) as [WantOccasion, WantKind][]).find(
    ([, k]) => k === kind,
  )?.[0]
  if (found === undefined) throw new Error(`no occasion feeds ${kind}`)
  return found
}

describe('the wants a relationship answers', () => {
  it('feeds affection off a partnership and legacy off a child', () => {
    expect(FED_BY.partnered).toBe('affection')
    expect(FED_BY.child).toBe('legacy')
  })
})
