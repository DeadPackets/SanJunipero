import { describe, expect, it } from 'vitest'
import { conversationFacing } from './interior.js'

const people = new Map([
  ['dilara', { at: { x: 0, z: 0 } }],
  ['halim', { at: { x: 3, z: 0 } }],
  ['tariq', { at: { x: 0, z: 3 } }],
])
const scene = {
  cast: ['dilara', 'halim', 'tariq'],
  voices: [
    { agentId: 'halim', x: 0, y: 0, atMs: 1 },
    { agentId: 'dilara', x: 0, y: 0, atMs: 2 },
  ],
}
const dilara = { id: 'dilara', asleep: false, activity: null }

describe('indoor conversation facing', () => {
  it('faces the prior speaker, then follows a new visible speaker using room positions', () => {
    const first = conversationFacing(dilara, false, scene, people)
    expect(first).toBe('se')
    expect(
      conversationFacing(
        dilara,
        false,
        {
          ...scene,
          voices: [...scene.voices, { agentId: 'tariq', x: 0, y: 0, atMs: 3 }],
        },
        people,
      ),
    ).toBe('sw')
  })

  it('does not turn a sleeper, worker or interpolating walker', () => {
    expect(conversationFacing({ ...dilara, asleep: true }, false, scene, people)).toBeNull()
    expect(
      conversationFacing({ ...dilara, activity: { verb: 'craft' } }, false, scene, people),
    ).toBeNull()
    expect(conversationFacing(dilara, true, scene, people)).toBeNull()
  })

  it('does not face an outside participant or an unrelated room occupant', () => {
    const indoors = new Map(people)
    indoors.delete('halim')
    expect(conversationFacing(dilara, false, scene, indoors)).toBeNull()
    expect(
      conversationFacing(dilara, false, { ...scene, cast: ['halim', 'tariq'] }, people),
    ).toBeNull()
    expect(conversationFacing(dilara, false, { ...scene, voices: [] }, people)).toBeNull()
  })
})
