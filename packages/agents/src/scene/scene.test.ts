import { describe, expect, it } from 'vitest'
import { SCENE_CORPUS_LINES } from '@sj/shared/testutil'
import type { Tie } from '../memory/ties.js'
import {
  addressedIn,
  appendLine,
  councilDecided,
  lawIdOf,
  lineCapFor,
  nextFloor,
  openScene,
  proposesALaw,
  sceneId,
  SceneTurnSchema,
  tallyCouncil,
  threadFor,
  upgradedKind,
  wrapUpDue,
  type Scene,
  type Stance,
} from './scene.js'

const NAMES: Record<string, string> = {
  nadia: 'Nadia',
  omar: 'Omar',
  salma: 'Salma',
  yusuf: 'Yusuf',
}
const nameOf = (id: string): string | null => NAMES[id] ?? null
const noWarmth = (): number => 0

function scene(participants = ['nadia', 'omar', 'salma'], audience: string[] = []): Scene {
  return openScene({
    openedTick: 600,
    participants,
    audience,
    opener: participants[0]!,
    topic: null,
    stakes: 5,
  })
}

const say = (s: Scene, agentId: string, text: string, tick = 601): void => {
  appendLine(s, { agentId, text, aside: `${agentId} thinks`, move: 'none', tick })
}

describe('the floor', () => {
  it('goes to whoever the line addressed, by first name', () => {
    const s = scene()
    expect(nextFloor(s, 'nadia', 'Salma, you saw it too.', null, nameOf, noWarmth)).toBe('salma')
  })

  it('reads the first name addressed when a line addresses two', () => {
    const s = scene()
    expect(
      nextFloor(s, 'nadia', 'Omar, you promised. Salma, you heard him.', null, nameOf, noWarmth),
    ).toBe('omar')
  })

  it('does not hear a name inside another word', () => {
    const s = scene(['nadia', 'omar'])
    // "Omar" is not in "Omarov", and nobody was addressed, so the anchor answers instead.
    expect(nextFloor(s, 'omar', 'The Omarov place is empty.', null, nameOf, noWarmth)).toBe('nadia')
  })

  it('hands a pass and an unaddressed line back to the anchor', () => {
    const s = scene()
    say(s, 'omar', 'Fine.')
    expect(nextFloor(s, 'omar', 'Somebody say something.', null, nameOf, noWarmth)).toBe('nadia')
    expect(nextFloor(s, 'salma', '', null, nameOf, noWarmth), 'a silence too').toBe('nadia')
  })

  it('breaks a tie on how warm the speaker feels, once the anchor is the one speaking', () => {
    const s = scene()
    const warmth = (id: string): number => (id === 'salma' ? 3 : 0)
    expect(nextFloor(s, 'nadia', 'Well?', null, nameOf, warmth)).toBe('salma')
    expect(nextFloor(s, 'nadia', 'Well?', null, nameOf, noWarmth), 'no warmth: lowest id').toBe(
      'omar',
    )
  })

  it('never hands the floor back to the mouth that just spoke', () => {
    const s = scene(['nadia', 'omar'])
    expect(nextFloor(s, 'nadia', 'Nadia is right about this.', null, nameOf, noWarmth)).toBe('omar')
  })

  it('is nobody when there is nobody left to hand it to', () => {
    expect(nextFloor(scene(['nadia']), 'nadia', 'Anyone?', null, nameOf, noWarmth)).toBeNull()
  })
})

describe('`to` decides the floor before the words do', () => {
  it('takes the name the mind wrote, by first name, full name or id', () => {
    const s = scene()
    for (const to of ['Salma', 'salma', 'SALMA']) {
      expect(nextFloor(s, 'nadia', 'Anyone at all.', to, nameOf, noWarmth)).toBe('salma')
    }
  })

  it('outranks a name the words addressed', () => {
    const s = scene()
    expect(nextFloor(s, 'nadia', 'Omar, the planks.', 'Salma', nameOf, noWarmth)).toBe('salma')
  })

  it('falls through to the anchor when it names nobody who is here', () => {
    const s = scene()
    expect(nextFloor(s, 'omar', 'Anyone at all.', 'Kepler', nameOf, noWarmth)).toBe('nadia')
    expect(nextFloor(s, 'omar', 'Anyone at all.', '  ', nameOf, noWarmth)).toBe('nadia')
  })

  it('reaches into the audience, which is how a bystander is drawn in', () => {
    const s = scene(['nadia', 'omar'], ['yusuf'])
    expect(nextFloor(s, 'nadia', 'Anyone at all.', 'Yusuf', nameOf, noWarmth)).toBe('yusuf')
    expect(nextFloor(s, 'nadia', 'Yusuf, you were there.', null, nameOf, noWarmth)).toBe('yusuf')
  })

  it('never picks an audience member the words only mentioned', () => {
    const s = scene(['nadia', 'omar'], ['yusuf'])
    expect(nextFloor(s, 'omar', 'Yusuf told me the same thing.', null, nameOf, noWarmth)).toBe(
      'nadia',
    )
  })
})

// A mention is about somebody; an address is to them. The whole difference is punctuation, and
// getting it wrong hands the floor to a stranger who has nothing to answer.
describe('twenty lines, mentions against addresses', () => {
  const ADDRESSED: readonly string[] = [
    'Yusuf, is that true?',
    'Yusuf. Six planks.',
    'Yusuf?',
    'Yusuf!',
    'Is that true, Yusuf?',
    'No, Yusuf, you did not.',
    'I counted them twice — Yusuf, twice.',
    'Then say it: Yusuf, say it.',
    'Yusuf; the well first.',
    'That is enough, Yusuf.',
  ]
  const MENTIONED: readonly string[] = [
    'Yusuf said so.',
    'It was Yusuf who counted.',
    'I saw Yusuf at the well.',
    "Yusuf's plank is the short one.",
    'The Yusufov place is empty.',
    'Ask Yusuf about it.',
    'Yusuf and Salma went down together.',
    'Nobody has seen Yusuf since dawn.',
    'That is what Yusuf always says.',
    'She married Yusuf in the spring.',
  ]

  it.each(ADDRESSED)('gives the floor on %s', (text) => {
    expect(addressedIn(text, ['yusuf'], nameOf)).toBe('yusuf')
  })

  it.each(MENTIONED)('gives no floor on %s', (text) => {
    expect(addressedIn(text, ['yusuf'], nameOf)).toBeNull()
  })
})

describe('how long a talk runs', () => {
  it('is twelve lines for a pair and four more for every mind past that', () => {
    expect(lineCapFor(2)).toBe(12)
    expect(lineCapFor(3)).toBe(12)
    expect(lineCapFor(6)).toBe(24)
    expect(lineCapFor(12)).toBe(48)
    expect(lineCapFor(20), 'and never more than forty-eight').toBe(48)
  })

  it('cues the wrap two lines before the cap, whatever the cast', () => {
    for (const cast of [
      ['nadia', 'omar'],
      ['nadia', 'omar', 'salma', 'yusuf', 'a', 'b'],
    ]) {
      const s = scene(cast)
      const cue = lineCapFor(cast.length) - 2
      for (let i = 0; i < cue - 2; i++) say(s, cast[i % cast.length]!, `line ${i}`)
      expect(wrapUpDue(s), `${cast.length} minds: the ask for line ${cue - 1}`).toBe(false)
      say(s, cast[0]!, 'one more')
      expect(wrapUpDue(s), `${cast.length} minds: the ask for line ${cue}`).toBe(true)
    }
  })
})

describe('the thread', () => {
  it('shows a mind its own asides and nobody else’s', () => {
    const s = scene(['nadia', 'omar'])
    say(s, 'nadia', 'Six planks.')
    say(s, 'omar', 'Ask about the boy first.')
    const asNadia = threadFor(s, 'nadia')
    expect(asNadia.map((l) => l.aside)).toEqual(['nadia thinks', ''])
    expect(threadFor(s, 'omar').map((l) => l.aside)).toEqual(['', 'omar thinks'])
    expect(
      asNadia.map((l) => l.text),
      'every line is still there',
    ).toEqual(['Six planks.', 'Ask about the boy first.'])
  })

  it('carries an arrival and a going as lines of their own', () => {
    const s = scene(['nadia', 'omar'])
    say(s, 'nadia', 'Six planks.')
    appendLine(s, {
      agentId: 'salma',
      text: '',
      aside: '',
      move: 'none',
      tick: 602,
      presence: 'joined',
    })
    expect(threadFor(s, 'nadia').map((l) => l.presence)).toEqual([undefined, 'joined'])
  })
})

describe('the kind a scene becomes', () => {
  const noTies = (): Tie[] => []
  const grudge = (): Tie[] => [
    {
      id: 1,
      personId: 'omar',
      kind: 'grudge',
      text: 'He never brought the planks.',
      tick: 500,
      settledTick: null,
      source: 'scene',
    },
  ]

  it('stays a talk while no tie exists', () => {
    const s = scene(['nadia', 'omar'])
    const said = 'Omar, the planks.'
    expect(upgradedKind(s, said, { tiesOf: noTies, nameOf, gathering: false })).toBe('talk')
  })

  it('becomes a quarrel once an open grudge is there to be named', () => {
    const s = scene(['nadia', 'omar'])
    expect(upgradedKind(s, 'Omar, the planks.', { tiesOf: grudge, nameOf, gathering: false })).toBe(
      'quarrel',
    )
  })

  it('does not fire on a grudge the line never named', () => {
    const s = scene(['nadia', 'omar'])
    expect(
      upgradedKind(s, 'The rain held off.', { tiesOf: grudge, nameOf, gathering: false }),
    ).toBe('talk')
  })

  it('does not fire on a grudge already settled', () => {
    const settled = (): Tie[] => grudge().map((t) => ({ ...t, settledTick: 600 }))
    const s = scene(['nadia', 'omar'])
    expect(
      upgradedKind(s, 'Omar, the planks.', { tiesOf: settled, nameOf, gathering: false }),
    ).toBe('talk')
  })

  it('becomes a council on a proposal, and a gathering on a crowd', () => {
    const s = scene(['nadia', 'omar'])
    expect(proposesALaw('From now on the well is drawn at dawn')).toBe(true)
    expect(proposesALaw('Let us agree we carry back what we take')).toBe(true)
    expect(proposesALaw('I drew water at dawn')).toBe(false)
    expect(
      upgradedKind(s, 'From now on we draw at dawn.', { tiesOf: noTies, nameOf, gathering: false }),
    ).toBe('council')
    expect(upgradedKind(s, 'The fire is lit.', { tiesOf: noTies, nameOf, gathering: true })).toBe(
      'gathering',
    )
  })
})

describe('what a room sounds like putting a rule to itself', () => {
  const proposals = [
    'From now on the well is drawn at dawn',
    'From this day the fire is banked before bed',
    'Let us agree the store is shut after dark',
    'The rule is one sack each',
    'Nobody may take another’s planks',
    'Nobody shall fish the pool above the ford',
    'We let go of the rule about the fire',
    'The fire tax is no longer ours to keep',
  ]

  it('hears each of them', () => {
    for (const said of proposals) expect(proposesALaw(said), said).toBe(true)
  })

  it('does not hear a plain sentence about the same things', () => {
    expect(proposesALaw('I drew water at dawn')).toBe(false)
    expect(proposesALaw('The store was shut when I got there')).toBe(false)
    expect(proposesALaw('Nobody came to the fire tonight')).toBe(false)
    expect(proposesALaw('We should all carry back what we take')).toBe(false)
    expect(proposesALaw('I no longer want the soup')).toBe(false)
    expect(proposesALaw('Let us call it a night')).toBe(false)
  })
})

describe('how a room counts itself', () => {
  const council = (proposedBy: string, stances: Record<string, Stance>): Scene => {
    const s = scene(['nadia', 'omar', 'salma'])
    s.kind = 'council'
    s.proposal = { lawText: 'One sack each.', proposedBy, stances, predicate: { kind: 'none' } }
    return s
  }

  it('counts the one who put it as for it', () => {
    const tally = tallyCouncil(council('nadia', { omar: 'for' }))
    expect(tally.for).toEqual(['nadia', 'omar'])
    expect(tally.passed).toBe(true)
  })

  it('passes a room that is only unsure, because silence is not opposition', () => {
    const tally = tallyCouncil(council('nadia', { omar: 'unsure', salma: 'unsure' }))
    expect(tally.unsure).toEqual(['omar', 'salma'])
    expect(tally.passed).toBe(true)
  })

  it('fails one against two', () => {
    expect(tallyCouncil(council('nadia', { omar: 'against', salma: 'against' })).passed).toBe(false)
  })

  it('passes nothing nobody answered', () => {
    const tally = tallyCouncil(council('nadia', {}))
    expect(tally.for).toEqual(['nadia'])
    expect(tally.passed, 'a rule said to a departing back is not a rule').toBe(false)
  })

  it('ignores a stance the one who put it wrote about their own rule', () => {
    expect(tallyCouncil(council('nadia', { nadia: 'against' })).passed).toBe(false)
  })

  it('is decided once everybody else has answered, and not before', () => {
    expect(councilDecided(council('nadia', { omar: 'for' }))).toBe(false)
    expect(councilDecided(council('nadia', { omar: 'for', salma: 'against' }))).toBe(true)
  })

  it('decides nothing in a talk that carries no rule', () => {
    expect(councilDecided(scene())).toBe(false)
    expect(tallyCouncil(scene()).passed).toBe(false)
  })

  it('names the rule after the talk that made it', () => {
    const s = scene(['nadia', 'omar'])
    expect(lawIdOf(s)).toBe(s.id.replace('scene_', 'law_'))
    expect(lawIdOf(s).startsWith('law_')).toBe(true)
  })
})

describe('a scene’s id', () => {
  it('is the same for the same opening tick and cast, whatever order they arrived in', () => {
    expect(sceneId(600, ['omar', 'nadia'])).toBe(sceneId(600, ['nadia', 'omar']))
    expect(sceneId(600, ['nadia', 'omar'])).not.toBe(sceneId(601, ['nadia', 'omar']))
    expect(sceneId(600, ['nadia', 'omar'])).not.toBe(sceneId(600, ['nadia', 'salma']))
  })
})

describe('the recorded corpus', () => {
  it('is real answers in the shape a scene turn is asked for', () => {
    expect(SCENE_CORPUS_LINES.length).toBeGreaterThan(20)
    for (const line of SCENE_CORPUS_LINES) {
      const parsed = SceneTurnSchema.safeParse({
        thought: line.thought,
        speech: line.speech,
        to: null,
        gesture: null,
        move: line.move,
        stance: null,
        answer: null,
        ask: null,
        leave: line.leave,
        importance: line.importance,
      })
      expect(parsed.success, JSON.stringify(line)).toBe(true)
    }
  })
})
