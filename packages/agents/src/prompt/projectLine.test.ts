import { describe, expect, it } from 'vitest'
import { makeablesLine, projectLine } from './prose.js'

// r32: nine of twelve standing lines named a thing being made, and the arbiter saw two tries in
// two days. The goal that names a project is tied to the door it goes through.

const M = {
  builds: [
    { kind: 'bridge', inputs: { wood: 6 } },
    { kind: 'house', inputs: { wood: 10 } },
  ],
  crafts: [{ name: 'plank', roads: [{ inputs: { wood: 1 }, needs: [] }] }],
} as unknown as Parameters<typeof projectLine>[1]

describe('★ a project named in a goal is pointed at its door', () => {
  it('a listed thing is sent to build or craft by name', () => {
    const line = projectLine(
      ['I want Dilara to hear me out.', "I'm still making the bridge once I find the right place."],
      M,
    )
    expect(line).toContain(
      'You said you are making something: "I\'m still making the bridge once I find the right place."',
    )
    expect(line).toContain('That is on your list: bridge. Make it now, with build or craft.')
  })

  it('a thing on no list is sent to experiment', () => {
    const line = projectLine(["I'm making the north net sound again."], M)
    expect(line).toContain('It is on no list you know. Try it anyway: name it experiment')
    expect(line).toContain('never touched is a thing you have given up on')
  })

  it('no project, no line', () => {
    expect(
      projectLine(['I want Omar found before another night goes by.', 'I owe Nadia a visit.'], M),
    ).toBe('')
    expect(projectLine([], M)).toBe('')
  })

  it('the makeables line says where a bridge starts', () => {
    expect(makeablesLine(M, { x: 65, y: 13 })).toContain(
      'A bridge is the exception: it goes over water, started from the bank beside the spot you want it.',
    )
    expect(
      makeablesLine({ builds: [{ kind: 'house', inputs: { wood: 10 } }], crafts: [] }, null),
    ).not.toContain('bridge')
  })
})
