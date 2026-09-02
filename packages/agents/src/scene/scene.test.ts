import { describe, expect, it } from 'vitest'
import { SCENE_CORPUS_LINES } from '@sj/shared/testutil'
import type { Tie } from '../memory/ties.js'
import {
  appendLine,
  nextFloor,
  openScene,
  proposesALaw,
  sceneId,
  SceneTurnSchema,
  threadFor,
  upgradedKind,
  wrapUpDue,
  WRAP_CUE_LINE,
  type Scene,
} from './scene.js'

const NAMES: Record<string, string> = { nadia: 'Nadia', omar: 'Omar', salma: 'Salma' }
const nameOf = (id: string): string | null => NAMES[id] ?? null
const noWarmth = (): number => 0

function scene(participants = ['nadia', 'omar', 'salma']): Scene {
  return openScene({
    openedTick: 600,
    participants,
    opener: participants[0]!,
    topic: null,
    stakes: 5,
  })
}

const say = (s: Scene, agentId: string, text: string, tick = 601): void => {
  appendLine(s, { agentId, text, aside: `${agentId} thinks`, move: 'none', tick })
}

describe('the floor', () => {
  it('goes to whoever the line named, by first name', () => {
    const s = scene()
    expect(nextFloor(s, 'nadia', 'Salma, you saw it too.', nameOf, noWarmth)).toBe('salma')
  })

  it('reads the first name spoken when a line names two', () => {
    const s = scene()
    expect(nextFloor(s, 'nadia', 'Omar promised, and Salma heard him.', nameOf, noWarmth)).toBe(
      'omar',
    )
  })

  it('does not hear a name inside another word', () => {
    const s = scene(['nadia', 'omar'])
    // "Omar" is not in "Omarov"; with nobody named, the least-spoken rule answers instead.
    expect(nextFloor(s, 'nadia', 'The Omarov place is empty.', nameOf, noWarmth)).toBe('omar')
  })

  it('falls to whoever has said least when the line names nobody', () => {
    const s = scene()
    say(s, 'omar', 'Fine.')
    say(s, 'nadia', 'It is not fine.')
    say(s, 'omar', 'It is.')
    expect(nextFloor(s, 'nadia', 'Somebody say something.', nameOf, noWarmth)).toBe('salma')
  })

  it('breaks a tie on how warm the speaker feels', () => {
    const s = scene()
    const warmth = (id: string): number => (id === 'salma' ? 3 : 0)
    expect(nextFloor(s, 'nadia', 'Well?', nameOf, warmth)).toBe('salma')
    expect(nextFloor(s, 'nadia', 'Well?', nameOf, noWarmth), 'no warmth: lowest id').toBe('omar')
  })

  it('never hands the floor back to the mouth that just spoke', () => {
    const s = scene(['nadia', 'omar'])
    expect(nextFloor(s, 'nadia', 'Nadia is right about this.', nameOf, noWarmth)).toBe('omar')
  })

  it('is nobody when there is nobody left to hand it to', () => {
    expect(nextFloor(scene(['nadia']), 'nadia', 'Anyone?', nameOf, noWarmth)).toBeNull()
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

  it('cues the wrap on the tenth line and not the ninth', () => {
    const s = scene(['nadia', 'omar'])
    for (let i = 0; i < WRAP_CUE_LINE - 2; i++) say(s, i % 2 === 0 ? 'nadia' : 'omar', `line ${i}`)
    expect(wrapUpDue(s), 'the ask for the ninth line').toBe(false)
    say(s, 'omar', 'line 8')
    expect(wrapUpDue(s), 'the ask for the tenth line').toBe(true)
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
    expect(proposesALaw('We should all carry back what we take')).toBe(true)
    expect(proposesALaw('I drew water at dawn')).toBe(false)
    expect(
      upgradedKind(s, 'From now on we draw at dawn.', { tiesOf: noTies, nameOf, gathering: false }),
    ).toBe('council')
    expect(upgradedKind(s, 'The fire is lit.', { tiesOf: noTies, nameOf, gathering: true })).toBe(
      'gathering',
    )
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
        gesture: null,
        move: line.move,
        stance: null,
        answer: null,
        leave: line.leave,
        importance: line.importance,
      })
      expect(parsed.success, JSON.stringify(line)).toBe(true)
    }
  })
})
