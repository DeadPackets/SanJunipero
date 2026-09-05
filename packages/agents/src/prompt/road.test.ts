import { describe, expect, it } from 'vitest'
import { scanForDirective, scanPromptForGlassLeak } from '@sj/shared'
import { quietMeadowPacket } from '../testutil/fixtures.js'
import { CAPABILITIES } from './rulesOfBeing.js'
import { perceptionToProse, roadOutLine, valleyExtentLine, type PerceptionPacket } from './prose.js'

type Agent = PerceptionPacket['visible']['agents'][number]

const person = (over: Partial<Agent> = {}): Agent => ({
  id: 'agent_9',
  name: 'Mira',
  x: 21,
  y: 20,
  activityVerb: null,
  collapsed: false,
  asleep: false,
  ...over,
})

const seeing = (over: Partial<PerceptionPacket>): PerceptionPacket => ({
  ...quietMeadowPacket,
  ...over,
})

const withAgents = (agents: Agent[]): PerceptionPacket =>
  seeing({ visible: { ...quietMeadowPacket.visible, agents } })

const world = { extent: () => ({ w: 128, h: 128 }) }

describe('★ the valley has a way out of it now', () => {
  it('says so at the edge, where a body used to be told there was nothing beyond', () => {
    const said = perceptionToProse(seeing({ atRim: true }), undefined, world)
    expect(said).toContain('You are at the edge of the valley, where the road comes in')
    expect(said).toContain('The town is up the road')
    expect(said).not.toContain('nothing lies beyond')
  })

  it('says so in the line about how far the ground goes', () => {
    expect(valleyExtentLine(world)).toBe(
      'The valley runs from (0, 0) to (127, 127). Past its edges there is only the road out.',
    )
    expect(valleyExtentLine(world)).not.toContain('nothing to find')
  })
})

describe('★ a face nobody here has seen before', () => {
  it('is named as one, and only while the town is still getting used to it', () => {
    expect(perceptionToProse(withAgents([person({ stranger: true })]), undefined, world)).toContain(
      'Mira (agent_9), a stranger who came up the valley road, stands',
    )
    expect(perceptionToProse(withAgents([person()]), undefined, world)).toContain(
      'Mira (agent_9) stands',
    )
  })

  it('is named the same way lying on the ground and asleep', () => {
    const down = perceptionToProse(
      withAgents([person({ stranger: true, collapsed: true })]),
      undefined,
      world,
    )
    expect(down).toContain('Mira (agent_9), a stranger who came up the valley road, lies collapsed')
    const abed = perceptionToProse(
      withAgents([person({ stranger: true, asleep: true })]),
      undefined,
      world,
    )
    expect(abed).toContain('Mira (agent_9), a stranger who came up the valley road, sleeps')
  })

  it('is watched walking in by whoever had the edge in sight', () => {
    const said = perceptionToProse(
      seeing({ seen: [{ kind: 'stranger_arrived', name: 'Mira' }] }),
      undefined,
      world,
    )
    expect(said).toContain('You see Mira come up the valley road.')
  })
})

describe('★ the road out, said only where something stands behind it', () => {
  it('says nothing to a mind with nothing wrong', () => {
    expect(roadOutLine(null)).toBe('')
  })

  it('names the loneliness, the days of it, and the word for the road', () => {
    const said = roadOutLine({ kind: 'restless', days: 6 })
    expect(said).toContain('6 days now without anybody')
    expect(said).toContain('name it leave_town')
  })

  it('names whoever took it first, and when', () => {
    expect(roadOutLine({ kind: 'partner_gone', name: 'Amara', days: 2 })).toBe(
      'Amara left down the valley road 2 days ago.' +
        ' The road is still there. You could follow them: name it leave_town.',
    )
    expect(roadOutLine({ kind: 'partner_gone', name: 'Amara', days: 1 })).toContain('yesterday')
    expect(roadOutLine({ kind: 'partner_gone', name: 'Amara', days: 0 })).toContain('today')
  })

  it('names the times the town watched, and hands over no remedy', () => {
    const said = roadOutLine({ kind: 'shunned', times: 3 })
    expect(said).toContain('3 times now the town has seen you break')
    expect(scanForDirective(said)).toEqual([])
  })
})

describe('★ none of it puts an ops word in front of a mind', () => {
  it('passes the glass scan, every line of it', () => {
    const lines = [
      valleyExtentLine(world),
      perceptionToProse(seeing({ atRim: true }), undefined, world),
      perceptionToProse(withAgents([person({ stranger: true })]), undefined, world),
      perceptionToProse(
        seeing({ seen: [{ kind: 'stranger_arrived', name: 'Mira' }] }),
        undefined,
        world,
      ),
      roadOutLine({ kind: 'restless', days: 6 }),
      roadOutLine({ kind: 'partner_gone', name: 'Amara', days: 2 }),
      roadOutLine({ kind: 'shunned', times: 3 }),
      CAPABILITIES,
    ]
    for (const line of lines) expect(scanPromptForGlassLeak(line), line).toEqual([])
  })

  it('teaches the road out by its exact word, beside the other act nobody answers', () => {
    expect(CAPABILITIES).toMatch(/leave_town: name it leave_town/)
    expect(CAPABILITIES).toContain('there is no walking back')
  })
})
