import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { DAY_MOMENT_CAP, SCENE_MOMENT_CAP, pickDayMoments, pickMoments } from './moments.js'
import { sceneDigests } from './chronicle.js'
import type { SceneSegment } from './types.js'

const ev = (seq: number, type: string, payload: unknown = {}): SimEvent => ({
  seq,
  tick: 1440 + seq,
  type,
  payload,
})

const nameOf = (id: string): string => id[0]!.toUpperCase() + id.slice(1)

const LINE = 'The wall stands on my plot and you both know it.'

describe('pickMoments', () => {
  it('puts the scene outcome and the summary above anybody talking', () => {
    const evs = [
      ev(1, 'agent_spoke', { agentId: 'omar', text: LINE }),
      ev(2, 'agent_died', { agentId: 'yusuf', cause: 'a fall' }),
      ev(3, 'scene_closed', { summary: 'The quarrel over the wall ended badly.' }),
    ]
    expect(pickMoments(evs, nameOf, 2)).toEqual([
      { n: 2, text: 'Yusuf died of a fall.' },
      { n: 3, text: 'The quarrel over the wall ended badly.' },
    ])
  })

  it('returns its moments in seq order however they were ranked', () => {
    const evs = [
      ev(1, 'action_completed', { agentId: 'omar', verb: 'fish' }),
      ev(2, 'agent_spoke', { agentId: 'nadia', text: LINE }),
      ev(3, 'agent_injured', { agentId: 'omar' }),
      ev(4, 'scene_closed', { summary: 'They went in wet and cross.' }),
    ]
    expect(pickMoments(evs, nameOf).map((m) => m.n)).toEqual([1, 2, 3, 4])
  })

  it('takes at most two lines from one speaker, and prefers the keen ones', () => {
    const evs = [
      ev(1, 'agent_spoke', { agentId: 'omar', text: 'The river was low again this morning.' }),
      ev(2, 'agent_spoke', { agentId: 'omar', text: 'The nets were mended before the rain.' }),
      ev(3, 'agent_spoke', { agentId: 'omar', text: 'Will you come down to the water with me?' }),
      ev(4, 'scene_line', { agentId: 'nadia', text: 'Not before the bread is out of the oven!' }),
    ]
    const picked = pickMoments(evs, nameOf)
    expect(picked.map((m) => m.n)).toEqual([1, 3, 4])
    expect(picked[1]!.text).toBe('Omar said: "Will you come down to the water with me?"')
  })

  it('keeps a line that names somebody else in the scene over one that names nobody', () => {
    const evs = [
      ev(1, 'agent_spoke', { agentId: 'omar', text: 'The morning was grey and the wind was up.' }),
      ev(2, 'agent_spoke', { agentId: 'omar', text: 'The nets are dry and the boat is beached.' }),
      ev(3, 'agent_spoke', { agentId: 'omar', text: 'Nadia carried the whole catch up alone.' }),
      ev(4, 'agent_moved', { id: 'nadia', x: 1, y: 1 }),
    ]
    expect(pickMoments(evs, nameOf).map((m) => m.n)).toEqual([1, 3])
  })

  it('drops lines too short or too long to be worth quoting', () => {
    const evs = [
      ev(1, 'agent_spoke', { agentId: 'omar', text: 'Aye.' }),
      ev(2, 'agent_spoke', { agentId: 'nadia', text: 'x'.repeat(181) }),
      ev(3, 'agent_spoke', { agentId: 'yusuf', text: LINE }),
    ]
    expect(pickMoments(evs, nameOf).map((m) => m.n)).toEqual([3])
  })

  it('tells the work that is worth a line and never the walking, eating and sleeping', () => {
    const evs = [
      ev(1, 'action_completed', { agentId: 'omar', verb: 'walk' }),
      ev(2, 'action_completed', { agentId: 'omar', verb: 'eat' }),
      ev(3, 'action_completed', { agentId: 'omar', verb: 'drink' }),
      ev(4, 'action_completed', { agentId: 'omar', verb: 'sleep' }),
      ev(5, 'action_completed', { agentId: 'omar', verb: 'enter' }),
      ev(6, 'action_completed', { agentId: 'omar', verb: 'chop' }),
    ]
    expect(pickMoments(evs, nameOf)).toEqual([{ n: 6, text: 'Omar was seen to chop.' }])
  })

  it('takes one action per verb, not one per swing of the axe', () => {
    const evs = [
      ev(1, 'action_completed', { agentId: 'omar', verb: 'chop' }),
      ev(2, 'action_completed', { agentId: 'omar', verb: 'chop' }),
      ev(3, 'action_completed', { agentId: 'nadia', verb: 'chop' }),
      ev(4, 'action_completed', { agentId: 'nadia', verb: 'cook' }),
    ]
    expect(pickMoments(evs, nameOf).map((m) => m.n)).toEqual([1, 4])
  })

  it('tells a finished building and a harvest without inventing a person for them', () => {
    const evs = [
      ev(1, 'structure_completed', { id: 'structure_3' }),
      ev(2, 'crop_harvested', { cropId: 'c1' }),
    ]
    expect(pickMoments(evs, nameOf)).toEqual([
      { n: 1, text: 'A building was finished.' },
      { n: 2, text: 'A crop was brought in.' },
    ])
  })

  it('clips a long scene summary rather than sending the whole of it', () => {
    const evs = [ev(1, 'scene_closed', { summary: 'a'.repeat(500) })]
    expect(pickMoments(evs, nameOf)[0]!.text.length).toBe(200)
  })

  it('keeps at most ten moments from one scene', () => {
    const evs = Array.from({ length: 30 }, (_x, i) =>
      ev(i + 1, 'agent_spoke', { agentId: `speaker${i}`, text: `${LINE} ${i}` }),
    )
    expect(pickMoments(evs, nameOf).length).toBe(SCENE_MOMENT_CAP)
  })
})

describe('pickDayMoments', () => {
  const chatty = (base: number): SimEvent[] =>
    Array.from({ length: 20 }, (_x, i) =>
      ev(base + i, 'agent_spoke', { agentId: `speaker${base + i}`, text: `${LINE} ${base + i}` }),
    )

  it('trims the day to its cap out of the coolest scene first', () => {
    const scenes = [
      { events: chatty(100), heat: 9 },
      { events: chatty(200), heat: 1 },
      { events: chatty(300), heat: 5 },
    ]
    const day = pickDayMoments(scenes, nameOf, 25)
    expect(day.map((m) => m.length)).toEqual([10, 5, 10])
  })

  it('empties the coolest scene before a warmer one loses anything', () => {
    const scenes = [
      { events: chatty(100), heat: 9 },
      { events: chatty(200), heat: 1 },
      { events: chatty(300), heat: 2 },
    ]
    const day = pickDayMoments(scenes, nameOf, 12)
    expect(day.map((m) => m.length)).toEqual([10, 0, 2])
  })

  it('leaves a day under the cap alone, and the cap is sixty', () => {
    const scenes = [
      { events: chatty(100), heat: 3 },
      { events: chatty(200), heat: 4 },
    ]
    expect(DAY_MOMENT_CAP).toBe(60)
    expect(pickDayMoments(scenes, nameOf).map((m) => m.length)).toEqual([10, 10])
  })

  it('is deterministic: the same day picked twice is the same day', () => {
    const scenes = [
      { events: chatty(100), heat: 2 },
      { events: chatty(200), heat: 2 },
    ]
    expect(pickDayMoments(scenes, nameOf, 13)).toEqual(pickDayMoments(scenes, nameOf, 13))
  })
})

describe('what the chapter call now carries', () => {
  it('serializes a two-hundred-event scene under four thousand characters', () => {
    const events: SimEvent[] = []
    for (let i = 1; i <= 200; i += 1) {
      const who = `villager${i % 7}`
      if (i % 4 === 0) events.push(ev(i, 'agent_spoke', { agentId: who, text: `${LINE} ${i}` }))
      else if (i % 4 === 1) events.push(ev(i, 'agent_moved', { id: who, x: i % 30, y: i % 20 }))
      else if (i % 4 === 2)
        events.push(ev(i, 'action_completed', { agentId: who, verb: 'fish', x: 1, y: 2 }))
      else events.push(ev(i, 'needs_changed', { id: who, hunger: 0.4 }))
    }
    const scene: SceneSegment = {
      day: 1,
      startTick: 1441,
      endTick: 1640,
      eventIds: events.map((e) => e.seq),
      cast: [...new Set(events.map((_x, i) => `villager${(i + 1) % 7}`))],
      location: '3,4',
    }
    const moments = pickDayMoments([{ events, heat: 4 }], nameOf)
    const [digest] = sceneDigests([scene], { nameOf, placeOf: () => 'the river bank' }, moments)
    const json = JSON.stringify(digest)
    expect(json).not.toContain('eventIds')
    expect(json.length).toBeLessThan(4000)
  })
})
